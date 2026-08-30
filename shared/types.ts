// ---- Platform & Model Types ----

// Active platforms — must match server/src/providers/index.ts and
// server/src/routes/keys.ts PLATFORMS allowlist.
// Hugging Face, Moonshot, and MiniMax direct integrations were dropped
// in migrateModelsV4 (see server/src/db/index.ts).
export type Platform =
  | 'google'
  | 'groq'
  | 'cerebras'
  | 'sambanova'
  | 'nvidia'
  | 'mistral'
  | 'openrouter'
  | 'github'
  | 'cohere'
  | 'cloudflare'
  | 'zhipu'
  | 'ollama'
  | 'kilo'
  | 'pollinations'
  | 'llm7'
  | 'moonshot';

export type ModelModality = 'chat' | 'vision' | 'image' | 'audio_stt' | 'audio_tts';

export interface Model {
  id: number;
  platform: Platform;
  modelId: string;
  displayName: string;
  intelligenceRank: number;
  speedRank: number;
  sizeLabel: string;
  rpmLimit: number | null;
  rpdLimit: number | null;
  tpmLimit: number | null;
  tpdLimit: number | null;
  monthlyTokenBudget: string;
  contextWindow: number | null;
  enabled: boolean;
  modality?: ModelModality;
}

export type KeyStatus = 'healthy' | 'rate_limited' | 'invalid' | 'error' | 'unknown';

export interface ApiKey {
  id: number;
  platform: Platform;
  label: string;
  maskedKey: string;
  status: KeyStatus;
  enabled: boolean;
  createdAt: string;
  lastCheckedAt: string | null;
  errorMessage?: string | null;
}

export interface ApiKeyCreate {
  platform: Platform;
  key: string;
  label?: string;
}

// ---- Fallback Config ----

export interface FallbackEntry {
  modelId: number;
  platform: Platform;
  displayName: string;
  intelligenceRank: number;
  speedRank: number;
  priority: number;
  enabled: boolean;
}

// ---- OpenAI-Compatible Types ----

export interface ChatToolCallFunction {
  name: string;
  arguments: string;
}

export interface ChatToolCall {
  id: string;
  type: 'function';
  function: ChatToolCallFunction;
  thought_signature?: string;
}

export interface ChatToolFunctionDefinition {
  name: string;
  description?: string;
  parameters?: Record<string, unknown>;
  strict?: boolean;
}

export interface ChatToolDefinition {
  type: 'function';
  function: ChatToolFunctionDefinition;
}

export type ChatToolChoice =
  | 'none'
  | 'auto'
  | 'required'
  | {
    type: 'function';
    function: {
      name: string;
    };
  };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | any[] | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
}

export interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface ChatCompletionRequest {
  model?: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  top_p?: number;
  tools?: ChatToolDefinition[];
  tool_choice?: ChatToolChoice;
  parallel_tool_calls?: boolean;
  web_search?: boolean | { max_results?: number };
  search?: boolean;
}


export interface ChatCompletionChoice {
  index: number;
  message: ChatMessage;
  finish_reason: string | null;
}

export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface ChatCompletionResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: ChatCompletionChoice[];
  usage: TokenUsage;
  _routed_via?: {
    platform: Platform;
    model: string;
  };
}

export interface ChatCompletionChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: {
    index: number;
    delta: {
      role?: 'assistant';
      content?: string;
      tool_calls?: ChatToolCall[];
    };
    finish_reason: string | null;
  }[];
}

// ---- Analytics Types ----

export interface AnalyticsSummary {
  totalRequests: number;
  successRate: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  avgLatencyMs: number;
  estimatedCostSavings: number;
}

export interface PlatformStats {
  platform: Platform;
  requests: number;
  successRate: number;
  avgLatencyMs: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

export interface TimelinePoint {
  timestamp: string;
  requests: number;
  successCount: number;
  failureCount: number;
}

export interface RequestLog {
  id: number;
  platform: Platform;
  modelId: string;
  status: 'success' | 'error';
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  error: string | null;
  createdAt: string;
}

// ---- Rate Limit Types ----

export interface RateLimitStatus {
  platform: Platform;
  modelId: string;
  rpm: { used: number; limit: number | null };
  rpd: { used: number; limit: number | null };
  tpm: { used: number; limit: number | null };
  available: boolean;
  nextResetAt: string | null;
}

// ---- Image Generation Types (OpenAI-Compatible) ----

export type ImageSize =
  | '256x256'
  | '512x512'
  | '1024x1024'
  | '1024x1792'
  | '1792x1024'
  | '1280x720'
  | '720x1280'
  | string;

export type ImageResponseFormat = 'url' | 'b64_json';

export interface ImageGenerationRequest {
  prompt: string;
  model?: string;
  n?: number;
  quality?: 'standard' | 'hd' | string;
  response_format?: ImageResponseFormat;
  size?: ImageSize;
  style?: 'vivid' | 'natural' | string;
  user?: string;
}

export interface ImageData {
  b64_json?: string;
  url?: string;
  revised_prompt?: string;
}

export interface ImageGenerationResponse {
  created: number;
  data: ImageData[];
  _routed_via?: {
    platform: Platform;
    model: string;
  };
}

export interface ImageEditRequest {
  image: string; // base64 or file buffer reference
  prompt: string;
  mask?: string;
  model?: string;
  n?: number;
  size?: ImageSize;
  response_format?: ImageResponseFormat;
  user?: string;
}

export interface ImageVariationRequest {
  image: string;
  model?: string;
  n?: number;
  size?: ImageSize;
  response_format?: ImageResponseFormat;
  user?: string;
}

// ---- Audio Types (OpenAI-Compatible) ----

export type AudioResponseFormat = 'json' | 'text' | 'srt' | 'verbose_json' | 'vtt';

export interface AudioTranscriptionRequest {
  file: Uint8Array | ArrayBuffer | Blob | any;
  filename?: string;
  model?: string;
  language?: string;
  prompt?: string;
  response_format?: AudioResponseFormat;
  temperature?: number;
  timestamp_granularities?: Array<'word' | 'segment'>;
}

export interface AudioTranscriptionResponse {
  text: string;
  task?: string;
  language?: string;
  duration?: number;
  words?: Array<{ word: string; start: number; end: number }>;
  segments?: Array<{
    id: number;
    seek: number;
    start: number;
    end: number;
    text: string;
    tokens: number[];
    temperature: number;
    avg_logprob: number;
    compression_ratio: number;
    no_speech_prob: number;
  }>;
  _routed_via?: {
    platform: Platform;
    model: string;
  };
}

export interface AudioTranslationRequest {
  file: Uint8Array | ArrayBuffer | Blob | any;
  filename?: string;
  model?: string;
  prompt?: string;
  response_format?: AudioResponseFormat;
  temperature?: number;
}

export interface AudioTranslationResponse {
  text: string;
  _routed_via?: {
    platform: Platform;
    model: string;
  };
}

export type AudioVoice = 'alloy' | 'echo' | 'fable' | 'onyx' | 'nova' | 'shimmer' | string;
export type AudioSpeechFormat = 'mp3' | 'opus' | 'aac' | 'flac' | 'wav' | 'pcm';

export interface AudioSpeechRequest {
  model?: string;
  input: string;
  voice: AudioVoice;
  response_format?: AudioSpeechFormat;
  speed?: number;
}

