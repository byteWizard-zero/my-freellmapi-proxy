import { getDb } from '../db/index.js';
import { getProvider } from '../providers/index.js';
import { decrypt } from '../lib/crypto.js';
import { canMakeRequest, canUseTokens, isOnCooldown } from './ratelimit.js';
import type { BaseProvider } from '../providers/base.js';

interface ModelRow {
  id: number;
  platform: string;
  model_id: string;
  display_name: string;
  rpm_limit: number | null;
  rpd_limit: number | null;
  tpm_limit: number | null;
  tpd_limit: number | null;
}

interface KeyRow {
  id: number;
  platform: string;
  encrypted_key: string;
  iv: string;
  auth_tag: string;
  status: string;
  enabled: number;
}

interface FallbackRow {
  model_db_id: number;
  priority: number;
  enabled: number;
}

export interface RouteResult {
  provider: BaseProvider;
  modelId: string;
  modelDbId: number;
  apiKey: string;
  keyId: number;
  platform: string;
  displayName: string;
}

// Round-robin index per platform
const roundRobinIndex = new Map<string, number>();

// ── Dynamic priority: track 429s per model and demote accordingly ──
// Key: model_db_id → { count, lastHit, penalty }
const rateLimitPenalties = new Map<number, { count: number; lastHit: number; penalty: number }>();

// Penalty decays over time so models recover
const PENALTY_PER_429 = 3;        // each 429 adds this many priority positions
const MAX_PENALTY = 10;            // cap so a model doesn't sink forever
const DECAY_INTERVAL_MS = 2 * 60 * 1000; // penalty decays every 2 minutes
const DECAY_AMOUNT = 1;            // remove this much penalty per decay interval

/**
 * Record a 429 for a model — increases its penalty so it sinks in priority.
 */
export function recordRateLimitHit(modelDbId: number) {
  const existing = rateLimitPenalties.get(modelDbId);
  const now = Date.now();
  if (existing) {
    existing.count++;
    existing.lastHit = now;
    existing.penalty = Math.min(existing.penalty + PENALTY_PER_429, MAX_PENALTY);
  } else {
    rateLimitPenalties.set(modelDbId, { count: 1, lastHit: now, penalty: PENALTY_PER_429 });
  }
}

// ── Circuit Breaker: track consecutive 5xx/timeout failures per platform ──
interface CircuitBreakerState {
  consecutiveFailures: number;
  trippedUntil: number | null;
}

const circuitBreakers = new Map<string, CircuitBreakerState>();
const CIRCUIT_FAILURE_THRESHOLD = 3;
const CIRCUIT_TRIP_DURATION_MS = 2 * 60 * 1000; // 2 minutes

export function is5xxOrTimeoutError(err: any): boolean {
  if (!err) return false;
  const status = typeof err.status === 'number' ? err.status : (typeof err.statusCode === 'number' ? err.statusCode : undefined);
  if (status && status >= 500 && status < 600) return true;

  const msg = String(err.message || err || '').toLowerCase();
  const code = String(err.code || '').toLowerCase();
  const name = String(err.name || '').toLowerCase();

  // 5xx status codes
  if (/\b5\d{2}\b/.test(msg)) return true;

  // Timeout indicators
  if (name.includes('timeout') || code.includes('timeout') || code === 'etimedout' || code === 'esockettimedout') return true;
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('etimedout')) return true;
  if (msg.includes('gateway timeout') || msg.includes('bad gateway') || msg.includes('service unavailable')) return true;
  if (msg.includes('internal server error') || msg.includes('server error')) return true;
  if (code === 'econnreset' || code === 'econnrefused' || msg.includes('econnreset') || msg.includes('econnrefused')) return true;

  return false;
}

export function isCircuitOpen(platform: string): boolean {
  const cb = circuitBreakers.get(platform);
  if (!cb || cb.trippedUntil === null) return false;
  if (Date.now() >= cb.trippedUntil) {
    // Cooldown expired: allow trial attempt (half-open)
    cb.trippedUntil = null;
    return false;
  }
  return true;
}

export function recordPlatformFailure(platform: string, error?: any): void {
  if (error && !is5xxOrTimeoutError(error)) {
    return;
  }
  let cb = circuitBreakers.get(platform);
  if (!cb) {
    cb = { consecutiveFailures: 0, trippedUntil: null };
    circuitBreakers.set(platform, cb);
  }
  cb.consecutiveFailures++;
  if (cb.consecutiveFailures >= CIRCUIT_FAILURE_THRESHOLD) {
    cb.trippedUntil = Date.now() + CIRCUIT_TRIP_DURATION_MS;
    console.warn(`[Router] Circuit breaker tripped for platform '${platform}' after ${cb.consecutiveFailures} consecutive 5xx/timeout failures. Tripped for 2 minutes.`);
  }
}

export function recordPlatformSuccess(platform: string): void {
  const cb = circuitBreakers.get(platform);
  if (cb) {
    cb.consecutiveFailures = 0;
    cb.trippedUntil = null;
  }
}

export function resetCircuitBreakers(): void {
  circuitBreakers.clear();
}

export function getCircuitBreakerStatus(): Record<string, { consecutiveFailures: number; isOpen: boolean; trippedUntil: number | null }> {
  const now = Date.now();
  const status: Record<string, { consecutiveFailures: number; isOpen: boolean; trippedUntil: number | null }> = {};
  for (const [platform, cb] of circuitBreakers) {
    const isOpen = cb.trippedUntil !== null && cb.trippedUntil > now;
    status[platform] = {
      consecutiveFailures: cb.consecutiveFailures,
      isOpen,
      trippedUntil: isOpen ? cb.trippedUntil : null,
    };
  }
  return status;
}

/**
 * Record a success for a model — reduces its penalty so it rises back up,
 * and clears any consecutive failure counter on the platform's circuit breaker.
 */
export function recordSuccess(modelDbId: number, platform?: string) {
  const existing = rateLimitPenalties.get(modelDbId);
  if (existing) {
    existing.penalty = Math.max(0, existing.penalty - 1);
    if (existing.penalty === 0) {
      rateLimitPenalties.delete(modelDbId);
    }
  }

  if (platform) {
    recordPlatformSuccess(platform);
  } else {
    try {
      const db = getDb();
      const row = db.prepare('SELECT platform FROM models WHERE id = ?').get(modelDbId) as { platform: string } | undefined;
      if (row?.platform) {
        recordPlatformSuccess(row.platform);
      }
    } catch {
      // db might not be initialized in isolated unit tests
    }
  }
}

/**
 * Get the current penalty for a model (with time-based decay).
 */
function getPenalty(modelDbId: number): number {
  const entry = rateLimitPenalties.get(modelDbId);
  if (!entry) return 0;

  // Apply time-based decay
  const now = Date.now();
  const elapsed = now - entry.lastHit;
  const decaySteps = Math.floor(elapsed / DECAY_INTERVAL_MS);
  if (decaySteps > 0) {
    entry.penalty = Math.max(0, entry.penalty - (decaySteps * DECAY_AMOUNT));
    entry.lastHit = entry.lastHit + (decaySteps * DECAY_INTERVAL_MS);
    if (entry.penalty === 0) {
      rateLimitPenalties.delete(modelDbId);
      return 0;
    }
  }

  return entry.penalty;
}

/**
 * Get current penalties for all models (for the API/dashboard).
 */
export function getAllPenalties(): Array<{ modelDbId: number; count: number; penalty: number }> {
  const result: Array<{ modelDbId: number; count: number; penalty: number }> = [];
  for (const [modelDbId, entry] of rateLimitPenalties) {
    const penalty = getPenalty(modelDbId);
    if (penalty > 0) {
      result.push({ modelDbId, count: entry.count, penalty });
    }
  }
  return result.sort((a, b) => b.penalty - a.penalty);
}

/**
 * Route a request to the best available model.
 * Models are sorted by (base_priority + rate_limit_penalty) so frequently
 * rate-limited models automatically sink below working ones.
 *
 * If preferredModelDbId is set, that model gets tried FIRST (sticky sessions).
 * This prevents hallucination from model switching mid-conversation.
 *
 * @param estimatedTokens - estimated total tokens for rate limit check
 * @param skipKeys - set of "platform:modelId:keyId" to skip (failed on this request)
 * @param preferredModelDbId - try this model first (sticky session)
 * @param forceModel - if true, only route to preferredModelDbId and do not fall back
 */
export function routeRequest(
  estimatedTokens = 1000,
  skipKeys?: Set<string>,
  preferredModelDbId?: number,
  forceModel?: boolean,
  hasImage?: boolean,
): RouteResult {
  const db = getDb();

  // Get fallback chain ordered by priority
  const fallbackChain = db.prepare(`
    SELECT fc.model_db_id, fc.priority, fc.enabled
    FROM fallback_config fc
    ORDER BY fc.priority ASC
  `).all() as FallbackRow[];

  // Apply dynamic penalties: sort by (base priority + penalty)
  const sortedChain = fallbackChain.map(entry => ({
    ...entry,
    effectivePriority: entry.priority + getPenalty(entry.model_db_id),
  })).sort((a, b) => a.effectivePriority - b.effectivePriority);

  let chain = sortedChain;

  // Sticky session: move preferred model to front of chain (or filter if forced)
  if (preferredModelDbId) {
    if (forceModel) {
      chain = sortedChain.filter(e => e.model_db_id === preferredModelDbId);
    } else {
      const idx = sortedChain.findIndex(e => e.model_db_id === preferredModelDbId);
      if (idx > 0) {
        const [preferred] = sortedChain.splice(idx, 1);
        sortedChain.unshift(preferred);
      }
    }
  }

  for (const entry of chain) {
    if (!entry.enabled) continue;

    // Get model details
    const model = db.prepare('SELECT * FROM models WHERE id = ? AND enabled = 1').get(entry.model_db_id) as ModelRow | undefined;
    if (!model) continue;

    // Circuit Breaker: skip platform if its circuit is open (unless forced)
    if (!forceModel && isCircuitOpen(model.platform)) {
      continue;
    }

    // If request contains an image, restrict to vision-capable models
    if (hasImage) {
      const isVisionCapable = (model as any).modality === 'vision' ||
        model.platform === 'google' ||
        model.model_id.includes('vision') ||
        model.model_id.includes('pixtral') ||
        model.model_id.includes('gpt-4o') ||
        model.model_id.includes('glm-4v');
      if (!isVisionCapable) continue;
    }

    // Check if we have a provider for this platform
    const provider = getProvider(model.platform as any);
    if (!provider) continue;

    // Get all healthy, enabled keys for this platform
    const keys = db.prepare(
      'SELECT * FROM api_keys WHERE platform = ? AND enabled = 1 AND status != ?'
    ).all(model.platform, 'invalid') as KeyRow[];

    if (keys.length === 0) continue;

    // Get limits once for this model
    const limits = {
      rpm: model.rpm_limit,
      rpd: model.rpd_limit,
      tpm: model.tpm_limit,
      tpd: model.tpd_limit,
    };

    // Try all keys for this model before giving up on it
    const rrKey = `${model.platform}:${model.model_id}`;
    let idx = roundRobinIndex.get(rrKey) ?? 0;

    for (let attempt = 0; attempt < keys.length; attempt++) {
      const key = keys[idx % keys.length];
      idx++;

      const skipId = `${model.platform}:${model.model_id}:${key.id}`;
      if (skipKeys?.has(skipId)) continue;

      // Check cooldown (from previous 429s)
      if (isOnCooldown(model.platform, model.model_id, key.id)) continue;

      if (!canMakeRequest(model.platform, model.model_id, key.id, limits)) continue;
      if (!canUseTokens(model.platform, model.model_id, key.id, estimatedTokens, limits)) continue;

      // We found a working key for this model!
      roundRobinIndex.set(rrKey, idx);
      const decryptedKey = decrypt(key.encrypted_key, key.iv, key.auth_tag);

      return {
        provider,
        modelId: model.model_id,
        modelDbId: model.id,
        apiKey: decryptedKey,
        keyId: key.id,
        platform: model.platform,
        displayName: model.display_name,
      };
    }

    // If we reach here, this specific model has NO available keys.
    // Update round-robin index even if we failed so we don't get stuck.
    roundRobinIndex.set(rrKey, idx);
    
    // We don't explicitly penalize the model here because the fact that we 
    // couldn't find a key means we will naturally move to the next model 
    // in the `sortedChain` for THIS specific request.
  }

  const err = new Error('All models exhausted. Add more API keys or wait for rate limits to reset.') as any;
  err.status = 429;
  throw err;
}
