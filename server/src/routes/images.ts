import crypto from 'crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getDb, getUnifiedApiKey } from '../db/index.js';
import { ImageRouter } from '../services/image-router.js';
import type { ImageGenerationRequest } from '@freellmapi/shared/types.js';

export const imagesRouter = Router();

function timingSafeStringEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  const compareA = a.length === b.length ? a : Buffer.alloc(b.length);
  return crypto.timingSafeEqual(compareA, b) && a.length === b.length;
}

function authenticateRequest(req: Request, res: Response): boolean {
  const isLocal = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
  if (!isLocal) {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    const unifiedKey = getUnifiedApiKey();
    if (!token || !timingSafeStringEqual(token, unifiedKey)) {
      res.status(401).json({
        error: { message: 'Invalid API key', type: 'authentication_error' },
      });
      return false;
    }
  }
  return true;
}

function logRequest(
  platform: string,
  modelId: string,
  status: string,
  latencyMs: number,
  error: string | null,
) {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO requests (platform, model_id, status, input_tokens, output_tokens, latency_ms, error)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(platform, modelId, status, 0, 0, latencyMs, error);
  } catch (e) {
    console.error('Failed to log image request:', e);
  }
}

const imageGenerationSchema = z.object({
  prompt: z.string().min(1, 'Prompt is required'),
  model: z.string().optional(),
  n: z.number().int().min(1).max(10).optional().default(1),
  quality: z.string().optional(),
  response_format: z.enum(['url', 'b64_json']).optional().default('b64_json'),
  size: z.string().optional().default('1024x1024'),
  style: z.string().optional(),
  user: z.string().optional(),
});

// POST /v1/images/generations
imagesRouter.post('/generations', async (req: Request, res: Response) => {
  const start = Date.now();
  if (!authenticateRequest(req, res)) return;

  const parsed = imageGenerationSchema.safeParse(req.body);
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
    const result = await ImageRouter.generateImage(parsed.data as ImageGenerationRequest);
    const latency = Date.now() - start;

    if (result._routed_via) {
      res.setHeader('X-Routed-Via', `${result._routed_via.platform}/${result._routed_via.model}`);
      logRequest(result._routed_via.platform, result._routed_via.model, 'success', latency, null);
    } else {
      logRequest('unknown', parsed.data.model || 'auto', 'success', latency, null);
    }

    res.json(result);
  } catch (err: any) {
    const latency = Date.now() - start;
    logRequest('error', parsed.data.model || 'auto', 'error', latency, err.message);
    res.status(500).json({
      error: {
        message: err.message || 'Image generation failed',
        type: 'api_error',
      },
    });
  }
});

// POST /v1/images/edits
imagesRouter.post('/edits', async (req: Request, res: Response) => {
  const start = Date.now();
  if (!authenticateRequest(req, res)) return;

  const prompt = req.body.prompt;
  if (!prompt) {
    res.status(400).json({ error: { message: 'Prompt is required for image edit', type: 'invalid_request_error' } });
    return;
  }

  try {
    const result = await ImageRouter.generateImage({
      prompt: `Edit: ${prompt}`,
      model: req.body.model,
      size: req.body.size || '1024x1024',
      response_format: req.body.response_format || 'b64_json',
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: { message: err.message, type: 'api_error' } });
  }
});

// POST /v1/images/variations
imagesRouter.post('/variations', async (req: Request, res: Response) => {
  const start = Date.now();
  if (!authenticateRequest(req, res)) return;

  try {
    const result = await ImageRouter.generateImage({
      prompt: req.body.prompt || 'Generate a creative variation of the image',
      model: req.body.model,
      size: req.body.size || '1024x1024',
      response_format: req.body.response_format || 'b64_json',
    });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: { message: err.message, type: 'api_error' } });
  }
});
