import crypto from 'crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { EmbeddingRouter } from '../services/embedding-router.js';
import { getDb, getUnifiedApiKey, validateClientApiKey, recordClientKeyUsage } from '../db/index.js';

export const embeddingsRouter = Router();

function timingSafeStringEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  const compareA = a.length === b.length ? a : Buffer.alloc(b.length);
  return crypto.timingSafeEqual(compareA, b) && a.length === b.length;
}

const embeddingSchema = z.object({
  input: z.union([z.string(), z.array(z.string())]),
  model: z.string().optional(),
  encoding_format: z.enum(['float', 'base64']).optional(),
  dimensions: z.number().int().positive().optional(),
  user: z.string().optional(),
});

embeddingsRouter.post('/', async (req: Request, res: Response) => {
  const start = Date.now();

  const isLocal = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
  let clientKeyId: number | undefined;

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
      if (!clientAuth.isValid || !clientAuth.clientKey) {
        res.status(401).json({
          error: { message: clientAuth.error || 'Invalid API key', type: 'authentication_error' },
        });
        return;
      }
      clientKeyId = clientAuth.clientKey.id;
    }
  }

  const parsed = embeddingSchema.safeParse(req.body);
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
    const result = await EmbeddingRouter.generateEmbeddings(parsed.data);

    if (clientKeyId && result.usage?.total_tokens) {
      recordClientKeyUsage(clientKeyId, result.usage.total_tokens);
    }

    const platform = result._routed_via?.platform || 'router';
    const model = result._routed_via?.model || (parsed.data.model || 'auto');

    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO requests (platform, model_id, status, input_tokens, output_tokens, latency_ms, error)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(platform, model, 'success', result.usage.prompt_tokens, 0, Date.now() - start, null);
    } catch {
      // Ignore log write errors
    }

    res.setHeader('X-Routed-Via', `${platform}/${model}`);
    res.json(result);
  } catch (err: any) {
    const latency = Date.now() - start;
    try {
      const db = getDb();
      db.prepare(`
        INSERT INTO requests (platform, model_id, status, input_tokens, output_tokens, latency_ms, error)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('embeddings', parsed.data.model || 'auto', 'error', 0, 0, latency, err.message);
    } catch {
      // Ignore log write errors
    }

    res.status(500).json({
      error: {
        message: err.message || 'Embedding generation failed',
        type: 'api_error',
      },
    });
  }
});
