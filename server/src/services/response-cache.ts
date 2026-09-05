import crypto from 'crypto';
import { getDb } from '../db/index.js';
import type { ChatCompletionResponse } from '@freellmapi/shared/types.js';

export interface CacheKeyParams {
  messages: any[];
  model?: string;
  temperature?: number;
  top_p?: number;
  tools?: any[];
}

export class ResponseCache {
  private static memoryCache = new Map<string, { response: ChatCompletionResponse; expiresAt: number }>();
  private static readonly TTL_MS = 60 * 60 * 1000; // 1 hour TTL default

  static computeHash(params: CacheKeyParams): string {
    const serialized = JSON.stringify({
      messages: params.messages.map(m => ({ role: m.role, content: m.content })),
      model: params.model,
      temperature: params.temperature,
      top_p: params.top_p,
      tools: params.tools,
    });
    return crypto.createHash('sha256').update(serialized).digest('hex');
  }

  static get(params: CacheKeyParams): ChatCompletionResponse | null {
    const hash = this.computeHash(params);
    const now = Date.now();

    // 1. Check in-memory fast cache
    const mem = this.memoryCache.get(hash);
    if (mem && mem.expiresAt > now) {
      return {
        ...mem.response,
        id: `chatcmpl-cached-${crypto.randomUUID().slice(0, 8)}`,
      };
    }

    // 2. Check SQLite persistent cache
    try {
      const db = getDb();
      // Ensure cache table exists
      db.exec(`
        CREATE TABLE IF NOT EXISTS response_cache (
          hash TEXT PRIMARY KEY,
          response TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          hits INTEGER DEFAULT 1
        );
      `);

      const row = db.prepare('SELECT response, created_at FROM response_cache WHERE hash = ?').get(hash) as any;
      if (row) {
        // Check TTL (3600 seconds)
        const ageSec = Math.floor(now / 1000) - row.created_at;
        if (ageSec < 3600) {
          db.prepare('UPDATE response_cache SET hits = hits + 1 WHERE hash = ?').run(hash);
          const parsed = JSON.parse(row.response);
          this.memoryCache.set(hash, { response: parsed, expiresAt: now + this.TTL_MS });
          return {
            ...parsed,
            id: `chatcmpl-cached-${crypto.randomUUID().slice(0, 8)}`,
          };
        }
      }
    } catch {
      // Ignore DB cache errors gracefully
    }

    return null;
  }

  static set(params: CacheKeyParams, response: ChatCompletionResponse): void {
    // Only cache successful non-empty choices
    if (!response.choices || response.choices.length === 0) return;

    const hash = this.computeHash(params);
    const now = Date.now();

    // Set in-memory cache
    this.memoryCache.set(hash, { response, expiresAt: now + this.TTL_MS });

    // Evict memory cache if it grows too large (> 1000 entries)
    if (this.memoryCache.size > 1000) {
      const oldestKey = this.memoryCache.keys().next().value;
      if (oldestKey) this.memoryCache.delete(oldestKey);
    }

    // Persist to SQLite
    try {
      const db = getDb();
      db.prepare(`
        INSERT OR REPLACE INTO response_cache (hash, response, created_at, hits)
        VALUES (?, ?, ?, 1)
      `).run(hash, JSON.stringify(response), Math.floor(now / 1000));
    } catch {
      // Ignore DB cache errors
    }
  }

  static clear(): void {
    this.memoryCache.clear();
    try {
      const db = getDb();
      db.exec('DELETE FROM response_cache;');
    } catch {
      // Ignore
    }
  }
}
