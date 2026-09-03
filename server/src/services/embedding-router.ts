import { getDb } from '../db/index.js';
import { getProvider } from '../providers/index.js';
import { decrypt } from '../lib/crypto.js';
import type { BaseProvider } from '../providers/base.js';
import type { Platform, EmbeddingRequest, EmbeddingResponse } from '@freellmapi/shared/types.js';

export interface EmbeddingRouteCandidate {
  platform: Platform;
  modelId: string;
  displayName: string;
  provider: BaseProvider;
  apiKey: string;
  keyId?: number;
  modelDbId?: number;
}

export class EmbeddingRouter {
  /**
   * Dispatches an embedding request across free embedding providers with automatic failover.
   */
  static async generateEmbeddings(
    request: EmbeddingRequest,
  ): Promise<EmbeddingResponse> {
    const rawInput = request.input;
    if (!rawInput) {
      throw new Error('Input is required for embeddings');
    }

    const inputs: string[] = Array.isArray(rawInput) ? rawInput : [rawInput];
    if (inputs.length === 0 || inputs.some(i => typeof i !== 'string')) {
      throw new Error('Input must be a non-empty string or array of strings');
    }

    const requestedModel = request.model?.trim().toLowerCase();
    const candidates = this.getCandidates(requestedModel);

    if (candidates.length === 0) {
      throw new Error(`No embedding providers or keys available for model '${request.model || 'auto'}'`);
    }

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < candidates.length; attempt++) {
      const candidate = candidates[attempt];
      try {
        if (candidate.provider.generateEmbeddings) {
          const res = await candidate.provider.generateEmbeddings(
            candidate.apiKey,
            inputs,
            candidate.modelId,
            request as unknown as Record<string, unknown>,
          );

          return {
            object: 'list',
            data: res.data.map((d, idx) => ({
              object: 'embedding',
              index: d.index !== undefined ? d.index : idx,
              embedding: d.embedding,
            })),
            model: candidate.modelId,
            usage: res.usage,
            _routed_via: {
              platform: candidate.platform,
              model: candidate.modelId,
            },
          };
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`[EmbeddingRouter] Attempt ${attempt + 1} failed on ${candidate.platform}/${candidate.modelId}:`, err.message);
      }
    }

    throw new Error(`All embedding providers failed. Last error: ${lastError?.message || 'No providers available'}`);
  }

  private static getCandidates(requestedModel?: string): EmbeddingRouteCandidate[] {
    const db = getDb();
    const candidates: EmbeddingRouteCandidate[] = [];

    // Query active embedding models
    const embeddingModels = db.prepare(`
      SELECT m.*, fc.priority
      FROM models m
      LEFT JOIN fallback_config fc ON fc.model_db_id = m.id
      WHERE m.enabled = 1 AND m.modality = 'embedding'
      ORDER BY COALESCE(fc.priority, m.intelligence_rank) ASC
    `).all() as any[];

    const primaryCandidates: EmbeddingRouteCandidate[] = [];
    const fallbackCandidates: EmbeddingRouteCandidate[] = [];

    for (const m of embeddingModels) {
      let isMatch = true;
      if (requestedModel && requestedModel !== 'auto' && !requestedModel.startsWith('text-embedding-3') && !requestedModel.startsWith('text-embedding-ada')) {
        isMatch = m.model_id.toLowerCase() === requestedModel ||
          m.model_id.toLowerCase().includes(requestedModel) ||
          m.display_name.toLowerCase().includes(requestedModel) ||
          (requestedModel === 'text-embedding-004' && m.model_id === 'gemini-embedding-001') ||
          (requestedModel === 'gemini-embedding-001' && m.model_id === 'text-embedding-004');
      }

      const provider = getProvider(m.platform as Platform);
      if (!provider || !provider.generateEmbeddings) continue;

      // Find healthy keys for this platform
      const keys = db.prepare(
        "SELECT * FROM api_keys WHERE platform = ? AND enabled = 1 AND status != 'invalid'"
      ).all(m.platform) as any[];

      for (const k of keys) {
        try {
          const realKey = decrypt(k.encrypted_key, k.iv, k.auth_tag);
          const candidate: EmbeddingRouteCandidate = {
            platform: m.platform,
            modelId: m.model_id,
            displayName: m.display_name,
            provider,
            apiKey: realKey,
            keyId: k.id,
            modelDbId: m.id,
          };
          if (isMatch) {
            primaryCandidates.push(candidate);
          } else {
            fallbackCandidates.push(candidate);
          }
        } catch {
          // Ignore key decryption errors
        }
      }
    }

    return [...primaryCandidates, ...fallbackCandidates];
  }
}
