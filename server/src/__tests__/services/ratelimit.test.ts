import { describe, it, expect, beforeEach } from 'vitest';
import {
  canMakeRequest,
  canUseTokens,
  recordRequest,
  recordTokens,
  getRateLimitStatus,
  setCooldown,
  isOnCooldown,
  removeCooldown,
  clearAllCooldowns,
  getCooldownDurationMs,
} from '../../services/ratelimit.js';

describe('Rate Limiter', () => {
  // Use unique identifiers per test to avoid cross-contamination
  let testId: number;

  beforeEach(() => {
    testId = Math.floor(Math.random() * 1_000_000);
  });

  describe('canMakeRequest', () => {
    it('should allow request when under RPM limit', () => {
      expect(canMakeRequest('groq', 'llama-70b', testId, {
        rpm: 30, rpd: null, tpm: null, tpd: null,
      })).toBe(true);
    });

    it('should deny request when RPM limit reached', () => {
      const limits = { rpm: 2, rpd: null, tpm: null, tpd: null };
      recordRequest('groq', 'llama-70b', testId);
      recordRequest('groq', 'llama-70b', testId);
      expect(canMakeRequest('groq', 'llama-70b', testId, limits)).toBe(false);
    });

    it('should deny request when RPD limit reached', () => {
      const limits = { rpm: null, rpd: 1, tpm: null, tpd: null };
      recordRequest('google', 'gemini', testId);
      expect(canMakeRequest('google', 'gemini', testId, limits)).toBe(false);
    });

    it('should allow request when limits are null (unlimited)', () => {
      expect(canMakeRequest('nvidia', 'nemotron', testId, {
        rpm: null, rpd: null, tpm: null, tpd: null,
      })).toBe(true);
    });
  });

  describe('canUseTokens', () => {
    it('should allow tokens when under TPM limit', () => {
      expect(canUseTokens('groq', 'llama-70b', testId, 500, {
        tpm: 6000, tpd: null,
      })).toBe(true);
    });

    it('should deny tokens when TPM limit would be exceeded', () => {
      recordTokens('cerebras', 'qwen3', testId, 50000);
      expect(canUseTokens('cerebras', 'qwen3', testId, 20000, {
        tpm: 60000, tpd: null,
      })).toBe(false);
    });

    it('should allow when limit is null', () => {
      expect(canUseTokens('nvidia', 'nemotron', testId, 100000, {
        tpm: null, tpd: null,
      })).toBe(true);
    });
  });

  describe('getRateLimitStatus', () => {
    it('should return current usage counts', () => {
      const limits = { rpm: 30, rpd: 1000, tpm: 6000, tpd: null };
      recordRequest('groq', 'test-model', testId);
      recordRequest('groq', 'test-model', testId);
      recordTokens('groq', 'test-model', testId, 500);

      const status = getRateLimitStatus('groq', 'test-model', testId, limits);
      expect(status.rpm.used).toBe(2);
      expect(status.rpm.limit).toBe(30);
      expect(status.rpd.used).toBe(2);
      expect(status.tpm.used).toBe(500);
    });
  });

  describe('Cooldown & Wake-up Management', () => {
    it('should put key on cooldown and check status', () => {
      expect(isOnCooldown('groq', 'llama-70b', testId)).toBe(false);
      setCooldown('groq', 'llama-70b', testId, 60_000, 'Rate limit error');
      expect(isOnCooldown('groq', 'llama-70b', testId)).toBe(true);
    });

    it('should remove specific key from cooldown (Wake Up)', () => {
      setCooldown('groq', 'llama-70b', testId, 60_000, 'Rate limit error');
      expect(isOnCooldown('groq', 'llama-70b', testId)).toBe(true);

      const removed = removeCooldown(testId);
      expect(removed).toBe(true);
      expect(isOnCooldown('groq', 'llama-70b', testId)).toBe(false);
    });

    it('should clear all cooldowns (Wake Up All)', () => {
      const id1 = testId + 1;
      const id2 = testId + 2;
      setCooldown('groq', 'llama-70b', id1, 60_000, 'Error 1');
      setCooldown('google', 'gemini', id2, 60_000, 'Error 2');
      expect(isOnCooldown('groq', 'llama-70b', id1)).toBe(true);
      expect(isOnCooldown('google', 'gemini', id2)).toBe(true);

      clearAllCooldowns();
      expect(isOnCooldown('groq', 'llama-70b', id1)).toBe(false);
      expect(isOnCooldown('google', 'gemini', id2)).toBe(false);
    });

    it('should resolve default cooldown duration to 1 hour (3,600,000 ms) or env setting', () => {
      const originalMinutes = process.env.COOLDOWN_MINUTES;
      const originalMs = process.env.COOLDOWN_MS;
      try {
        delete process.env.COOLDOWN_MS;
        delete process.env.COOLDOWN_MINUTES;
        expect(getCooldownDurationMs()).toBe(3_600_000);

        process.env.COOLDOWN_MINUTES = '15';
        expect(getCooldownDurationMs()).toBe(15 * 60 * 1000);

        process.env.COOLDOWN_MS = '120000';
        expect(getCooldownDurationMs()).toBe(120000);
      } finally {
        if (originalMinutes !== undefined) process.env.COOLDOWN_MINUTES = originalMinutes;
        else delete process.env.COOLDOWN_MINUTES;

        if (originalMs !== undefined) process.env.COOLDOWN_MS = originalMs;
        else delete process.env.COOLDOWN_MS;
      }
    });
  });
});

