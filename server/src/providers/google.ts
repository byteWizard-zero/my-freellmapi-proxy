import type {
  ChatMessage,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ChatToolCall,
  ChatToolChoice,
  ChatToolDefinition,
  TokenUsage,
} from '@freellmapi/shared/types.js';
import crypto from 'crypto';
import { BaseProvider, type CompletionOptions } from './base.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

interface GeminiPart {
  text?: string;
  thoughtSignature?: string;
  functionCall?: {
    id?: string;
    name?: string;
    args?: unknown;
  };
  functionResponse?: {
    id?: string;
    name?: string;
    response?: unknown;
  };
  inlineData?: {
    mimeType: string;
    data: string;
  };
}

interface GeminiCandidate {
  content?: { parts?: GeminiPart[] };
  finishReason?: string;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

function safeParseObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return { value: parsed };
  } catch {
    return { value: raw };
  }
}

function normalizeGeminiArgs(args: unknown): string {
  if (typeof args === 'string') return args;
  return JSON.stringify(args ?? {});
}

function toGeminiFinishReason(finishReason?: string): string {
  const r = (finishReason ?? '').toUpperCase();
  if (!r) return 'stop';
  if (r === 'MAX_TOKENS') return 'length';
  if (r === 'SAFETY' || r === 'RECITATION' || r === 'BLOCKLIST' || r === 'PROHIBITED_CONTENT' || r === 'SPII') {
    return 'content_filter';
  }
  return 'stop';
}

function toGeminiTools(tools?: ChatToolDefinition[], webSearch?: boolean): Array<Record<string, unknown>> | undefined {
  const result: Array<Record<string, unknown>> = [];

  if (tools && tools.length > 0) {
    result.push({
      functionDeclarations: tools.map(t => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      })),
    });
  }

  if (webSearch) {
    result.push({
      googleSearch: {},
    });
  }

  return result.length > 0 ? result : undefined;
}


function toGeminiToolConfig(toolChoice?: ChatToolChoice): { functionCallingConfig: Record<string, unknown> } | undefined {
  if (!toolChoice) return undefined;

  if (typeof toolChoice === 'string') {
    const mode =
      toolChoice === 'none'
        ? 'NONE'
        : toolChoice === 'required'
          ? 'ANY'
          : 'AUTO';
    return { functionCallingConfig: { mode } };
  }

  return {
    functionCallingConfig: {
      mode: 'ANY',
      allowedFunctionNames: [toolChoice.function.name],
    },
  };
}

// Translate OpenAI messages to Gemini format
function toGeminiContents(messages: ChatMessage[]) {
  const systemMessages = messages
    .filter(m => m.role === 'system' && typeof m.content === 'string' && m.content.length > 0)
    .map(m => m.content as string);

  const toolNameByCallId = new Map<string, string>();
  for (const m of messages) {
    for (const tc of m.tool_calls ?? []) {
      toolNameByCallId.set(tc.id, tc.function.name);
    }
  }

  const contents = messages
    .filter(m => m.role !== 'system')
    .map((m): { role: 'user' | 'model'; parts: GeminiPart[] } | null => {
      if (m.role === 'assistant') {
        const parts: GeminiPart[] = [];

        if (typeof m.content === 'string' && m.content.length > 0) {
          parts.push({ text: m.content });
        }

        for (const call of m.tool_calls ?? []) {
          parts.push({
            thoughtSignature: call.thought_signature,
            functionCall: {
              id: call.id,
              name: call.function.name,
              args: safeParseObject(call.function.arguments),
            },
          });
        }

        if (parts.length === 0) return null;
        return {
          role: 'model',
          parts,
        };
      }

      if (m.role === 'tool') {
        const toolCallId = m.tool_call_id;
        if (!toolCallId) return null;

        const toolName = m.name ?? toolNameByCallId.get(toolCallId) ?? 'tool';
        const response = safeParseObject(typeof m.content === 'string' ? m.content : '');

        return {
          role: 'user',
          parts: [{
            functionResponse: {
              id: toolCallId,
              name: toolName,
              response,
            },
          }],
        };
      }

      const userParts: GeminiPart[] = [];
      const content = m.content as any;
      if (typeof content === 'string') {
        userParts.push({ text: content });
      } else if (Array.isArray(content)) {
        for (const item of content) {
          if (item.type === 'text' && typeof item.text === 'string') {
            userParts.push({ text: item.text });
          } else if (item.type === 'image_url' && item.image_url?.url) {
            const url = item.image_url.url;
            const match = url.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              userParts.push({
                inlineData: {
                  mimeType: match[1],
                  data: match[2],
                },
              });
            }
          }
        }
      }

      return {
        role: 'user',
        parts: userParts,
      };
    })
    .filter((entry): entry is { role: 'user' | 'model'; parts: GeminiPart[] } => entry !== null);

  return {
    contents,
    systemInstruction: systemMessages.length > 0
      ? { parts: [{ text: systemMessages.join('\n\n') }] }
      : undefined,
  };
}

function extractToolCalls(parts: GeminiPart[] | undefined): ChatToolCall[] {
  const calls: ChatToolCall[] = [];
  if (!parts) return calls;

  for (const part of parts) {
    if (!part.functionCall?.name) continue;

    let id = part.functionCall.id;
    if (!id) {
      const argsStr = normalizeGeminiArgs(part.functionCall.args);
      const hashInput = `${part.functionCall.name}:${argsStr}`;
      const hash = crypto.createHash('sha256').update(hashInput).digest('hex').slice(0, 16);
      id = `call_${hash}`;
    }

    calls.push({
      id,
      type: 'function',
      function: {
        name: part.functionCall.name,
        arguments: normalizeGeminiArgs(part.functionCall.args),
      },
      thought_signature: part.thoughtSignature,
    });
  }

  return calls;
}

function extractText(parts: GeminiPart[] | undefined): string | null {
  if (!parts) return null;
  const segments: string[] = [];
  for (const p of parts) {
    if (p.text) {
      segments.push(p.text);
    } else if (p.inlineData?.data) {
      const mime = p.inlineData.mimeType || 'image/png';
      segments.push(`\n\n![Generated Image](data:${mime};base64,${p.inlineData.data})\n\n`);
    }
  }
  const text = segments.join('');
  return text.length > 0 ? text : null;
}

export class GoogleProvider extends BaseProvider {
  readonly platform = 'google' as const;
  readonly name = 'Google AI Studio';

  async chatCompletion(
    apiKey: string,
    messages: ChatMessage[],
    modelId: string,
    options?: CompletionOptions,
  ): Promise<ChatCompletionResponse> {
    const { contents, systemInstruction } = toGeminiContents(messages);

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: options?.temperature,
        maxOutputTokens: options?.max_tokens,
        topP: options?.top_p,
        responseMimeType: options?.response_format?.type === 'json_object' ? 'application/json' : undefined,
      },
      tools: toGeminiTools(options?.tools, options?.web_search),
      toolConfig: toGeminiToolConfig(options?.tool_choice),
    };
    if (systemInstruction) body.systemInstruction = systemInstruction;

    const url = `${API_BASE}/models/${modelId}:generateContent?key=${apiKey}`;
    const res = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Google API error ${res.status}: ${(err as any).error?.message ?? res.statusText}`);
    }

    const data = await res.json() as GeminiResponse;
    const candidate = data.candidates?.[0];
    const parts = candidate?.content?.parts;
    const toolCalls = extractToolCalls(parts);
    let text = extractText(parts);

    if (!text && toolCalls.length === 0) {
      if (candidate?.finishReason === 'SAFETY') {
        text = 'Response was blocked by safety filters.';
      } else if (candidate?.finishReason === 'RECITATION') {
        text = 'Response was blocked due to recitation/copyright policies.';
      } else if (candidate?.finishReason && candidate.finishReason !== 'STOP') {
        text = `Response stopped (${candidate.finishReason}).`;
      } else {
        text = 'I inspected your image, but no text was produced. To generate or transform images into anime style, please switch to the 🎨 Image Studio tab or call /v1/images/generations.';
      }
    }

    const usage: TokenUsage = {
      prompt_tokens: data.usageMetadata?.promptTokenCount ?? 0,
      completion_tokens: data.usageMetadata?.candidatesTokenCount ?? (text ? Math.ceil(text.length / 4) : 0),
      total_tokens: data.usageMetadata?.totalTokenCount ?? 0,
    };

    return {
      id: this.makeId(),
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [{
        index: 0,
        message: {
          role: 'assistant',
          content: text,
          ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: toolCalls.length > 0 ? 'tool_calls' : toGeminiFinishReason(candidate?.finishReason),
      }],
      usage,
      _routed_via: { platform: 'google', model: modelId },
    };
  }

  async *streamChatCompletion(
    apiKey: string,
    messages: ChatMessage[],
    modelId: string,
    options?: CompletionOptions,
  ): AsyncGenerator<ChatCompletionChunk> {
    const { contents, systemInstruction } = toGeminiContents(messages);

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: options?.temperature,
        maxOutputTokens: options?.max_tokens,
        topP: options?.top_p,
        responseMimeType: options?.response_format?.type === 'json_object' ? 'application/json' : undefined,
      },
      tools: toGeminiTools(options?.tools, options?.web_search),
      toolConfig: toGeminiToolConfig(options?.tool_choice),
    };
    if (systemInstruction) body.systemInstruction = systemInstruction;

    const url = `${API_BASE}/models/${modelId}:streamGenerateContent?alt=sse&key=${apiKey}`;
    const res = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Google API error ${res.status}: ${(err as any).error?.message ?? res.statusText}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error('No response body');

    const decoder = new TextDecoder();
    const id = this.makeId();
    let buffer = '';
    let emittedFinish = false;
    let sawToolCalls = false;

    const seenToolCallKeys = new Set<string>();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;
        const raw = trimmed.slice(6);
        if (raw === '[DONE]') {
          if (!emittedFinish) {
            emittedFinish = true;
            yield {
              id,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: modelId,
              choices: [{
                index: 0,
                delta: {},
                finish_reason: sawToolCalls ? 'tool_calls' : 'stop',
              }],
            };
          }
          return;
        }

        // Skip malformed SSE frames instead of aborting the whole stream.
        // Matches the defensive parse in openai-compat / cohere / cloudflare:
        // a single corrupt chunk shouldn't take down the rest of the response.
        let chunk: GeminiResponse;
        try {
          chunk = JSON.parse(raw) as GeminiResponse;
        } catch {
          continue;
        }
        const candidate = chunk.candidates?.[0];
        const parts = candidate?.content?.parts ?? [];

        const text = extractText(parts);
        const toolCalls = extractToolCalls(parts).filter(call => {
          const key = `${call.id}:${call.function.name}:${call.function.arguments}`;
          if (seenToolCallKeys.has(key)) return false;
          seenToolCallKeys.add(key);
          return true;
        });

        if ((text && text.length > 0) || toolCalls.length > 0) {
          sawToolCalls = sawToolCalls || toolCalls.length > 0;
          yield {
            id,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: modelId,
            choices: [{
              index: 0,
              delta: {
                ...(text ? { content: text } : {}),
                ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
              },
              finish_reason: null,
            }],
          };
        }

        if (candidate?.finishReason && !emittedFinish) {
          emittedFinish = true;
          yield {
            id,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: modelId,
            choices: [{
              index: 0,
              delta: {},
              finish_reason: sawToolCalls ? 'tool_calls' : toGeminiFinishReason(candidate.finishReason),
            }],
          };
          return;
        }
      }
    }

    if (!emittedFinish) {
      yield {
        id,
        object: 'chat.completion.chunk',
        created: Math.floor(Date.now() / 1000),
        model: modelId,
        choices: [{
          index: 0,
          delta: {},
          finish_reason: sawToolCalls ? 'tool_calls' : 'stop',
        }],
      };
    }
  }

  async generateImage(
    apiKey: string,
    prompt: string,
    modelId = 'imagen-3.0-generate-002',
    options?: Record<string, unknown>,
  ): Promise<{ created: number; data: Array<{ b64_json?: string; url?: string; revised_prompt?: string }> }> {
    const isPredictEndpoint = modelId.includes('imagen') || modelId.includes('generate-002');
    
    if (isPredictEndpoint) {
      const url = `${API_BASE}/models/${modelId}:predict?key=${apiKey}`;
      const sampleCount = Number(options?.n ?? 1);
      const size = String(options?.size ?? '1024x1024');
      let aspectRatio = '1:1';
      if (size === '1024x1792' || size === '720x1280') aspectRatio = '9:16';
      else if (size === '1792x1024' || size === '1280x720') aspectRatio = '16:9';
      else if (size === '1024x768') aspectRatio = '4:3';
      else if (size === '768x1024') aspectRatio = '3:4';

      const res = await this.fetchWithTimeout(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          instances: [{ prompt }],
          parameters: {
            sampleCount,
            aspectRatio,
            outputOptions: { mimeType: 'image/png' },
          },
        }),
      }, 45000);

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(`Google Imagen API error ${res.status}: ${(err as any).error?.message ?? res.statusText}`);
      }

      const body = await res.json() as any;
      const predictions = body.predictions ?? [];
      const data: Array<{ b64_json?: string; url?: string }> = [];

      for (const pred of predictions) {
        const b64 = pred.bytesBase64Encoded ?? pred.image?.imageBytes;
        if (b64) {
          data.push({ b64_json: b64 });
        }
      }

      if (data.length === 0) {
        throw new Error('Google Imagen returned empty image predictions');
      }

      return {
        created: Math.floor(Date.now() / 1000),
        data,
      };
    }

    // Standard Gemini Image Modality
    const url = `${API_BASE}/models/${modelId}:generateContent?key=${apiKey}`;
    const res = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseModalities: ['IMAGE'] },
      }),
    }, 45000);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Google Image API error ${res.status}: ${(err as any).error?.message ?? res.statusText}`);
    }

    const body = await res.json() as GeminiResponse;
    const parts = body.candidates?.[0]?.content?.parts ?? [];
    const data: Array<{ b64_json?: string; url?: string }> = [];

    for (const p of parts) {
      if (p.inlineData?.data) {
        data.push({ b64_json: p.inlineData.data });
      }
    }

    if (data.length === 0) {
      throw new Error('Google Gemini returned no image parts');
    }

    return {
      created: Math.floor(Date.now() / 1000),
      data,
    };
  }

  async transcribeAudio(
    apiKey: string,
    audioBuffer: Buffer,
    filename: string,
    modelId = 'gemini-2.5-flash',
    options?: Record<string, unknown>,
  ): Promise<{ text: string; [key: string]: any }> {
    const ext = filename.split('.').pop()?.toLowerCase() ?? 'mp3';
    let mimeType = 'audio/mp3';
    if (ext === 'wav') mimeType = 'audio/wav';
    else if (ext === 'ogg') mimeType = 'audio/ogg';
    else if (ext === 'm4a') mimeType = 'audio/m4a';
    else if (ext === 'webm') mimeType = 'audio/webm';
    else if (ext === 'flac') mimeType = 'audio/flac';

    const b64 = audioBuffer.toString('base64');
    const prompt = options?.prompt
      ? `Transcribe this audio recording verbatim. Context: ${options.prompt}. Return only the exact transcription text.`
      : 'Transcribe this audio recording verbatim. Return only the exact transcription text.';

    const url = `${API_BASE}/models/${modelId}:generateContent?key=${apiKey}`;
    const res = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType, data: b64 } },
            { text: prompt },
          ],
        }],
      }),
    }, 45000);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Google Audio Transcribe error ${res.status}: ${(err as any).error?.message ?? res.statusText}`);
    }

    const body = await res.json() as GeminiResponse;
    const parts = body.candidates?.[0]?.content?.parts ?? [];
    const text = extractText(parts)?.trim() ?? '';

    return { text, _routed_via: { platform: 'google', model: modelId } };
  }

  async translateAudio(
    apiKey: string,
    audioBuffer: Buffer,
    filename: string,
    modelId = 'gemini-2.5-flash',
    options?: Record<string, unknown>,
  ): Promise<{ text: string; [key: string]: any }> {
    const ext = filename.split('.').pop()?.toLowerCase() ?? 'mp3';
    let mimeType = 'audio/mp3';
    if (ext === 'wav') mimeType = 'audio/wav';
    else if (ext === 'ogg') mimeType = 'audio/ogg';
    else if (ext === 'm4a') mimeType = 'audio/m4a';
    else if (ext === 'webm') mimeType = 'audio/webm';

    const b64 = audioBuffer.toString('base64');
    const prompt = 'Translate this spoken audio recording into English text. Return only the English translation.';

    const url = `${API_BASE}/models/${modelId}:generateContent?key=${apiKey}`;
    const res = await this.fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType, data: b64 } },
            { text: prompt },
          ],
        }],
      }),
    }, 45000);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`Google Audio Translate error ${res.status}: ${(err as any).error?.message ?? res.statusText}`);
    }

    const body = await res.json() as GeminiResponse;
    const parts = body.candidates?.[0]?.content?.parts ?? [];
    const text = extractText(parts)?.trim() ?? '';

    return { text, _routed_via: { platform: 'google', model: modelId } };
  }

  async validateKey(apiKey: string): Promise<{ isValid: boolean; error?: string; isAuthError?: boolean }> {
    try {
      const res = await this.fetchWithTimeout(
        `${API_BASE}/models?key=${apiKey}`,
        { method: 'GET' },
        10000,
      );

      if (res.status === 401 || res.status === 403) {
        let errorMsg = `Unauthorized (${res.status})`;
        try {
          const body = await res.json().catch(() => ({}) as any) as any;
          errorMsg = body.error?.message ?? body.message ?? errorMsg;
        } catch {
          // ignore
        }
        return { isValid: false, error: errorMsg, isAuthError: true };
      }

      if (!res.ok) {
        let errorMsg = `API Error ${res.status}: ${res.statusText}`;
        try {
          const body = await res.json().catch(() => ({}) as any) as any;
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
