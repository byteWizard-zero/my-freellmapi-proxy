import type {
  ChatMessage,
  ChatCompletionResponse,
  ChatCompletionChunk,
  ChatToolDefinition,
  ChatToolChoice,
  Platform,
} from '@freellmapi/shared/types.js';

export interface CompletionOptions {
  model?: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  tools?: ChatToolDefinition[];
  tool_choice?: ChatToolChoice;
  parallel_tool_calls?: boolean;
  web_search?: boolean;
  response_format?: {
    type: 'text' | 'json_object' | 'json_schema';
    json_schema?: Record<string, unknown>;
  };
}


export abstract class BaseProvider {
  abstract readonly platform: Platform;
  abstract readonly name: string;

  abstract chatCompletion(
    apiKey: string,
    messages: ChatMessage[],
    modelId: string,
    options?: CompletionOptions,
  ): Promise<ChatCompletionResponse>;

  abstract streamChatCompletion(
    apiKey: string,
    messages: ChatMessage[],
    modelId: string,
    options?: CompletionOptions,
  ): AsyncGenerator<ChatCompletionChunk>;

  abstract validateKey(apiKey: string): Promise<{ isValid: boolean; error?: string; isAuthError?: boolean }>;

  generateImage?(
    apiKey: string,
    prompt: string,
    modelId: string,
    options?: Record<string, unknown>,
  ): Promise<{ created: number; data: Array<{ b64_json?: string; url?: string; revised_prompt?: string }> }>;

  transcribeAudio?(
    apiKey: string,
    audioBuffer: Buffer,
    filename: string,
    modelId: string,
    options?: Record<string, unknown>,
  ): Promise<{ text: string; [key: string]: any }>;

  translateAudio?(
    apiKey: string,
    audioBuffer: Buffer,
    filename: string,
    modelId: string,
    options?: Record<string, unknown>,
  ): Promise<{ text: string; [key: string]: any }>;

  generateSpeech?(
    apiKey: string,
    input: string,
    modelId: string,
    options?: Record<string, unknown>,
  ): Promise<{ audioBuffer: Buffer; contentType: string }>;

  generateEmbeddings?(
    apiKey: string,
    input: string[],
    modelId: string,
    options?: Record<string, unknown>,
  ): Promise<{ data: Array<{ embedding: number[]; index: number }>; usage: { prompt_tokens: number; total_tokens: number } }>;

  moderateText?(
    apiKey: string,
    input: string[],
    modelId: string,
    options?: Record<string, unknown>,
  ): Promise<{ results: Array<{ flagged: boolean; categories: Record<string, boolean>; category_scores: Record<string, number> }> }>;

  protected async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs = 15000,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  protected makeId(): string {
    return `chatcmpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
