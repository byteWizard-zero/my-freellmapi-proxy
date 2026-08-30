import crypto from 'crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { getDb, getUnifiedApiKey } from '../db/index.js';
import { AudioRouter } from '../services/audio-router.js';
import type { AudioSpeechFormat, AudioVoice } from '@freellmapi/shared/types.js';

export const audioRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB audio files
});

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
    console.error('Failed to log audio request:', e);
  }
}

// POST /v1/audio/transcriptions
audioRouter.post('/transcriptions', upload.single('file'), async (req: Request, res: Response) => {
  const start = Date.now();
  if (!authenticateRequest(req, res)) return;

  let fileBuffer: Buffer | null = null;
  let filename = 'audio.mp3';

  if (req.file) {
    fileBuffer = req.file.buffer;
    filename = req.file.originalname || filename;
  } else if (req.body.file) {
    // Handle base64 audio payload
    const base64Str = String(req.body.file).replace(/^data:audio\/[^;]+;base64,/, '');
    fileBuffer = Buffer.from(base64Str, 'base64');
  }

  if (!fileBuffer || fileBuffer.length === 0) {
    res.status(400).json({
      error: {
        message: 'No audio file provided. Send a multipart form with "file" or a JSON payload with base64 "file".',
        type: 'invalid_request_error',
      },
    });
    return;
  }

  const model = req.body.model || 'whisper-1';
  const language = req.body.language;
  const prompt = req.body.prompt;
  const responseFormat = req.body.response_format || 'json';
  const temperature = req.body.temperature ? parseFloat(req.body.temperature) : undefined;

  try {
    const result = await AudioRouter.transcribeAudio({
      file: fileBuffer,
      filename,
      model,
      language,
      prompt,
      response_format: responseFormat,
      temperature,
    });

    const latency = Date.now() - start;
    if (result._routed_via) {
      res.setHeader('X-Routed-Via', `${result._routed_via.platform}/${result._routed_via.model}`);
      logRequest(result._routed_via.platform, result._routed_via.model, 'success', latency, null);
    } else {
      logRequest('groq', model, 'success', latency, null);
    }

    if (responseFormat === 'text') {
      res.setHeader('Content-Type', 'text/plain');
      res.send(result.text);
      return;
    }

    res.json(result);
  } catch (err: any) {
    const latency = Date.now() - start;
    logRequest('error', model, 'error', latency, err.message);
    res.status(500).json({
      error: {
        message: err.message || 'Audio transcription failed',
        type: 'api_error',
      },
    });
  }
});

// POST /v1/audio/translations
audioRouter.post('/translations', upload.single('file'), async (req: Request, res: Response) => {
  const start = Date.now();
  if (!authenticateRequest(req, res)) return;

  let fileBuffer: Buffer | null = null;
  let filename = 'audio.mp3';

  if (req.file) {
    fileBuffer = req.file.buffer;
    filename = req.file.originalname || filename;
  } else if (req.body.file) {
    const base64Str = String(req.body.file).replace(/^data:audio\/[^;]+;base64,/, '');
    fileBuffer = Buffer.from(base64Str, 'base64');
  }

  if (!fileBuffer || fileBuffer.length === 0) {
    res.status(400).json({
      error: {
        message: 'No audio file provided',
        type: 'invalid_request_error',
      },
    });
    return;
  }

  const model = req.body.model || 'whisper-1';
  const prompt = req.body.prompt;
  const responseFormat = req.body.response_format || 'json';
  const temperature = req.body.temperature ? parseFloat(req.body.temperature) : undefined;

  try {
    const result = await AudioRouter.translateAudio({
      file: fileBuffer,
      filename,
      model,
      prompt,
      response_format: responseFormat,
      temperature,
    });

    const latency = Date.now() - start;
    if (result._routed_via) {
      res.setHeader('X-Routed-Via', `${result._routed_via.platform}/${result._routed_via.model}`);
      logRequest(result._routed_via.platform, result._routed_via.model, 'success', latency, null);
    } else {
      logRequest('groq', model, 'success', latency, null);
    }

    if (responseFormat === 'text') {
      res.setHeader('Content-Type', 'text/plain');
      res.send(result.text);
      return;
    }

    res.json(result);
  } catch (err: any) {
    const latency = Date.now() - start;
    logRequest('error', model, 'error', latency, err.message);
    res.status(500).json({
      error: {
        message: err.message || 'Audio translation failed',
        type: 'api_error',
      },
    });
  }
});

const speechSchema = z.object({
  model: z.string().optional().default('tts-1'),
  input: z.string().min(1, 'Input text is required'),
  voice: z.string().optional().default('alloy'),
  response_format: z.enum(['mp3', 'opus', 'aac', 'flac', 'wav', 'pcm']).optional().default('mp3'),
  speed: z.number().min(0.25).max(4.0).optional().default(1.0),
});

// POST /v1/audio/speech
audioRouter.post('/speech', async (req: Request, res: Response) => {
  const start = Date.now();
  if (!authenticateRequest(req, res)) return;

  const parsed = speechSchema.safeParse(req.body);
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
    const result = await AudioRouter.generateSpeech({
      model: parsed.data.model,
      input: parsed.data.input,
      voice: parsed.data.voice as AudioVoice,
      response_format: parsed.data.response_format as AudioSpeechFormat,
      speed: parsed.data.speed,
    });

    const latency = Date.now() - start;
    logRequest('tts', parsed.data.model, 'success', latency, null);

    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Content-Length', result.audioBuffer.length);
    res.send(result.audioBuffer);
  } catch (err: any) {
    const latency = Date.now() - start;
    logRequest('error', parsed.data.model, 'error', latency, err.message);
    res.status(500).json({
      error: {
        message: err.message || 'Speech synthesis failed',
        type: 'api_error',
      },
    });
  }
});
