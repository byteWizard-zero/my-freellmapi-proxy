export interface TTSSpeechOptions {
  model?: string;
  input: string;
  voice?: string;
  response_format?: string;
  speed?: number;
}

export class TTSEngine {
  /**
   * Synthesizes text to speech with automatic fallback.
   */
  static async synthesize(options: TTSSpeechOptions): Promise<{ audioBuffer: Buffer; contentType: string }> {
    const { input, voice = 'alloy', speed = 1.0 } = options;
    const format = options.response_format ?? 'mp3';

    // 1. Try Pollinations OpenAI Audio voice API (free, high quality neural voices)
    try {
      const voiceParam = encodeURIComponent(voice);
      const inputParam = encodeURIComponent(input);
      const url = `https://text.pollinations.ai/${inputParam}?model=openai-audio&voice=${voiceParam}`;
      
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 20000);
      try {
        const res = await fetch(url, {
          method: 'GET',
          signal: controller.signal,
        });

        if (res.ok) {
          const arrBuf = await res.arrayBuffer();
          if (arrBuf.byteLength > 100) {
            return {
              audioBuffer: Buffer.from(arrBuf),
              contentType: res.headers.get('content-type') || (format === 'wav' ? 'audio/wav' : 'audio/mpeg'),
            };
          }
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch (e: any) {
      console.warn('[TTSEngine] Pollinations audio failed, trying fallback:', e.message);
    }

    // 2. Fallback: Google Translate TTS API (universal, reliable backup)
    try {
      const lang = 'en';
      const encodedText = encodeURIComponent(input.slice(0, 500)); // Google TTS supports up to 500 chars per chunk
      const url = `https://translate.google.com/translate_tts?ie=UTF-8&q=${encodedText}&tl=${lang}&client=tw-ob`;
      
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch(url, {
          method: 'GET',
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          },
          signal: controller.signal,
        });

        if (res.ok) {
          const arrBuf = await res.arrayBuffer();
          return {
            audioBuffer: Buffer.from(arrBuf),
            contentType: 'audio/mpeg',
          };
        }
      } finally {
        clearTimeout(timeout);
      }
    } catch (e: any) {
      console.error('[TTSEngine] Fallback TTS failed:', e.message);
    }

    throw new Error('All TTS synthesis providers failed to generate audio');
  }
}
