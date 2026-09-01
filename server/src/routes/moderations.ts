import crypto from 'crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { ModerationService } from '../services/moderation-service.js';
import { getDb, getUnifiedApiKey, validateClientApiKey } from '../db/index.js';

export const moderationsRouter = Router();

function timingSafeStringEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  const compareA = a.length === b.length ? a : Buffer.alloc(b.length);
  return crypto.timingSafeEqual(compareA, b) && a.length === b.length;
}

const moderationSchema = z.object({
  input: z.union([z.string(), z.array(z.string())]),
  model: z.string().optional(),
});

moderationsRouter.post('/', async (req: Request, res: Response) => {
  const start = Date.now();
  const isLocal = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';

  if (!isLocal || req.headers.authorization) {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')?.trim();
    const unifiedKey = getUnifiedApiKey();

    if (!token) {
      res.status(401).json({
        error: { message: 'Missing API key', type: 'authentication_error' },
      });
      return;
    }

    if (!timingSafeStringEqual(token, unifiedKey)) {
      const clientAuth = validateClientApiKey(token);
      if (!clientAuth.isValid) {
        res.status(401).json({
          error: { message: clientAuth.error || 'Invalid API key', type: 'authentication_error' },
        });
        return;
      }
    }
  }

  const parsed = moderationSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        message: `Invalid request: ${parsed.error.errors.map(e => e.message).join(', ')}`,
        type: 'invalid_request_error',
      },
    });
    return;
  }

  try {
    const result = await ModerationService.moderate(parsed.data);
    const platform = result._routed_via?.platform || 'moderation';
    const model = result._routed_via?.model || (parsed.data.model || 'text-moderation-latest');

    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO requests (platform, model_id, status, input_tokens, output_tokens, latency_ms, error)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(platform, model, 'success', 0, 0, Date.now() - start, null);
    } catch {}

    res.setHeader('X-Routed-Via', `${platform}/${model}`);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({
      error: {
        message: err.message || 'Moderation check failed',
        type: 'api_error',
      },
    });
  }
});
