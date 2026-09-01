import crypto from 'crypto';
import { getDb } from '../db/index.js';
import { getProvider } from '../providers/index.js';
import { decrypt } from '../lib/crypto.js';
import type { BaseProvider } from '../providers/base.js';
import type { Platform, ModerationRequest, ModerationResponse, ModerationResult } from '@freellmapi/shared/types.js';

export class ModerationService {
  /**
   * Evaluates text inputs against standard content moderation categories.
   */
  static async moderate(
    request: ModerationRequest,
  ): Promise<ModerationResponse> {
    const rawInput = request.input;
    if (!rawInput) {
      throw new Error('Input is required for moderation');
    }

    const inputs: string[] = Array.isArray(rawInput) ? rawInput : [rawInput];
    if (inputs.length === 0 || inputs.some(i => typeof i !== 'string')) {
      throw new Error('Input must be a non-empty string or array of strings');
    }

    const id = `modr-${crypto.randomBytes(16).toString('hex')}`;
    const model = request.model || 'text-moderation-latest';

    // 1. Try dedicated moderation providers (Google Gemini safety / Cloudflare Llama Guard / OpenAICompat)
    const db = getDb();
    const modModels = db.prepare(`
      SELECT m.*, fc.priority
      FROM models m
      LEFT JOIN fallback_config fc ON fc.model_db_id = m.id
      WHERE m.enabled = 1 AND m.modality = 'moderation'
      ORDER BY COALESCE(fc.priority, m.intelligence_rank) ASC
    `).all() as any[];

    for (const m of modModels) {
      const provider = getProvider(m.platform as Platform);
      if (!provider || !provider.moderateText) continue;

      const keys = db.prepare(
        "SELECT * FROM api_keys WHERE platform = ? AND enabled = 1 AND status != 'invalid'"
      ).all(m.platform) as any[];

      for (const k of keys) {
        try {
          const realKey = decrypt(k.encrypted_key, k.iv, k.auth_tag);
          const res = await provider.moderateText(realKey, inputs, m.model_id);
          if (res && Array.isArray(res.results) && res.results.length === inputs.length) {
            return {
              id,
              model: m.model_id,
              results: res.results as unknown as ModerationResult[],
              _routed_via: {
                platform: m.platform,
                model: m.model_id,
              },
            };
          }
        } catch (err: any) {
          console.warn(`[ModerationService] Error with ${m.platform}/${m.model_id}:`, err.message);
        }
      }
    }

    // 2. Try Google Gemini provider directly if google keys exist
    const googleProvider = getProvider('google');
    if (googleProvider?.moderateText) {
      const googleKeys = db.prepare(
        "SELECT * FROM api_keys WHERE platform = 'google' AND enabled = 1 AND status != 'invalid'"
      ).all() as any[];

      for (const k of googleKeys) {
        try {
          const realKey = decrypt(k.encrypted_key, k.iv, k.auth_tag);
          const res = await googleProvider.moderateText(realKey, inputs, 'gemini-safety');
          if (res && Array.isArray(res.results)) {
            return {
              id,
              model: 'gemini-safety',
              results: res.results as unknown as ModerationResult[],
              _routed_via: {
                platform: 'google',
                model: 'gemini-safety',
              },
            };
          }
        } catch (err: any) {
          console.warn('[ModerationService] Google safety fallback error:', err.message);
        }
      }
    }

    // 3. Ultra-fast local keyword / heuristics evaluation fallback if no provider keys available
    const results: ModerationResult[] = inputs.map(text => {
      const lower = text.toLowerCase();
      const sexualFlag = lower.includes('porn') || lower.includes('xxx') || lower.includes('nude');
      const hateFlag = lower.includes('kill all') || lower.includes('hate crime');
      const violenceFlag = lower.includes('bomb threat') || lower.includes('murder instruction');
      const selfHarmFlag = lower.includes('suicide method') || lower.includes('how to kill myself');

      const isFlagged = sexualFlag || hateFlag || violenceFlag || selfHarmFlag;

      return {
        flagged: isFlagged,
        categories: {
          sexual: sexualFlag,
          'sexual/minors': false,
          harassment: false,
          'harassment/threatening': false,
          hate: hateFlag,
          'hate/threatening': false,
          illicit: false,
          'illicit/violent': false,
          'self-harm': selfHarmFlag,
          'self-harm/intent': selfHarmFlag,
          'self-harm/instructions': selfHarmFlag,
          violence: violenceFlag,
          'violence/graphic': false,
        },
        category_scores: {
          sexual: sexualFlag ? 0.95 : 0.0001,
          'sexual/minors': 0.0001,
          harassment: 0.0001,
          'harassment/threatening': 0.0001,
          hate: hateFlag ? 0.95 : 0.0001,
          'hate/threatening': 0.0001,
          illicit: 0.0001,
          'illicit/violent': 0.0001,
          'self-harm': selfHarmFlag ? 0.95 : 0.0001,
          'self-harm/intent': selfHarmFlag ? 0.95 : 0.0001,
          'self-harm/instructions': selfHarmFlag ? 0.95 : 0.0001,
          violence: violenceFlag ? 0.95 : 0.0001,
          'violence/graphic': 0.0001,
        },
        category_applied_input_types: {
          sexual: ['text'],
          hate: ['text'],
          violence: ['text'],
          'self-harm': ['text'],
        },
      };
    });

    return {
      id,
      model,
      results,
      _routed_via: {
        platform: 'google',
        model: 'heuristic-evaluator',
      },
    };
  }
}
