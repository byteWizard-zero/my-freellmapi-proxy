import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { getDb } from '../db/index.js';
import { encrypt, decrypt, maskKey } from '../lib/crypto.js';
import { routeRequest } from '../services/router.js';

export const keysRouter = Router();

// Active providers — must match providers/index.ts registrations + shared/types.ts Platform.
// Hugging Face, Moonshot, and MiniMax direct integrations were dropped in V4
// (see migrateModelsV4 comment block).
const PLATFORMS = [
  'google', 'groq', 'cerebras', 'sambanova', 'nvidia', 'mistral',
  'openrouter', 'github', 'cohere', 'cloudflare', 'zhipu', 'ollama',
  'kilo', 'pollinations', 'llm7', 'moonshot',
] as const;

const addKeySchema = z.object({
  platform: z.enum(PLATFORMS),
  key: z.string().min(1),
  label: z.string().optional(),
});

// List all keys (masked)
keysRouter.get('/', (_req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM api_keys ORDER BY created_at DESC').all() as any[];

  const keys = rows.map(row => {
    let maskedKey = '****';
    try {
      const realKey = decrypt(row.encrypted_key, row.iv, row.auth_tag);
      maskedKey = maskKey(realKey);
    } catch {
      maskedKey = '[decrypt failed]';
    }
    return {
      id: row.id,
      platform: row.platform,
      label: row.label,
      maskedKey,
      status: row.status,
      enabled: row.enabled === 1,
      createdAt: row.created_at,
      lastCheckedAt: row.last_checked_at,
      errorMessage: row.error_message,
    };
  });

  res.json(keys);
});

// Add a key
keysRouter.post('/', (req: Request, res: Response) => {
  const parsed = addKeySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: { message: parsed.error.errors.map(e => e.message).join(', ') } });
    return;
  }

  const { platform, key, label } = parsed.data;
  const { encrypted, iv, authTag } = encrypt(key);

  const db = getDb();
  const result = db.prepare(`
    INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
    VALUES (?, ?, ?, ?, ?, 'unknown', 1)
  `).run(platform, label ?? '', encrypted, iv, authTag);

  res.status(201).json({
    id: result.lastInsertRowid,
    platform,
    label: label ?? '',
    maskedKey: maskKey(key),
    status: 'unknown',
    enabled: true,
  });
});

// Delete a key
keysRouter.delete('/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: { message: 'Invalid key ID' } });
    return;
  }

  const db = getDb();
  const result = db.prepare('DELETE FROM api_keys WHERE id = ?').run(id);

  if (result.changes === 0) {
    res.status(404).json({ error: { message: 'Key not found' } });
    return;
  }

  res.json({ success: true });
});

// Toggle enable/disable
keysRouter.patch('/:id', (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: { message: 'Invalid key ID' } });
    return;
  }

  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') {
    res.status(400).json({ error: { message: 'enabled must be a boolean' } });
    return;
  }

  const db = getDb();
  const result = db.prepare('UPDATE api_keys SET enabled = ? WHERE id = ?').run(enabled ? 1 : 0, id);

  if (result.changes === 0) {
    res.status(404).json({ error: { message: 'Key not found' } });
    return;
  }

  res.json({ success: true, enabled });
});

// AI troubleshooting route
keysRouter.post('/:id/troubleshoot', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: { message: 'Invalid key ID' } });
    return;
  }

  const db = getDb();
  const keyRow = db.prepare('SELECT id, platform, status, error_message FROM api_keys WHERE id = ?').get(id) as any;
  if (!keyRow) {
    res.status(404).json({ error: { message: 'Key not found' } });
    return;
  }

  const errorMsg = keyRow.error_message || 'No recorded error. The key is either working or has not been checked yet.';

  let suggestion = '';
  let routedModelInfo = '';
  const skipKeys = new Set<string>();
  let lastError: any = null;
  const MAX_RETRIES = 10;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let route: any;
    try {
      route = routeRequest(2000, skipKeys.size > 0 ? skipKeys : undefined);
    } catch (routeErr: any) {
      lastError = routeErr;
      break;
    }

    try {
      routedModelInfo = `${route.platform}/${route.modelId}`;
      const prompt = `You are an AI assistant helping a developer debug an API key validation/connection error in FreeLLMAPI (a self-hosted OpenAI-compatible proxy).

Platform with error: "${keyRow.platform}"
Error message received from API: "${errorMsg}"

Please analyze this error and provide:
1. A brief, clear explanation of what this error message means (e.g. rate limit, bad API key format, lack of credits, wrong endpoint URL).
2. Actionable, step-by-step instructions (3-4 bullet points) to fix it. Keep it concise, developer-friendly, and formatted in clean markdown. Do not include introductory text, just jump straight to the explanation and steps.`;

      const chatRes = await route.provider.chatCompletion(
        route.apiKey,
        [
          { role: 'system', content: 'You are an expert API troubleshooting assistant.' },
          { role: 'user', content: prompt }
        ],
        route.modelId,
        { temperature: 0.2 }
      );
      
      suggestion = chatRes.choices[0]?.message?.content ?? 'Failed to generate AI advice.';
      break;
    } catch (chatErr: any) {
      console.warn(`[Troubleshoot] Attempt ${attempt + 1} failed on ${route.platform}/${route.modelId}:`, chatErr.message);
      lastError = chatErr;
      const skipId = `${route.platform}:${route.modelId}:${route.keyId}`;
      skipKeys.add(skipId);
    }
  }

  if (!suggestion) {
    console.warn('[Troubleshoot] All attempts failed to generate suggestions. Last error:', lastError?.message);
    suggestion = `### Fallback Troubleshooting (No active AI keys available to generate dynamic suggestions)

**Potential issues for ${keyRow.platform}:**
- **Wrong Key format:** Check that the key starts with the correct prefix (e.g. \`gsk_\` for Groq, \`AIzaSy\` for Google, etc.).
- **Missing billing or expired limits:** Many free tiers require verified phone numbers or accounts in good standing.
- **Connection Issues:** Ensure the proxy server has access to the internet and isn't blocked by a firewall.
- **Detailed Error:** \`${errorMsg}\` (Last routing error: ${lastError?.message || 'Unknown'})`;
  }

  res.json({ suggestion, routedVia: routedModelInfo });
});
