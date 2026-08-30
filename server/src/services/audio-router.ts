import { getDb } from '../db/index.js';
import { getProvider } from '../providers/index.js';
import { decrypt } from '../lib/crypto.js';
import { TTSEngine } from './tts-engine.js';
import type { BaseProvider } from '../providers/base.js';
import type {
  Platform,
  AudioTranscriptionRequest,
  AudioTranscriptionResponse,
  AudioTranslationRequest,
  AudioTranslationResponse,
  AudioSpeechRequest,
} from '@freellmapi/shared/types.js';

export interface AudioRouteCandidate {
  platform: Platform;
  modelId: string;
  displayName: string;
  provider: BaseProvider;
  apiKey: string;
  keyId?: number;
  modelDbId?: number;
}

export class AudioRouter {
  /**
   * Routes audio transcription across Groq Whisper, Cloudflare Whisper, and Gemini Audio.
   */
  static async transcribeAudio(
    request: AudioTranscriptionRequest,
  ): Promise<AudioTranscriptionResponse> {
    const audioBuffer = Buffer.isBuffer(request.file)
      ? request.file
      : Buffer.from(request.file);
    const filename = request.filename || 'audio.mp3';
    const requestedModel = request.model?.trim().toLowerCase();

    const candidates = this.getSTTCandidates(requestedModel);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < candidates.length; attempt++) {
      const candidate = candidates[attempt];
      try {
        if (candidate.provider.transcribeAudio) {
          const res = await candidate.provider.transcribeAudio(
            candidate.apiKey,
            audioBuffer,
            filename,
            candidate.modelId,
            request as unknown as Record<string, unknown>,
          );

          return {
            text: res.text || '',
            task: 'transcribe',
            language: request.language,
            duration: res.duration,
            segments: res.segments,
            words: res.words,
            _routed_via: {
              platform: candidate.platform,
              model: candidate.modelId,
            },
          };
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`[AudioRouter] Transcribe attempt ${attempt + 1} failed on ${candidate.platform}/${candidate.modelId}:`, err.message);
      }
    }

    // Google Gemini multimodal audio transcription fallback
    try {
      const googleProvider = getProvider('google');
      const db = getDb();
      const googleKeyRow = db.prepare("SELECT * FROM api_keys WHERE platform = 'google' AND enabled = 1 AND status != 'invalid'").get() as any;
      if (googleProvider?.transcribeAudio && googleKeyRow) {
        const realKey = decrypt(googleKeyRow.encrypted_key, googleKeyRow.iv, googleKeyRow.auth_tag);
        const res = await googleProvider.transcribeAudio(
          realKey,
          audioBuffer,
          filename,
          'gemini-2.5-flash',
          request as unknown as Record<string, unknown>,
        );
        return {
          text: res.text || '',
          task: 'transcribe',
          _routed_via: {
            platform: 'google',
            model: 'gemini-2.5-flash',
          },
        };
      }
    } catch (geminiErr: any) {
      console.warn('[AudioRouter] Gemini fallback transcribe failed:', geminiErr.message);
    }

    throw new Error(`All audio transcription providers failed. Last error: ${lastError?.message || 'No transcription keys configured'}`);
  }

  /**
   * Routes audio translation to English.
   */
  static async translateAudio(
    request: AudioTranslationRequest,
  ): Promise<AudioTranslationResponse> {
    const audioBuffer = Buffer.isBuffer(request.file)
      ? request.file
      : Buffer.from(request.file);
    const filename = request.filename || 'audio.mp3';
    const requestedModel = request.model?.trim().toLowerCase();

    const candidates = this.getSTTCandidates(requestedModel);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < candidates.length; attempt++) {
      const candidate = candidates[attempt];
      try {
        if (candidate.provider.translateAudio) {
          const res = await candidate.provider.translateAudio(
            candidate.apiKey,
            audioBuffer,
            filename,
            candidate.modelId,
            request as unknown as Record<string, unknown>,
          );

          return {
            text: res.text || '',
            _routed_via: {
              platform: candidate.platform,
              model: candidate.modelId,
            },
          };
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`[AudioRouter] Translate attempt ${attempt + 1} failed on ${candidate.platform}/${candidate.modelId}:`, err.message);
      }
    }

    // Gemini translate fallback
    try {
      const googleProvider = getProvider('google');
      const db = getDb();
      const googleKeyRow = db.prepare("SELECT * FROM api_keys WHERE platform = 'google' AND enabled = 1 AND status != 'invalid'").get() as any;
      if (googleProvider?.translateAudio && googleKeyRow) {
        const realKey = decrypt(googleKeyRow.encrypted_key, googleKeyRow.iv, googleKeyRow.auth_tag);
        const res = await googleProvider.translateAudio(
          realKey,
          audioBuffer,
          filename,
          'gemini-2.5-flash',
          request as unknown as Record<string, unknown>,
        );
        return {
          text: res.text || '',
          _routed_via: {
            platform: 'google',
            model: 'gemini-2.5-flash',
          },
        };
      }
    } catch (geminiErr: any) {
      console.warn('[AudioRouter] Gemini fallback translate failed:', geminiErr.message);
    }

    throw new Error(`All audio translation providers failed. Last error: ${lastError?.message || 'No translation keys configured'}`);
  }

  /**
   * Routes audio speech generation (TTS).
   */
  static async generateSpeech(
    request: AudioSpeechRequest,
  ): Promise<{ audioBuffer: Buffer; contentType: string }> {
    const input = request.input;
    if (!input || typeof input !== 'string' || input.trim().length === 0) {
      throw new Error('Input text is required for speech synthesis');
    }

    const requestedModel = request.model?.trim().toLowerCase();
    const candidates = this.getTTSCandidates(requestedModel);

    for (let attempt = 0; attempt < candidates.length; attempt++) {
      const candidate = candidates[attempt];
      try {
        if (candidate.provider.generateSpeech) {
          return await candidate.provider.generateSpeech(
            candidate.apiKey,
            input,
            candidate.modelId,
            request as unknown as Record<string, unknown>,
          );
        }
      } catch (err: any) {
        console.warn(`[AudioRouter] TTS attempt ${attempt + 1} failed on ${candidate.platform}/${candidate.modelId}:`, err.message);
      }
    }

    // Direct TTSEngine fallback
    return await TTSEngine.synthesize(request);
  }

  private static getSTTCandidates(requestedModel?: string): AudioRouteCandidate[] {
    const db = getDb();
    const candidates: AudioRouteCandidate[] = [];

    const sttModels = db.prepare(`
      SELECT m.*, fc.priority
      FROM models m
      LEFT JOIN fallback_config fc ON fc.model_db_id = m.id
      WHERE m.enabled = 1 AND m.modality = 'audio_stt'
      ORDER BY COALESCE(fc.priority, m.speed_rank) ASC
    `).all() as any[];

    for (const m of sttModels) {
      if (requestedModel && requestedModel !== 'auto' && requestedModel !== 'whisper-1') {
        const match = m.model_id.toLowerCase() === requestedModel ||
          m.model_id.toLowerCase().includes(requestedModel) ||
          m.display_name.toLowerCase().includes(requestedModel);
        if (!match) continue;
      }

      const provider = getProvider(m.platform as Platform);
      if (!provider || !provider.transcribeAudio) continue;

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

    return candidates;
  }

  private static getTTSCandidates(requestedModel?: string): AudioRouteCandidate[] {
    const db = getDb();
    const candidates: AudioRouteCandidate[] = [];

    const ttsModels = db.prepare(`
      SELECT m.*, fc.priority
      FROM models m
      LEFT JOIN fallback_config fc ON fc.model_db_id = m.id
      WHERE m.enabled = 1 AND m.modality = 'audio_tts'
      ORDER BY COALESCE(fc.priority, m.speed_rank) ASC
    `).all() as any[];

    for (const m of ttsModels) {
      if (requestedModel && requestedModel !== 'auto' && !requestedModel.startsWith('tts-1')) {
        const match = m.model_id.toLowerCase() === requestedModel ||
          m.model_id.toLowerCase().includes(requestedModel) ||
          m.display_name.toLowerCase().includes(requestedModel);
        if (!match) continue;
      }

      const provider = getProvider(m.platform as Platform);
      if (!provider || !provider.generateSpeech) continue;

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

    return candidates;
  }
}
