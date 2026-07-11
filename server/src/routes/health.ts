import { Router } from 'express';
import type { Request, Response } from 'express';
import { getDb } from '../db/index.js';
import { checkKeyHealth, checkAllKeys } from '../services/health.js';
import { hasProvider } from '../providers/index.js';
import { decrypt, maskKey } from '../lib/crypto.js';
import { getActiveCooldowns } from '../services/ratelimit.js';

export const healthRouter = Router();

// Get health status for all platforms
healthRouter.get('/', (_req: Request, res: Response) => {
  const db = getDb();

  const platforms = db.prepare(`
    SELECT
      platform,
      COUNT(*) as total_keys,
      SUM(CASE WHEN status = 'healthy' THEN 1 ELSE 0 END) as healthy_keys,
      SUM(CASE WHEN status = 'rate_limited' THEN 1 ELSE 0 END) as rate_limited_keys,
      SUM(CASE WHEN status = 'invalid' THEN 1 ELSE 0 END) as invalid_keys,
      SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as error_keys,
      SUM(CASE WHEN status = 'unknown' THEN 1 ELSE 0 END) as unknown_keys,
      SUM(CASE WHEN enabled = 1 THEN 1 ELSE 0 END) as enabled_keys
    FROM api_keys
    GROUP BY platform
  `).all() as any[];

  const keys = db.prepare(`
    SELECT id, platform, label, status, enabled, created_at, last_checked_at, error_message
    FROM api_keys
    ORDER BY platform, created_at DESC
  `).all() as any[];

  res.json({
    platforms: platforms.map(p => ({
      platform: p.platform,
      hasProvider: hasProvider(p.platform),
      totalKeys: p.total_keys,
      healthyKeys: p.healthy_keys,
      rateLimitedKeys: p.rate_limited_keys,
      invalidKeys: p.invalid_keys,
      errorKeys: p.error_keys,
      unknownKeys: p.unknown_keys,
      enabledKeys: p.enabled_keys,
    })),
    keys: keys.map(k => ({
      id: k.id,
      platform: k.platform,
      label: k.label,
      status: k.status,
      enabled: k.enabled === 1,
      createdAt: k.created_at,
      lastCheckedAt: k.last_checked_at,
      errorMessage: k.error_message,
    })),
    cooldowns: getActiveCooldowns().map(c => {
      const keyRow = db.prepare('SELECT label, encrypted_key, iv, auth_tag FROM api_keys WHERE id = ?').get(c.keyId) as any;
      let label = '';
      let maskedKey = '****';
      if (keyRow) {
        label = keyRow.label || '';
        try {
          const realKey = decrypt(keyRow.encrypted_key, keyRow.iv, keyRow.auth_tag);
          maskedKey = maskKey(realKey);
        } catch {
          maskedKey = '[decrypt failed]';
        }
      }
      return {
        keyId: c.keyId,
        platform: c.platform,
        modelId: c.modelId,
        errorMessage: c.errorMessage,
        expiry: new Date(c.expiry).toISOString(),
        remainingSeconds: Math.max(0, Math.ceil((c.expiry - Date.now()) / 1000)),
        label,
        maskedKey,
      };
    }),
  });
});

// Check a specific key
healthRouter.post('/check/:keyId', async (req: Request, res: Response) => {
  const keyId = parseInt(req.params.keyId as string, 10);
  if (isNaN(keyId)) {
    res.status(400).json({ error: { message: 'Invalid key ID' } });
    return;
  }

  const status = await checkKeyHealth(keyId);
  res.json({ keyId, status });
});

// Check all keys
healthRouter.post('/check-all', async (req: Request, res: Response) => {
  const mode = req.body?.mode === 'parallel' || req.query?.mode === 'parallel' ? 'parallel' : 'sequential';
  await checkAllKeys(mode);
  res.json({ success: true });
});
