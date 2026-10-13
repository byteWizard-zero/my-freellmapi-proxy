import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { initDb, getDb } from '../../db/index.js';
import { encrypt } from '../../lib/crypto.js';
import {
  routeRequest,
  recordRateLimitHit,
  getAllPenalties,
  isCircuitOpen,
  recordPlatformFailure,
  recordPlatformSuccess,
  resetCircuitBreakers,
  getCircuitBreakerStatus,
} from '../../services/router.js';

describe('Router', () => {
  beforeAll(() => {
    process.env.ENCRYPTION_KEY = '0'.repeat(64);
    initDb(':memory:');
  });

  beforeEach(() => {
    resetCircuitBreakers();
    const db = getDb();
    db.prepare('DELETE FROM api_keys').run();
    // Reset fallback order to intelligence ranking
    const models = db.prepare('SELECT id, intelligence_rank FROM models ORDER BY intelligence_rank ASC').all() as any[];
    const update = db.prepare('UPDATE fallback_config SET priority = ? WHERE model_db_id = ?');
    for (let i = 0; i < models.length; i++) {
      update.run(i + 1, models[i].id);
    }
  });

  it('should throw when no keys are configured', () => {
    expect(() => routeRequest()).toThrow(/exhausted/i);
  });

  it('should route to highest priority model with available key', () => {
    const db = getDb();
    const { encrypted, iv, authTag } = encrypt('test-groq-key');
    db.prepare(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('groq', 'test', encrypted, iv, authTag, 'healthy', 1);

    const result = routeRequest();
    expect(result.platform).toBe('groq');
    expect(result.apiKey).toBe('test-groq-key');
  });

  it('should prefer higher-priority model when keys exist for multiple platforms', () => {
    const db = getDb();

    const googleKey = encrypt('test-google-key');
    db.prepare(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('google', 'test', googleKey.encrypted, googleKey.iv, googleKey.authTag, 'healthy', 1);

    const groqKey = encrypt('test-groq-key');
    db.prepare(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('groq', 'test', groqKey.encrypted, groqKey.iv, groqKey.authTag, 'healthy', 1);

    // Post-V6: Google's gemini-3.1-pro-preview (rank 1, free-tier-eligible per
    // probe on 2026-04-25) outranks Groq's best free-tier model openai/gpt-oss-120b
    // (rank 6). With keys for both platforms, Google wins.
    const result = routeRequest();
    expect(result.platform).toBe('google');
  });

  it('should skip disabled keys', () => {
    const db = getDb();

    const googleKey = encrypt('test-google-key');
    db.prepare(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('google', 'disabled', googleKey.encrypted, googleKey.iv, googleKey.authTag, 'healthy', 0);

    const groqKey = encrypt('test-groq-key');
    db.prepare(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('groq', 'test', groqKey.encrypted, groqKey.iv, groqKey.authTag, 'healthy', 1);

    const result = routeRequest();
    expect(result.platform).toBe('groq');
  });

  it('should skip invalid keys', () => {
    const db = getDb();

    const invalidKey = encrypt('invalid-key');
    db.prepare(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('google', 'invalid', invalidKey.encrypted, invalidKey.iv, invalidKey.authTag, 'invalid', 1);

    const groqKey = encrypt('test-groq-key');
    db.prepare(`
      INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run('groq', 'test', groqKey.encrypted, groqKey.iv, groqKey.authTag, 'healthy', 1);

    const result = routeRequest();
    expect(result.platform).toBe('groq');
  });

  it('should track penalties and decay correctly preserving fractional remainders', () => {
    recordRateLimitHit(100);
    let penalties = getAllPenalties();
    expect(penalties.find(p => p.modelDbId === 100)?.penalty).toBe(3);

    const originalDateNow = Date.now;
    const start = Date.now();
    
    // Simulate 3 minutes later (1.5 intervals of 2 mins)
    global.Date.now = () => start + 3 * 60 * 1000;
    
    penalties = getAllPenalties();
    // 1 step decayed: 3 - 1 = 2
    expect(penalties.find(p => p.modelDbId === 100)?.penalty).toBe(2);

    // Simulate 4.5 minutes from start. 
    // Since the first decay advanced the baseline to (start + 2 mins), 
    // at 4.5 minutes, 2.5 minutes have elapsed since the baseline, so it should decay again!
    global.Date.now = () => start + 4.5 * 60 * 1000;
    
    penalties = getAllPenalties();
    // 2nd step decayed: 2 - 1 = 1
    expect(penalties.find(p => p.modelDbId === 100)?.penalty).toBe(1);

    global.Date.now = originalDateNow;
  });

  describe('Circuit Breaker', () => {
    it('should trip after 3 consecutive 5xx/timeout failures and skip platform', () => {
      const db = getDb();

      // Configure keys for Google and Groq
      const googleKey = encrypt('test-google-key');
      db.prepare(`
        INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('google', 'test', googleKey.encrypted, googleKey.iv, googleKey.authTag, 'healthy', 1);

      const groqKey = encrypt('test-groq-key');
      db.prepare(`
        INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run('groq', 'test', groqKey.encrypted, groqKey.iv, groqKey.authTag, 'healthy', 1);

      // Normally Google wins rank 1
      expect(routeRequest().platform).toBe('google');

      // Failure 1: 503 error
      recordPlatformFailure('google', new Error('Google API error 503: Service Unavailable'));
      expect(isCircuitOpen('google')).toBe(false);

      // Failure 2: Timeout error
      recordPlatformFailure('google', new Error('Connection timed out ETIMEDOUT'));
      expect(isCircuitOpen('google')).toBe(false);

      // Failure 3: 500 Internal Server Error -> trips breaker!
      recordPlatformFailure('google', new Error('Google API error 500: Internal Server Error'));
      expect(isCircuitOpen('google')).toBe(true);

      const status = getCircuitBreakerStatus();
      expect(status['google'].consecutiveFailures).toBe(3);
      expect(status['google'].isOpen).toBe(true);

      // Route request should immediately bypass Google and route to Groq!
      const result = routeRequest();
      expect(result.platform).toBe('groq');

      // Success on Groq clears or maintains Groq's breaker
      recordPlatformSuccess('groq');
      expect(isCircuitOpen('groq')).toBe(false);

      // Verify Google breaker resets after 2 minutes
      const origDateNow = Date.now;
      const start = Date.now();
      try {
        global.Date.now = () => start + (2 * 60 * 1000 + 100);
        // After 2 minutes, breaker should allow trial requests (not open)
        expect(isCircuitOpen('google')).toBe(false);
        // Route should now consider Google again
        expect(routeRequest().platform).toBe('google');
      } finally {
        global.Date.now = origDateNow;
      }
    });

    it('should not trip on non-5xx errors like 429 rate limit or 401 auth error', () => {
      recordPlatformFailure('google', new Error('Google API error 429: Resource exhausted'));
      recordPlatformFailure('google', new Error('Google API error 429: Rate limit exceeded'));
      recordPlatformFailure('google', new Error('Google API error 401: Unauthorized'));
      recordPlatformFailure('google', new Error('Google API error 404: Not found'));

      expect(isCircuitOpen('google')).toBe(false);
      expect(getCircuitBreakerStatus()['google']?.consecutiveFailures ?? 0).toBe(0);
    });

    it('should reset consecutive failures on platform success', () => {
      recordPlatformFailure('google', new Error('503 Service Unavailable'));
      recordPlatformFailure('google', new Error('503 Service Unavailable'));
      expect(getCircuitBreakerStatus()['google'].consecutiveFailures).toBe(2);

      // Platform succeeds
      recordPlatformSuccess('google');
      expect(getCircuitBreakerStatus()['google'].consecutiveFailures).toBe(0);
      expect(isCircuitOpen('google')).toBe(false);
    });
  });
});
