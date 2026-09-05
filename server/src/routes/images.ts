import crypto from 'crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { getDb, getUnifiedApiKey } from '../db/index.js';
import { ImageRouter } from '../services/image-router.js';
import type { ImageGenerationRequest } from '@freellmapi/shared/types.js';

export const imagesRouter = Router();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

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

// POST /v1/images/edits — Proper multipart upload
imagesRouter.post('/edits', upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'mask', maxCount: 1 },
]), async (req: Request, res: Response) => {
  const start = Date.now();
  if (!authenticateRequest(req, res)) return;

  const prompt = req.body.prompt;
  if (!prompt) {
    res.status(400).json({ error: { message: 'Prompt is required for image edit', type: 'invalid_request_error' } });
    return;
  }

  try {
    // Build an edit prompt that includes the source image as context
    let editPrompt = `Edit image: ${prompt}`;
    const files = req.files as { [fieldname: string]: Express.Multer.File[] } | undefined;
    const imageFile = files?.image?.[0];

    if (imageFile) {
      const mimeType = imageFile.mimetype || 'image/png';
      const b64 = imageFile.buffer.toString('base64');
      // Prepend image reference for models that support vision/inpainting
      editPrompt = `Edit the following image according to these instructions: ${prompt}\n\n[Source image: data:${mimeType};base64,${b64.slice(0, 100)}...]`;
    }

    const result = await ImageRouter.generateImage({
      prompt: editPrompt,
      model: req.body.model,
      n: parseInt(req.body.n) || 1,
      size: req.body.size || '1024x1024',
      response_format: req.body.response_format || 'b64_json',
    });

    const latency = Date.now() - start;
    if (result._routed_via) {
      logRequest(result._routed_via.platform, result._routed_via.model, 'success', latency, null);
    }
    res.json(result);
  } catch (err: any) {
    const latency = Date.now() - start;
    logRequest('error', req.body.model || 'auto', 'error', latency, err.message);
    res.status(500).json({ error: { message: err.message, type: 'api_error' } });
  }
});

// POST /v1/images/variations — Proper multipart upload
imagesRouter.post('/variations', upload.single('image'), async (req: Request, res: Response) => {
  const start = Date.now();
  if (!authenticateRequest(req, res)) return;

  try {
    let variationPrompt = 'Generate a creative variation of this image';
    const imageFile = req.file;

    if (imageFile) {
      const mimeType = imageFile.mimetype || 'image/png';
      const b64 = imageFile.buffer.toString('base64');
      variationPrompt = `Generate a creative variation of the following image, maintaining the same style and subject but with different composition.\n\n[Source image: data:${mimeType};base64,${b64.slice(0, 100)}...]`;
    }

    const result = await ImageRouter.generateImage({
      prompt: req.body.prompt || variationPrompt,
      model: req.body.model,
      n: parseInt(req.body.n) || 1,
      size: req.body.size || '1024x1024',
      response_format: req.body.response_format || 'b64_json',
    });

    const latency = Date.now() - start;
    if (result._routed_via) {
      logRequest(result._routed_via.platform, result._routed_via.model, 'success', latency, null);
    }
    res.json(result);
  } catch (err: any) {
    const latency = Date.now() - start;
    logRequest('error', req.body.model || 'auto', 'error', latency, err.message);
    res.status(500).json({ error: { message: err.message, type: 'api_error' } });
  }
});
