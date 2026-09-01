import type {
  ChatMessage,
  ChatCompletionResponse,
  ChatCompletionChunk,
  Platform,
} from '@freellmapi/shared/types.js';
import { BaseProvider, type CompletionOptions } from './base.js';

/**
 * Generic provider for platforms that use an OpenAI-compatible API.
 * Covers: Groq, Cerebras, SambaNova, NVIDIA NIM, Mistral, OpenRouter,
 * GitHub Models, Fireworks AI.
 */
export class OpenAICompatProvider extends BaseProvider {
  readonly platform: Platform;
  readonly name: string;
  private readonly baseUrl: string;
  private readonly extraHeaders: Record<string, string>;
  private readonly validateUrl?: string;
  /** Per-provider HTTP timeout override. Cloud APIs finish in ~15s; locally-hosted
   * inference (llama.cpp / vLLM on CPU) can take 30-120s for long prompts. Default 15000. */
  private readonly timeoutMs: number;

  constructor(opts: {
    platform: Platform;
    name: string;
    baseUrl: string;
    extraHeaders?: Record<string, string>;
    validateUrl?: string;
    timeoutMs?: number;
  }) {
    super();
    this.platform = opts.platform;
    this.name = opts.name;
    this.baseUrl = opts.baseUrl;
    this.extraHeaders = opts.extraHeaders ?? {};
    this.validateUrl = opts.validateUrl;
    this.timeoutMs = opts.timeoutMs ?? 15000;
  }

  async chatCompletion(
    apiKey: string,
    messages: ChatMessage[],
    modelId: string,
    options?: CompletionOptions,
  ): Promise<ChatCompletionResponse> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...this.extraHeaders,
      },
      body: JSON.stringify({
        model: modelId,
        messages,
        temperature: options?.temperature,
        max_tokens: options?.max_tokens,
        top_p: options?.top_p,
        tools: options?.tools,
        tool_choice: options?.tool_choice,
        parallel_tool_calls: options?.parallel_tool_calls,
        response_format: options?.response_format,
      }),
    }, this.timeoutMs);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`${this.name} API error ${res.status}: ${(err as any).error?.message ?? res.statusText}`);
    }

    const data = await res.json() as ChatCompletionResponse;
    normalizeChoices(data);
    data._routed_via = { platform: this.platform, model: modelId };
    return data;
  }

  async *streamChatCompletion(
    apiKey: string,
    messages: ChatMessage[],
    modelId: string,
    options?: CompletionOptions,
  ): AsyncGenerator<ChatCompletionChunk> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...this.extraHeaders,
      },
      body: JSON.stringify({
        model: modelId,
        messages,
        temperature: options?.temperature,
        max_tokens: options?.max_tokens,
        top_p: options?.top_p,
        tools: options?.tools,
        tool_choice: options?.tool_choice,
        parallel_tool_calls: options?.parallel_tool_calls,
        response_format: options?.response_format,
        stream: true,
      }),
    }, this.timeoutMs);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`${this.name} API error ${res.status}: ${(err as any).error?.message ?? res.statusText}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const data = trimmed.slice(6);
        if (data === '[DONE]') return;
        try {
          const chunk = JSON.parse(data) as ChatCompletionChunk;
          if (chunk.choices) {
            for (const choice of chunk.choices) {
              const delta = choice.delta as any;
              if (delta) {
                const hasToolCalls = Array.isArray(delta.tool_calls) && delta.tool_calls.length > 0;
                if (!hasToolCalls && (delta.content === '' || delta.content == null)) {
                  const fold = (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0)
                    ? delta.reasoning_content
                    : (typeof delta.reasoning === 'string' && delta.reasoning.length > 0 ? delta.reasoning : null);
                  if (fold !== null) {
                    delta.content = fold;
                  }
                }
              }
            }
          }
          yield chunk;
        } catch {
          // Skip malformed chunks
        }
      }
    }
  }

  async generateImage(
    apiKey: string,
    prompt: string,
    modelId = 'flux',
    options?: Record<string, unknown>,
  ): Promise<{ created: number; data: Array<{ b64_json?: string; url?: string; revised_prompt?: string }> }> {
    if (this.platform === 'pollinations') {
      const size = String(options?.size ?? '1024x1024');
      const [wStr, hStr] = size.split('x');
      const width = parseInt(wStr, 10) || 1024;
      const height = parseInt(hStr, 10) || 1024;
      const seed = Math.floor(Math.random() * 1000000);
      const model = modelId || 'flux';
      const promptEnc = encodeURIComponent(prompt);
      
      const imageUrl = `https://image.pollinations.ai/prompt/${promptEnc}?width=${width}&height=${height}&model=${model}&nologo=true&seed=${seed}`;
      const res = await this.fetchWithTimeout(imageUrl, { method: 'GET' }, 45000);

      if (!res.ok) {
        throw new Error(`Pollinations Image error ${res.status}: ${res.statusText}`);
      }

      const arrBuf = await res.arrayBuffer();
      const b64 = Buffer.from(arrBuf).toString('base64');
      const format = options?.response_format === 'url' ? 'url' : 'b64_json';

      return {
        created: Math.floor(Date.now() / 1000),
        data: format === 'url'
          ? [{ url: imageUrl, revised_prompt: prompt }]
          : [{ b64_json: b64, revised_prompt: prompt }],
      };
    }

    // Generic OpenAI-compatible /images/generations
    const url = `${this.baseUrl}/images/generations`;
    const res = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...this.extraHeaders,
      },
      body: JSON.stringify({
        prompt,
        model: modelId,
        n: options?.n ?? 1,
        size: options?.size ?? '1024x1024',
        response_format: options?.response_format ?? 'b64_json',
        quality: options?.quality,
        style: options?.style,
      }),
    }, 45000);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`${this.name} Image error ${res.status}: ${(err as any).error?.message ?? res.statusText}`);
    }

    const data = await res.json() as any;
    return {
      created: data.created ?? Math.floor(Date.now() / 1000),
      data: data.data ?? [],
    };
  }

  async transcribeAudio(
    apiKey: string,
    audioBuffer: Buffer,
    filename: string,
    modelId = 'whisper-large-v3',
    options?: Record<string, unknown>,
  ): Promise<{ text: string; [key: string]: any }> {
    const url = `${this.baseUrl}/audio/transcriptions`;
    const form = new FormData();
    const blob = new Blob([audioBuffer], { type: 'application/octet-stream' });
    form.append('file', blob, filename || 'audio.mp3');
    form.append('model', modelId);

    if (options?.language) form.append('language', String(options.language));
    if (options?.prompt) form.append('prompt', String(options.prompt));
    if (options?.response_format) form.append('response_format', String(options.response_format));
    if (options?.temperature !== undefined) form.append('temperature', String(options.temperature));

    const res = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        ...this.extraHeaders,
      },
      body: form,
    }, 45000);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`${this.name} Audio Transcribe error ${res.status}: ${(err as any).error?.message ?? res.statusText}`);
    }

    const responseFormat = String(options?.response_format ?? 'json');
    if (responseFormat === 'text' || responseFormat === 'srt' || responseFormat === 'vtt') {
      const text = await res.text();
      return { text, _routed_via: { platform: this.platform, model: modelId } };
    }

    const data = await res.json() as any;
    data._routed_via = { platform: this.platform, model: modelId };
    return data;
  }

  async translateAudio(
    apiKey: string,
    audioBuffer: Buffer,
    filename: string,
    modelId = 'whisper-large-v3',
    options?: Record<string, unknown>,
  ): Promise<{ text: string; [key: string]: any }> {
    const url = `${this.baseUrl}/audio/translations`;
    const form = new FormData();
    const blob = new Blob([audioBuffer], { type: 'application/octet-stream' });
    form.append('file', blob, filename || 'audio.mp3');
    form.append('model', modelId);

    if (options?.prompt) form.append('prompt', String(options.prompt));
    if (options?.response_format) form.append('response_format', String(options.response_format));
    if (options?.temperature !== undefined) form.append('temperature', String(options.temperature));

    const res = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        ...this.extraHeaders,
      },
      body: form,
    }, 45000);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`${this.name} Audio Translate error ${res.status}: ${(err as any).error?.message ?? res.statusText}`);
    }

    const responseFormat = String(options?.response_format ?? 'json');
    if (responseFormat === 'text') {
      const text = await res.text();
      return { text, _routed_via: { platform: this.platform, model: modelId } };
    }

    const data = await res.json() as any;
    data._routed_via = { platform: this.platform, model: modelId };
    return data;
  }

  async generateSpeech(
    apiKey: string,
    input: string,
    modelId = 'tts-1',
    options?: Record<string, unknown>,
  ): Promise<{ audioBuffer: Buffer; contentType: string }> {
    if (this.platform === 'pollinations') {
      const voice = String(options?.voice ?? 'alloy');
      const url = `https://text.pollinations.ai/${encodeURIComponent(input)}?model=openai-audio&voice=${encodeURIComponent(voice)}`;
      const res = await this.fetchWithTimeout(url, { method: 'GET' }, 30000);

      if (!res.ok) {
        throw new Error(`Pollinations TTS error ${res.status}: ${res.statusText}`);
      }

      const arrBuf = await res.arrayBuffer();
      return {
        audioBuffer: Buffer.from(arrBuf),
        contentType: res.headers.get('content-type') || 'audio/mpeg',
      };
    }

    const url = `${this.baseUrl}/audio/speech`;
    const res = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...this.extraHeaders,
      },
      body: JSON.stringify({
        model: modelId,
        input,
        voice: options?.voice ?? 'alloy',
        response_format: options?.response_format ?? 'mp3',
        speed: options?.speed ?? 1.0,
      }),
    }, 30000);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`${this.name} TTS error ${res.status}: ${(err as any).error?.message ?? res.statusText}`);
    }

    const arrBuf = await res.arrayBuffer();
    return {
      audioBuffer: Buffer.from(arrBuf),
      contentType: res.headers.get('content-type') || 'audio/mpeg',
    };
  }

  async generateEmbeddings(
    apiKey: string,
    input: string[],
    modelId: string,
    options?: Record<string, unknown>,
  ): Promise<{ data: Array<{ embedding: number[]; index: number }>; usage: { prompt_tokens: number; total_tokens: number } }> {
    const url = `${this.baseUrl}/embeddings`;
    const res = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...this.extraHeaders,
      },
      body: JSON.stringify({
        model: modelId,
        input: input.length === 1 ? input[0] : input,
        encoding_format: options?.encoding_format ?? 'float',
        dimensions: options?.dimensions,
        user: options?.user,
      }),
    }, this.timeoutMs);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`${this.name} Embedding error ${res.status}: ${(err as any).error?.message ?? res.statusText}`);
    }

    const json = await res.json() as any;
    const data = (json.data ?? []).map((item: any, idx: number) => ({
      embedding: item.embedding,
      index: item.index !== undefined ? item.index : idx,
    }));

    const usage = json.usage ?? {
      prompt_tokens: input.reduce((acc, str) => acc + Math.ceil(str.length / 4), 0),
      total_tokens: input.reduce((acc, str) => acc + Math.ceil(str.length / 4), 0),
    };

    return { data, usage };
  }

  async moderateText(
    apiKey: string,
    input: string[],
    modelId = 'text-moderation-latest',
    options?: Record<string, unknown>,
  ): Promise<{ results: Array<{ flagged: boolean; categories: Record<string, boolean>; category_scores: Record<string, number> }> }> {
    const url = `${this.baseUrl}/moderations`;
    const res = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        ...this.extraHeaders,
      },
      body: JSON.stringify({
        model: modelId,
        input: input.length === 1 ? input[0] : input,
      }),
    }, this.timeoutMs);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`${this.name} Moderation error ${res.status}: ${(err as any).error?.message ?? res.statusText}`);
    }

    const json = await res.json() as any;
    return {
      results: json.results ?? [],
    };
  }

  async validateKey(apiKey: string): Promise<{ isValid: boolean; error?: string; isAuthError?: boolean }> {
    const url = this.validateUrl ?? `${this.baseUrl}/models`;
    try {
      const res = await this.fetchWithTimeout(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          ...this.extraHeaders,
        },
      }, 10000);

      if (res.status === 401 || res.status === 403) {
        let errorMsg = `Unauthorized (${res.status})`;
        try {
          const body = await res.json().catch(() => ({})) as any;
          errorMsg = body.error?.message ?? body.message ?? errorMsg;
        } catch {
          // ignore
        }
        return { isValid: false, error: errorMsg, isAuthError: true };
      }

      if (!res.ok) {
        let errorMsg = `API Error ${res.status}: ${res.statusText}`;
        try {
          const body = await res.json().catch(() => ({})) as any;
          errorMsg = body.error?.message ?? body.message ?? errorMsg;
        } catch {
          // ignore
        }
        return { isValid: false, error: errorMsg, isAuthError: false };
      }

      return { isValid: true };
    } catch (e: any) {
      return { isValid: false, error: e.message || 'Connection timeout or network failure', isAuthError: false };
    }
  }
}

/**
 * Some providers (Z.ai glm-4.5-flash, Cloudflare DeepSeek-R1-distill, others)
 * return reasoning models' actual answer in `message.reasoning_content` with
 * `message.content === ""`. Fold reasoning_content into content so OpenAI-
 * compatible clients see a non-empty assistant message.
 *
 * Other providers (Mistral magistral-medium) return `message.content` as an
 * array of text segments instead of a string. Flatten to string.
 */
function normalizeChoices(data: ChatCompletionResponse): void {
  for (const choice of data.choices ?? []) {
    const msg = choice.message as ChatMessage & {
      reasoning_content?: string;
      reasoning?: string;
      content: unknown;
    };
    // Flatten array content (Mistral magistral) → join text segments.
    if (Array.isArray(msg.content)) {
      msg.content = (msg.content as Array<{ text?: string; type?: string }>)
        .map(seg => (typeof seg === 'string' ? seg : (seg.text ?? '')))
        .join('');
    }
    // Fold reasoning into content if content is empty AND there are no
    // tool_calls. With tool_calls present, content=null is the correct OpenAI
    // shape; folding reasoning would confuse clients that branch on content.
    // Field naming varies by provider: Z.ai uses `reasoning_content`, Ollama
    // uses `reasoning`. Prefer `reasoning_content` when both are set.
    const hasToolCalls = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
    if (!hasToolCalls && (msg.content === '' || msg.content == null)) {
      const fold = (typeof msg.reasoning_content === 'string' && msg.reasoning_content.length > 0)
        ? msg.reasoning_content
        : (typeof msg.reasoning === 'string' && msg.reasoning.length > 0 ? msg.reasoning : null);
      if (fold !== null) msg.content = fold;
    }
  }
}
