// In-memory sliding window rate limit tracker

interface Window {
  timestamps: number[];
  tokenCount: number;
  tokenTimestamps: { ts: number; tokens: number }[];
}

// Key format: "platform:modelId:keyId:type" where type is rpm|rpd|tpm|tpd
const windows = new Map<string, Window>();

function getWindow(key: string): Window {
  let w = windows.get(key);
  if (!w) {
    w = { timestamps: [], tokenCount: 0, tokenTimestamps: [] };
    windows.set(key, w);
  }
  return w;
}

function pruneTimestamps(timestamps: number[], windowMs: number, now: number): number[] {
  const cutoff = now - windowMs;
  return timestamps.filter(ts => ts > cutoff);
}

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;

export function canMakeRequest(
  platform: string,
  modelId: string,
  keyId: number,
  limits: { rpm: number | null; rpd: number | null; tpm: number | null; tpd: number | null },
): boolean {
  const now = Date.now();

  if (limits.rpm !== null) {
    const key = `${platform}:${modelId}:${keyId}:rpm`;
    const w = getWindow(key);
    w.timestamps = pruneTimestamps(w.timestamps, MINUTE, now);
    if (w.timestamps.length >= limits.rpm) return false;
  }

  if (limits.rpd !== null) {
    const key = `${platform}:${modelId}:${keyId}:rpd`;
    const w = getWindow(key);
    w.timestamps = pruneTimestamps(w.timestamps, DAY, now);
    if (w.timestamps.length >= limits.rpd) return false;
  }

  return true;
}

export function canUseTokens(
  platform: string,
  modelId: string,
  keyId: number,
  estimatedTokens: number,
  limits: { tpm: number | null; tpd: number | null },
): boolean {
  const now = Date.now();

  if (limits.tpm !== null) {
    const key = `${platform}:${modelId}:${keyId}:tpm`;
    const w = getWindow(key);
    w.tokenTimestamps = w.tokenTimestamps.filter(t => t.ts > now - MINUTE);
    const used = w.tokenTimestamps.reduce((sum, t) => sum + t.tokens, 0);
    if (used + estimatedTokens > limits.tpm) return false;
  }

  if (limits.tpd !== null) {
    const key = `${platform}:${modelId}:${keyId}:tpd`;
    const w = getWindow(key);
    w.tokenTimestamps = w.tokenTimestamps.filter(t => t.ts > now - DAY);
    const used = w.tokenTimestamps.reduce((sum, t) => sum + t.tokens, 0);
    if (used + estimatedTokens > limits.tpd) return false;
  }

  return true;
}

export function recordRequest(platform: string, modelId: string, keyId: number) {
  const now = Date.now();

  const rpmKey = `${platform}:${modelId}:${keyId}:rpm`;
  getWindow(rpmKey).timestamps.push(now);

  const rpdKey = `${platform}:${modelId}:${keyId}:rpd`;
  getWindow(rpdKey).timestamps.push(now);
}

export function recordTokens(
  platform: string,
  modelId: string,
  keyId: number,
  tokens: number,
) {
  const now = Date.now();

  const tpmKey = `${platform}:${modelId}:${keyId}:tpm`;
  getWindow(tpmKey).tokenTimestamps.push({ ts: now, tokens });

  const tpdKey = `${platform}:${modelId}:${keyId}:tpd`;
  getWindow(tpdKey).tokenTimestamps.push({ ts: now, tokens });
}

// Cooldown: when a provider returns 429, block that API key globally for a period
export interface CooldownInfo {
  keyId: number;
  platform: string;
  modelId: string;
  errorMessage: string;
  expiry: number;
}

const cooldowns = new Map<number, CooldownInfo>(); // keyId -> CooldownInfo

export function getCooldownDurationMs(): number {
  if (process.env.COOLDOWN_MS) {
    const ms = parseInt(process.env.COOLDOWN_MS, 10);
    if (!isNaN(ms) && ms > 0) return ms;
  }
  if (process.env.COOLDOWN_MINUTES) {
    const mins = parseFloat(process.env.COOLDOWN_MINUTES);
    if (!isNaN(mins) && mins > 0) return Math.round(mins * 60 * 1000);
  }
  return 3_600_000; // default: 1 hour (60 minutes)
}

export function parseRetryAfterMs(errorMessage: string): number | null {
  if (!errorMessage) return null;
  const msg = errorMessage.toLowerCase();

  // Match e.g. "retry after 12s", "retry-after: 12", "retry after 12 seconds", "try again in 12s", "try again in 12.5 seconds"
  const secMatch = msg.match(/(?:retry[\s_-]?after|try again in|wait)\s*(?:is|:)?\s*(\d+(?:\.\d+)?)\s*(?:s|sec|second|seconds)?\b/);
  if (secMatch) {
    const sec = parseFloat(secMatch[1]);
    if (!isNaN(sec) && sec > 0 && sec < 86400) {
      return Math.ceil(sec * 1000);
    }
  }

  // Match e.g. "try again in 5m", "try again in 5 minutes"
  const minMatch = msg.match(/(?:retry[\s_-]?after|try again in|wait)\s*(?:is|:)?\s*(\d+(?:\.\d+)?)\s*(?:m|min|minute|minutes)\b/);
  if (minMatch) {
    const min = parseFloat(minMatch[1]);
    if (!isNaN(min) && min > 0 && min < 1440) {
      return Math.ceil(min * 60 * 1000);
    }
  }

  return null;
}

export function isRateLimitErrorMessage(msg: string): boolean {
  if (!msg) return false;
  const lower = msg.toLowerCase();
  return lower.includes('429')
    || lower.includes('rate limit')
    || lower.includes('too many requests')
    || lower.includes('quota')
    || lower.includes('resource_exhausted')
    || lower.includes('exceeded your current quota');
}

export function setCooldown(
  platform: string,
  modelId: string,
  keyId: number,
  durationMs?: number,
  errorMessage = '',
) {
  if (!keyId || isNaN(keyId)) return;

  let effectiveDuration = durationMs;
  if (effectiveDuration === undefined) {
    const parsedRetry = parseRetryAfterMs(errorMessage);
    if (parsedRetry !== null) {
      effectiveDuration = parsedRetry;
    } else if (errorMessage && !isRateLimitErrorMessage(errorMessage)) {
      // Do not trigger long rate limit cooldown on non-rate-limit errors (e.g. 5xx, timeouts)
      // Platform-level failures are handled by the Circuit Breaker instead.
      return;
    } else {
      effectiveDuration = getCooldownDurationMs();
    }
  }

  cooldowns.set(keyId, {
    keyId,
    platform,
    modelId,
    errorMessage: errorMessage || 'Transient rate limit or provider error',
    expiry: Date.now() + effectiveDuration,
  });
}

export function removeCooldown(keyId: number): boolean {
  return cooldowns.delete(keyId);
}

export function clearAllCooldowns(): void {
  cooldowns.clear();
}


export function isOnCooldown(platform: string, modelId: string, keyId: number): boolean {
  const info = cooldowns.get(keyId);
  if (!info) return false;
  if (Date.now() >= info.expiry) {
    cooldowns.delete(keyId);
    return false;
  }
  return true;
}

export function getActiveCooldowns(): CooldownInfo[] {
  const now = Date.now();
  const list: CooldownInfo[] = [];
  for (const [keyId, info] of cooldowns.entries()) {
    if (now > info.expiry) {
      cooldowns.delete(keyId);
    } else {
      list.push(info);
    }
  }
  return list;
}

export function getRateLimitStatus(
  platform: string,
  modelId: string,
  keyId: number,
  limits: { rpm: number | null; rpd: number | null; tpm: number | null; tpd: number | null },
) {
  const now = Date.now();

  const rpmW = getWindow(`${platform}:${modelId}:${keyId}:rpm`);
  rpmW.timestamps = pruneTimestamps(rpmW.timestamps, MINUTE, now);

  const rpdW = getWindow(`${platform}:${modelId}:${keyId}:rpd`);
  rpdW.timestamps = pruneTimestamps(rpdW.timestamps, DAY, now);

  const tpmW = getWindow(`${platform}:${modelId}:${keyId}:tpm`);
  tpmW.tokenTimestamps = tpmW.tokenTimestamps.filter(t => t.ts > now - MINUTE);
  const tpmUsed = tpmW.tokenTimestamps.reduce((sum, t) => sum + t.tokens, 0);

  return {
    rpm: { used: rpmW.timestamps.length, limit: limits.rpm },
    rpd: { used: rpdW.timestamps.length, limit: limits.rpd },
    tpm: { used: tpmUsed, limit: limits.tpm },
  };
}
