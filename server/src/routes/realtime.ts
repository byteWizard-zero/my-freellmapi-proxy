import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb, getUnifiedApiKey } from '../db/index.js';
import { decrypt } from '../lib/crypto.js';

export const realtimeRouter = Router();

function authenticateRequest(req: Request, res: Response): boolean {
  const isLocal = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
  if (!isLocal) {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    const unifiedKey = getUnifiedApiKey();
    if (!token || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(unifiedKey))) {
      res.status(401).json({ error: { message: 'Invalid API key', type: 'authentication_error' } });
      return false;
    }
  }
  return true;
}

function getOpenAIKey(): string | null {
  const db = getDb();
  const envKey = process.env.OPENAI_API_KEY;
  if (envKey) return envKey;
  
  const rows = db.prepare('SELECT encrypted_key, iv, auth_tag FROM api_keys WHERE platform = ? AND enabled = 1').all('github') as any[];
  for (const row of rows) {
    try {
      return decrypt(row.encrypted_key, row.iv, row.auth_tag);
    } catch { continue; }
  }
  return null;
}

const handleSessions = async (req: Request, res: Response) => {
  if (!authenticateRequest(req, res)) return;
  
  const key = getOpenAIKey();
  if (!key) {
    res.status(400).json({
      error: {
        message: 'Realtime API requires an OpenAI API key. Add one via OPENAI_API_KEY env var or add a GitHub Models key.',
        type: 'invalid_request_error'
      }
    });
    return;
  }

  const model = req.body.model || 'gpt-4o-realtime-preview';
  const body = { ...req.body, model };

  try {
    const openaiRes = await fetch('https://api.openai.com/v1/realtime/sessions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const data = await openaiRes.json();
    res.status(openaiRes.status).json(data);
  } catch (err: any) {
    res.status(500).json({
      error: {
        message: err.message || 'Internal server error',
        type: 'server_error'
      }
    });
  }
};

realtimeRouter.post('/sessions', handleSessions);
realtimeRouter.post('/', handleSessions);
