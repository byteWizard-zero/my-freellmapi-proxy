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

  /**
   * Normalizes a text string by trimming whitespace, normalizing newline endings,
   * collapsing redundant whitespace, and case-normalizing trivial messages.
   */
  static normalizeString(text: string, role: string = 'user'): string {
    if (!text) return '';

    // 1. Normalize line endings and trim leading/trailing whitespace
    let normalized = text.replace(/\r\n/g, '\n').trim();

    // 2. Collapse internal runs of spaces/tabs (preserve newlines)
    normalized = normalized.replace(/[ \t]+/g, ' ');

    // 3. Trim whitespace around newlines
    normalized = normalized.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n');

    const lowerRole = role.toLowerCase();

    // 4. System prompt normalization: lowercasing trivial system variations
    if (lowerRole === 'system') {
      return normalized.toLowerCase();
    }

    // 5. Trivial message normalization:
    // For short messages without code syntax or identifiers, normalize to lower case
    const isCode = /```|[{};=<>]|\b(function|def|class|const|let|var|import|SELECT|git)\b/i.test(normalized);
    if (!isCode && normalized.length < 120) {
      return normalized.toLowerCase();
    }

    return normalized;
  }

  /**
   * Recursively normalizes message content.
   */
  static normalizeContent(content: any, role: string = 'user'): any {
    if (typeof content === 'string') {
      return this.normalizeString(content, role);
    }
    if (Array.isArray(content)) {
      return content.map(part => {
        if (part && typeof part === 'object') {
          if (part.type === 'text' && typeof part.text === 'string') {
            return { ...part, text: this.normalizeString(part.text, role) };
          }
        }
        return part;
      });
    }
    return content;
  }

  /**
   * Normalizes cache key parameters to maximize cache hit rates across near-identical queries.
   */
  static normalizeParams(params: CacheKeyParams): any {
    const messages = (params.messages || []).map(m => {
      const role = (m.role || 'user').trim().toLowerCase();
      return {
        role,
        content: this.normalizeContent(m.content, role),
      };
    });

    const model = params.model ? params.model.trim().toLowerCase() : 'auto';
    const temperature = typeof params.temperature === 'number' ? Math.round(params.temperature * 1000) / 1000 : undefined;
    const top_p = typeof params.top_p === 'number' ? Math.round(params.top_p * 1000) / 1000 : undefined;
    const tools = params.tools && params.tools.length > 0 ? params.tools : undefined;

    return {
      messages,
      model,
      temperature,
      top_p,
      tools,
    };
  }

  static computeHash(params: CacheKeyParams): string {
    const normalized = this.normalizeParams(params);
    const serialized = JSON.stringify(normalized);
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
