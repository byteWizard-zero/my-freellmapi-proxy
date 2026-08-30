import { getDb } from '../db/index.js';
import { getProvider } from '../providers/index.js';
import { decrypt } from '../lib/crypto.js';
import type { BaseProvider } from '../providers/base.js';
import type { Platform, ImageGenerationRequest, ImageGenerationResponse } from '@freellmapi/shared/types.js';

export interface ImageRouteCandidate {
  platform: Platform;
  modelId: string;
  displayName: string;
  provider: BaseProvider;
  apiKey: string;
  keyId?: number;
  modelDbId?: number;
}

export class ImageRouter {
  /**
   * Dispatches an image generation request across free image providers with automatic failover.
   */
  static async generateImage(
    request: ImageGenerationRequest,
    options?: { signal?: AbortSignal },
  ): Promise<ImageGenerationResponse> {
    const prompt = request.prompt;
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
      throw new Error('Prompt is required for image generation');
    }

    const requestedModel = request.model?.trim().toLowerCase();
    const candidates = this.getCandidates(requestedModel);

    let lastError: Error | null = null;
    for (let attempt = 0; attempt < candidates.length; attempt++) {
      const candidate = candidates[attempt];
      try {
        if (candidate.provider.generateImage) {
          const res = await candidate.provider.generateImage(
            candidate.apiKey,
            prompt,
            candidate.modelId,
            request as unknown as Record<string, unknown>,
          );

          return {
            created: res.created || Math.floor(Date.now() / 1000),
            data: res.data,
            _routed_via: {
              platform: candidate.platform,
              model: candidate.modelId,
            },
          };
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`[ImageRouter] Attempt ${attempt + 1} failed on ${candidate.platform}/${candidate.modelId}:`, err.message);
      }
    }

    // If all configured providers failed (or none were configured), fall back to Pollinations AI
    try {
      const pollinationsProvider = getProvider('pollinations');
      if (pollinationsProvider?.generateImage) {
        const res = await pollinationsProvider.generateImage(
          'anonymous',
          prompt,
          'flux',
          request as unknown as Record<string, unknown>,
        );

        return {
          created: res.created || Math.floor(Date.now() / 1000),
          data: res.data,
          _routed_via: {
            platform: 'pollinations',
            model: 'flux',
          },
        };
      }
    } catch (fallbackErr: any) {
      console.error('[ImageRouter] Pollinations fallback also failed:', fallbackErr.message);
    }

    throw new Error(`All image generation providers failed. Last error: ${lastError?.message || 'No providers available'}`);
  }

  private static getCandidates(requestedModel?: string): ImageRouteCandidate[] {
    const db = getDb();
    const candidates: ImageRouteCandidate[] = [];

    // Query active image models
    const imageModels = db.prepare(`
      SELECT m.*, fc.priority
      FROM models m
      LEFT JOIN fallback_config fc ON fc.model_db_id = m.id
      WHERE m.enabled = 1 AND m.modality = 'image'
      ORDER BY COALESCE(fc.priority, m.intelligence_rank) ASC
    `).all() as any[];

    for (const m of imageModels) {
      // If a specific model was requested (and not 'auto' or 'dall-e-*'), match it
      if (requestedModel && requestedModel !== 'auto' && !requestedModel.startsWith('dall-e')) {
        const match = m.model_id.toLowerCase() === requestedModel ||
          m.model_id.toLowerCase().includes(requestedModel) ||
          m.display_name.toLowerCase().includes(requestedModel);
        if (!match) continue;
      }

      const provider = getProvider(m.platform as Platform);
      if (!provider || !provider.generateImage) continue;

      if (m.platform === 'pollinations') {
        candidates.push({
          platform: m.platform,
          modelId: m.model_id,
          displayName: m.display_name,
          provider,
          apiKey: 'anonymous',
          modelDbId: m.id,
        });
        continue;
      }

      // Find healthy keys for this platform
      const keys = db.prepare(
        "SELECT * FROM api_keys WHERE platform = ? AND enabled = 1 AND status != 'invalid'"
      ).all(m.platform) as any[];

      for (const k of keys) {
        try {
          const realKey = decrypt(k.encrypted_key, k.iv, k.auth_tag);
          candidates.push({
            platform: m.platform,
            modelId: m.model_id,
            displayName: m.display_name,
            provider,
            apiKey: realKey,
            keyId: k.id,
            modelDbId: m.id,
          });
        } catch {
          // Ignore key decryption errors
        }
      }
    }

    // Always ensure Pollinations is at least in candidate list as zero-auth fallback
    const pollinationsProvider = getProvider('pollinations');
    if (pollinationsProvider?.generateImage && !candidates.some(c => c.platform === 'pollinations')) {
      candidates.push({
        platform: 'pollinations',
        modelId: 'flux',
        displayName: 'Pollinations Flux',
        provider: pollinationsProvider,
        apiKey: 'anonymous',
      });
    }

    return candidates;
  }
}
