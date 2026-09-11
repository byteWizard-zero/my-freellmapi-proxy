import crypto from 'crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { ChatMessage } from '@freellmapi/shared/types.js';
import { routeRequest, recordRateLimitHit, recordSuccess, type RouteResult } from '../services/router.js';
import { recordRequest, recordTokens, setCooldown } from '../services/ratelimit.js';
import { getDb, getUnifiedApiKey, validateClientApiKey, recordClientKeyUsage } from '../db/index.js';
import { WebSearchService } from '../services/websearch.js';
import { normalizeImage } from '../lib/image-normalizer.js';
import { ImageSynthesisService } from '../services/image-synthesis-service.js';
import { ResponseCache } from '../services/response-cache.js';
import { SmartClassifier } from '../services/smart-classifier.js';

export const proxyRouter = Router();


// Constant-time string comparison for the unified API key. Plain `===` leaks
// length and per-character timing, which a network attacker could in principle
// use to recover the key one byte at a time.
function timingSafeStringEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  // Compare against a same-length buffer regardless of input length so the
  // comparison itself runs in constant time; the explicit length check at the
  // end is what actually decides equality when lengths differ.
  const compareA = a.length === b.length ? a : Buffer.alloc(b.length);
  return crypto.timingSafeEqual(compareA, b) && a.length === b.length;
}

// Sticky sessions: track which model served each "session"
// Key: hash of first user message → model_db_id
// This prevents model switching mid-conversation which causes hallucination
const stickySessionMap = new Map<string, { modelDbId: number; lastUsed: number }>();
const STICKY_TTL_MS = 30 * 60 * 1000; // 30 min session TTL

function getSessionKey(messages: ChatMessage[]): string {
  // Use the first user message as session identifier — clients like Hermes
  // re-send the full conversation each turn, so the first user message is
  // stable across turns. Hash the FULL message (not a 100-char slice) so
  // distinct conversations with identical openings don't collide.
  const firstUser = messages.find(m => m.role === 'user');
  if (!firstUser || typeof firstUser.content !== 'string') return '';
  const hash = crypto.createHash('sha1').update(firstUser.content).digest('hex');
  return `${hash}:${messages.length > 2 ? 'multi' : 'single'}`;
}

function getStickyModel(messages: ChatMessage[]): number | undefined {
  // Only apply sticky for multi-turn (has assistant messages = continuation)
  const hasAssistant = messages.some(m => m.role === 'assistant');
  if (!hasAssistant) return undefined;

  const key = getSessionKey(messages);
  if (!key) return undefined;

  const entry = stickySessionMap.get(key);
  if (!entry) return undefined;

  if (Date.now() - entry.lastUsed > STICKY_TTL_MS) {
    stickySessionMap.delete(key);
    return undefined;
  }
  return entry.modelDbId;
}

function setStickyModel(messages: ChatMessage[], modelDbId: number) {
  const key = getSessionKey(messages);
  if (!key) return;
  stickySessionMap.set(key, { modelDbId, lastUsed: Date.now() });

  // Cleanup old entries
  if (stickySessionMap.size > 500) {
    const now = Date.now();
    for (const [k, v] of stickySessionMap) {
      if (now - v.lastUsed > STICKY_TTL_MS) stickySessionMap.delete(k);
    }
  }
}

// OpenAI-compatible /models endpoint (used by Hermes for metadata)
proxyRouter.get('/models', (_req: Request, res: Response) => {
  const db = getDb();
  const models = db.prepare('SELECT platform, model_id, display_name, context_window FROM models WHERE enabled = 1 ORDER BY intelligence_rank').all() as any[];
  
  const list = [
    {
      id: 'auto',
      object: 'model',
      created: 0,
      owned_by: 'proxy',
      name: '🤖 Auto-Route (Proxy Fallback)',
      context_window: 131072,
    },
    ...models.map(m => ({
      id: m.model_id,
      object: 'model',
      created: 0,
      owned_by: m.platform,
      name: m.display_name,
      context_window: m.context_window,
    }))
  ];

  res.json({
    object: 'list',
    data: list,
  });
});

const MAX_RETRIES = 20;

const toolCallSchema = z.object({
  id: z.string().min(1),
  type: z.literal('function'),
  function: z.object({
    name: z.string().min(1),
    arguments: z.string(),
  }),
  thought_signature: z.string().optional(),
});

const systemMessageSchema = z.object({
  role: z.literal('system'),
  content: z.string(),
  name: z.string().optional(),
});

const contentPartSchema = z.union([
  z.object({
    type: z.literal('text'),
    text: z.string(),
  }),
  z.object({
    type: z.literal('image_url'),
    image_url: z.object({
      url: z.string(),
    }),
  }),
]);

const userMessageSchema = z.object({
  role: z.literal('user'),
  content: z.union([
    z.string(),
    z.array(contentPartSchema),
  ]),
  name: z.string().optional(),
});

const assistantMessageSchema = z.object({
  role: z.literal('assistant'),
  content: z.string().nullable().optional(),
  name: z.string().optional(),
  tool_calls: z.array(toolCallSchema).optional(),
}).refine((msg) => {
  const hasContent = typeof msg.content === 'string' && msg.content.length > 0;
  const hasToolCalls = (msg.tool_calls?.length ?? 0) > 0;
  return hasContent || hasToolCalls;
}, {
  message: 'assistant messages must include non-empty content or tool_calls',
});

const toolMessageSchema = z.object({
  role: z.literal('tool'),
  content: z.string(),
  tool_call_id: z.string().min(1),
  name: z.string().optional(),
});

const toolDefinitionSchema = z.object({
  type: z.literal('function'),
  function: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    parameters: z.record(z.string(), z.unknown()).optional(),
    strict: z.boolean().optional(),
  }),
});

const toolChoiceSchema = z.union([
  z.enum(['none', 'auto', 'required']),
  z.object({
    type: z.literal('function'),
    function: z.object({
      name: z.string().min(1),
    }),
  }),
]);

const webSearchSchema = z.union([
  z.boolean(),
  z.object({
    max_results: z.number().int().positive().optional(),
  }),
]);

const chatCompletionSchema = z.object({
  messages: z.array(z.union([
    systemMessageSchema,
    userMessageSchema,
    assistantMessageSchema,
    toolMessageSchema,
  ])).min(1),
  model: z.string().optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().positive().optional(),
  max_completion_tokens: z.number().int().positive().optional(),
  top_p: z.number().min(0).max(1).optional(),
  n: z.number().int().min(1).max(10).optional().default(1),
  stream: z.boolean().optional(),
  stream_options: z.object({
    include_usage: z.boolean().optional(),
  }).nullable().optional(),
  tools: z.array(toolDefinitionSchema).optional(),
  tool_choice: toolChoiceSchema.optional(),
  parallel_tool_calls: z.boolean().optional(),
  web_search: webSearchSchema.optional(),
  search: z.boolean().optional(),
  response_format: z.object({
    type: z.enum(['text', 'json_object', 'json_schema']),
    json_schema: z.record(z.string(), z.unknown()).optional(),
  }).optional(),
  frequency_penalty: z.number().min(-2).max(2).optional(),
  presence_penalty: z.number().min(-2).max(2).optional(),
  stop: z.union([z.string(), z.array(z.string()).max(4)]).nullable().optional(),
  logit_bias: z.record(z.string(), z.number().min(-100).max(100)).nullable().optional(),
  logprobs: z.boolean().nullable().optional(),
  top_logprobs: z.number().int().min(0).max(20).nullable().optional(),
  seed: z.number().int().nullable().optional(),
  user: z.string().optional(),
  store: z.boolean().optional(),
  metadata: z.record(z.string(), z.string()).nullable().optional(),
});


function isRetryableError(err: any): boolean {
  const msg = (err.message ?? '').toLowerCase();
  return msg.includes('429') || msg.includes('rate limit') || msg.includes('too many requests')
    || msg.includes('quota') || msg.includes('resource_exhausted')
    || msg.includes('aborted') || msg.includes('timeout') || msg.includes('etimedout')
    || msg.includes('econnrefused') || msg.includes('econnreset')
    || msg.includes('503') || msg.includes('unavailable')
    || msg.includes('500') || msg.includes('internal server error');
}

function isModelNotFoundError(err: any): boolean {
  const msg = (err.message ?? '').toLowerCase();
  return msg.includes('404')
    || msg.includes('model not found')
    || msg.includes('does not exist')
    || msg.includes('no longer available')
    || msg.includes('unknown model')
    || msg.includes('unavailable_model')
    || msg.includes('unavailable model');
}

function isInvalidKeyError(err: any): boolean {
  const msg = (err.message ?? '').toLowerCase();
  return msg.includes('401')
    || msg.includes('403')
    || msg.includes('unauthorized')
    || msg.includes('invalid api key')
    || msg.includes('invalid key')
    || msg.includes('authentication')
    || msg.includes('forbidden');
}

proxyRouter.post('/chat/completions', async (req: Request, res: Response) => {
  const start = Date.now();
  const disableFallback = req.headers['x-disable-fallback'] === 'true';

  // Authenticate with unified API key. Local requests (127.0.0.1) skip the check
  // since they came from the same machine running the server. Non-local requests
  // MUST present a valid Bearer token — missing or wrong → 401.
  //
  // Note: req.ip is the actual TCP socket peer because we never set
  // `trust proxy`, so X-Forwarded-For cannot spoof a localhost identity.
  // If a future change enables `trust proxy`, this localhost bypass MUST be
  // re-evaluated.
  const isLocal = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
  let clientKeyId: number | undefined;

  if (!isLocal || req.headers.authorization) {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '')?.trim();
    const unifiedKey = getUnifiedApiKey();

    if (!token) {
      res.status(401).json({
        error: { message: 'Missing API key', type: 'authentication_error' },
      });
      return;
    }

    if (!timingSafeStringEqual(token, unifiedKey)) {
      const clientAuth = validateClientApiKey(token);
      if (!clientAuth.isValid || !clientAuth.clientKey) {
        res.status(401).json({
          error: { message: clientAuth.error || 'Invalid API key', type: 'authentication_error' },
        });
        return;
      }
      clientKeyId = clientAuth.clientKey.id;
    }
  }

  // Validate request
  const parsed = chatCompletionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        message: `Invalid request: ${parsed.error.errors.map(e => e.message).join(', ')}`,
        type: 'invalid_request_error',
      },
    });
    return;
  }

  const { model: requestedModel, temperature, top_p, n, stream, tools, tool_choice, parallel_tool_calls, response_format,
    frequency_penalty, presence_penalty, stop, logit_bias, logprobs, top_logprobs, seed, user, store, metadata, stream_options,
    max_completion_tokens } = parsed.data;
  const max_tokens = parsed.data.max_tokens ?? parsed.data.max_completion_tokens;
  const messages: ChatMessage[] = parsed.data.messages.map((m): ChatMessage => {
    if (m.role === 'assistant') {
      return {
        role: 'assistant',
        content: m.content ?? null,
        ...(m.name ? { name: m.name } : {}),
        ...(m.tool_calls ? { tool_calls: m.tool_calls.map(tc => ({
          id: tc.id,
          type: tc.type,
          function: tc.function,
          thought_signature: tc.thought_signature,
        })) } : {}),
      };
    }

    if (m.role === 'tool') {
      return {
        role: 'tool',
        content: m.content,
        tool_call_id: m.tool_call_id,
        ...(m.name ? { name: m.name } : {}),
      };
    }

    return {
      role: m.role,
      content: m.content,
      ...(m.name ? { name: m.name } : {}),
    };
  });

  // Normalize all incoming image payloads (HEIC, TIFF, BMP, WebP, etc.) to standard LLM formats
  for (const m of messages) {
    if (Array.isArray(m.content)) {
      for (const part of m.content) {
        if (part && typeof part === 'object' && (part as any).type === 'image_url' && (part as any).image_url?.url) {
          try {
            const normalized = await normalizeImage((part as any).image_url.url);
            (part as any).image_url.url = normalized.dataUrl;
          } catch (e: any) {
            console.warn('[Proxy] Failed to normalize image, proceeding with original:', e.message);
          }
        }
      }
    }
  }

  // Detect image-to-image styling/transformation or text-to-image intent directly in chat
  // Uses LLM-based classification — no hardcoded patterns
  const imageIntent = await ImageSynthesisService.detectIntent(messages);
  if (imageIntent && !stream) {
    try {
      const synthesisResult = await ImageSynthesisService.executeSynthesis(imageIntent);
      const routedHeader = `${synthesisResult._routed_via?.platform}/${synthesisResult._routed_via?.model}`;
      res.setHeader('X-Routed-Via', routedHeader);
      res.json(synthesisResult);
      return;
    } catch (err: any) {
      console.warn('[Proxy] Image synthesis execution failed, falling back to standard LLM chat completion:', err.message);
    }
  }

  const isWebSearchRequested = Boolean(
    parsed.data.web_search ||
    parsed.data.search ||
    req.headers['x-web-search'] === 'true'
  );

  let searchExecuted = false;
  if (isWebSearchRequested) {
    const query = WebSearchService.extractQuery(messages);
    if (query) {
      const maxResults = typeof parsed.data.web_search === 'object' && parsed.data.web_search?.max_results
        ? parsed.data.web_search.max_results
        : 5;
      const searchResults = await WebSearchService.search(query, { maxResults });
      const searchMarkdown = WebSearchService.formatResultsToMarkdown(query, searchResults);
      messages.unshift({
        role: 'system',
        content: searchMarkdown,
      });
      searchExecuted = true;
    }
  }

  // ─── Response Cache (Fast Path) ──────────────────────────────────
  const isCacheEnabled = !stream && req.headers['x-no-cache'] !== 'true';
  if (isCacheEnabled) {
    const cached = ResponseCache.get({
      messages,
      model: requestedModel,
      temperature,
      top_p,
      tools,
    });
    if (cached) {
      res.setHeader('X-Cache', 'HIT');
      if (cached._routed_via) {
        res.setHeader('X-Routed-Via', `${cached._routed_via.platform}/${cached._routed_via.model} (cached)`);
      }
      res.json(cached);
      return;
    }
  }

  // Token estimation is intentionally a heuristic (~4 chars per token). Used
  // for routing decisions (skip a model whose budget is too small) and for
  // streaming bookkeeping where the provider doesn't echo a final usage count.
  // Non-streaming requests reconcile against the provider's real `usage` block
  // (see line ~340). Streaming will drift from real consumption — accepted
  // tradeoff because per-request usage isn't always returned mid-stream.
  const estimatedInputTokens = messages.reduce((sum, m) => {
    if (typeof m.content !== 'string') return sum;
    return sum + Math.ceil(m.content.length / 4);
  }, 0);
  const estimatedTotal = estimatedInputTokens + (max_tokens ?? 1000);

  // Explicit `model` field pins routing. If the catalog has no enabled row
  // matching the requested id, return 400 — silently auto-routing to a
  // different model would be surprising to OpenAI-compatible clients.
  // Sticky-session is the fallback when no `model` field was sent at all.
  let preferredModel: number | undefined;
  if (requestedModel && requestedModel !== 'auto') {
    const db = getDb();
    const modelRow = db.prepare('SELECT id, platform FROM models WHERE model_id = ? AND enabled = 1').get(requestedModel) as { id: number; platform: string } | undefined;

    let hasKeys = false;
    if (modelRow) {
      const keysCount = db.prepare('SELECT COUNT(*) as count FROM api_keys WHERE platform = ? AND enabled = 1 AND status != ?')
        .get(modelRow.platform, 'invalid') as { count: number } | undefined;
      hasKeys = (keysCount?.count ?? 0) > 0;
    }

    if (modelRow && hasKeys) {
      preferredModel = modelRow.id;
    } else {
      const isStandardOpenAiModel = requestedModel.startsWith('gpt-') || requestedModel.startsWith('o1-') || requestedModel.startsWith('o3-');
      if (isStandardOpenAiModel) {
        console.warn(`[Proxy] Model '${requestedModel}' is not available (either not in catalog or lacks configured keys). Auto-routing to best available alternative.`);
        preferredModel = undefined;
      } else {
        const disabled = db.prepare('SELECT id FROM models WHERE model_id = ?').get(requestedModel) as { id: number } | undefined;
        const reason = disabled ? 'is disabled' : 'is not in the catalog';
        res.status(400).json({
          error: {
            message: `Model '${requestedModel}' ${reason}. Omit the 'model' field to auto-route, or call /v1/models for the available list.`,
            type: 'invalid_request_error',
            code: 'model_not_found',
          },
        });
        return;
      }
    }
  } else {
    // LLM-powered smart workload classification for auto-routing
    try {
      const classification = await SmartClassifier.classify(messages);
      res.setHeader('X-Workload-Category', classification.category);

      const db = getDb();
      if (classification.category === 'code') {
        const row = db.prepare(`
          SELECT id FROM models 
          WHERE enabled = 1 AND (model_id LIKE '%coder%' OR model_id LIKE '%flash%')
          ORDER BY speed_rank ASC LIMIT 1
        `).get() as { id: number } | undefined;
        if (row) preferredModel = row.id;
      } else if (classification.category === 'reasoning_math') {
        const row = db.prepare(`
          SELECT id FROM models 
          WHERE enabled = 1 AND (model_id LIKE '%pro%' OR model_id LIKE '%r1%' OR model_id LIKE '%reasoning%')
          ORDER BY intelligence_rank ASC LIMIT 1
        `).get() as { id: number } | undefined;
        if (row) preferredModel = row.id;
      } else if (classification.category === 'conversational_fast') {
        const row = db.prepare(`
          SELECT id FROM models 
          WHERE enabled = 1 AND (platform = 'cerebras' OR platform = 'groq')
          ORDER BY speed_rank ASC LIMIT 1
        `).get() as { id: number } | undefined;
        if (row) preferredModel = row.id;
      }
    } catch {
      // Gracefully continue to sticky model on classifier error
    }

    if (!preferredModel) {
      preferredModel = getStickyModel(messages);
    }
  }

  // Retry loop: on 429/rate limit, skip that model+key and try the next one
  const skipKeys = new Set<string>();
  let lastError: any = null;
  const forceModel = disableFallback && !!requestedModel;

  const hasImage = messages.some(m => Array.isArray(m.content) && m.content.some(part => part.type === 'image_url'));

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let route: RouteResult;
    try {
      route = routeRequest(estimatedTotal, skipKeys.size > 0 ? skipKeys : undefined, preferredModel, forceModel, hasImage);
    } catch (err: any) {
      // No more models available
      if (lastError) {
        res.status(429).json({
          error: {
            message: `All models rate-limited. Last error: ${lastError.message}`,
            type: 'rate_limit_error',
          },
        });
      } else {
        res.status(err.status ?? 503).json({
          error: { message: err.message, type: 'routing_error' },
        });
      }
      return;
    }

    recordRequest(route.platform, route.modelId, route.keyId);

    try {
      if (stream) {
        // Lazy header set: pre-stream errors stay retryable (no headers sent yet);
        // mid-stream errors emit an `error` SSE frame so the client sees a real signal
        // instead of a silently truncated stream.
        let totalOutputTokens = 0;
        let streamStarted = false;
        try {
          const gen = route.provider.streamChatCompletion(
            route.apiKey, messages, route.modelId,
            { temperature, max_tokens, top_p, tools, tool_choice, parallel_tool_calls, web_search: isWebSearchRequested, response_format,
              frequency_penalty, presence_penalty, stop, logit_bias, logprobs, top_logprobs, seed },
          );

          for await (const chunk of gen) {
            if (!streamStarted) {
              res.setHeader('Content-Type', 'text/event-stream');
              res.setHeader('Cache-Control', 'no-cache');
              res.setHeader('Connection', 'keep-alive');
              res.setHeader('X-Routed-Via', `${route.platform}/${route.modelId}`);
              if (searchExecuted) res.setHeader('X-Web-Search', 'executed');
              if (attempt > 0) res.setHeader('X-Fallback-Attempts', String(attempt));
              streamStarted = true;
            }
            const text = chunk.choices[0]?.delta?.content ?? '';
            totalOutputTokens += Math.ceil(text.length / 4);
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }

          if (!streamStarted) {
            // Upstream returned no chunks — emit minimal successful stream.
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('X-Routed-Via', `${route.platform}/${route.modelId}`);
            if (searchExecuted) res.setHeader('X-Web-Search', 'executed');
          }
          // Emit final usage chunk if stream_options.include_usage is true
          if (stream_options?.include_usage) {
            const usageChunk = {
              id: `chatcmpl-${crypto.randomUUID()}`,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: route.modelId,
              choices: [],
              usage: {
                prompt_tokens: estimatedInputTokens,
                completion_tokens: totalOutputTokens,
                total_tokens: estimatedInputTokens + totalOutputTokens,
              },
            };
            res.write(`data: ${JSON.stringify(usageChunk)}\n\n`);
          }
          res.write('data: [DONE]\n\n');
          res.end();

          recordTokens(route.platform, route.modelId, route.keyId, estimatedInputTokens + totalOutputTokens);
          if (clientKeyId) recordClientKeyUsage(clientKeyId, estimatedInputTokens + totalOutputTokens);
          recordSuccess(route.modelDbId);
          setStickyModel(messages, route.modelDbId);
          try {
            const db = getDb();
            db.prepare("UPDATE api_keys SET status = 'healthy', error_message = NULL WHERE id = ?").run(route.keyId);
          } catch (dbErr) {
            console.error('[Proxy] Failed to update key status on success:', dbErr);
          }
          logRequest(route.platform, route.modelId, 'success', estimatedInputTokens, totalOutputTokens, Date.now() - start, null);
          return;
        } catch (streamErr: any) {
          if (streamStarted) {
            // Mid-stream error — finish the SSE response cleanly instead of leaving
            // the client hanging or letting Express's default handler take over.
            // Full upstream message goes to the log; the client sees a generic
            // message so we don't leak provider internals into a partial stream.
            console.error(`[Proxy] Mid-stream error from ${route.displayName}:`, streamErr.message);
            const payload = { error: { message: `Provider error (${route.displayName}): stream interrupted`, type: 'stream_error' } };
            try { res.write(`data: ${JSON.stringify(payload)}\n\n`); } catch { /* socket gone */ }
            try { res.write('data: [DONE]\n\n'); res.end(); } catch { /* socket gone */ }
            logRequest(route.platform, route.modelId, 'error', estimatedInputTokens, totalOutputTokens, Date.now() - start, streamErr.message);
            return;
          }
          // Pre-stream error — bubble to outer retry/502 handler.
          throw streamErr;
        }
      } else {
        let result: any;
        if (n > 1) {
          const completionPromises: Promise<any>[] = [];
          for (let i = 0; i < n; i++) {
            const effTemp = temperature !== undefined ? Math.min(2, temperature + i * 0.1) : undefined;
            completionPromises.push(
              route.provider.chatCompletion(
                route.apiKey, messages, route.modelId,
                { temperature: effTemp, max_tokens, top_p, tools, tool_choice, parallel_tool_calls, web_search: isWebSearchRequested, response_format,
                  frequency_penalty, presence_penalty, stop, logit_bias, logprobs, top_logprobs, seed },
              )
            );
          }
          const allResults = await Promise.all(completionPromises);
          const firstResult = allResults[0];
          const choices = allResults.flatMap((r, i) =>
            (r.choices ?? []).map((c: any) => ({
              ...c,
              index: i,
            }))
          );
          const promptTokens = firstResult.usage?.prompt_tokens ?? estimatedInputTokens;
          const completionTokens = allResults.reduce((sum, r) => sum + (r.usage?.completion_tokens ?? 0), 0);
          result = {
            ...firstResult,
            choices,
            usage: {
              prompt_tokens: promptTokens,
              completion_tokens: completionTokens,
              total_tokens: promptTokens + completionTokens,
            },
          };
        } else {
          result = await route.provider.chatCompletion(
            route.apiKey, messages, route.modelId,
            { temperature, max_tokens, top_p, tools, tool_choice, parallel_tool_calls, web_search: isWebSearchRequested, response_format,
              frequency_penalty, presence_penalty, stop, logit_bias, logprobs, top_logprobs, seed },
          );
        }

        const totalTokens = result.usage?.total_tokens ?? 0;
        recordTokens(route.platform, route.modelId, route.keyId, totalTokens);
        if (clientKeyId) recordClientKeyUsage(clientKeyId, totalTokens);
        recordSuccess(route.modelDbId);
        setStickyModel(messages, route.modelDbId);
        try {
          const db = getDb();
          db.prepare("UPDATE api_keys SET status = 'healthy', error_message = NULL WHERE id = ?").run(route.keyId);
        } catch (dbErr) {
          console.error('[Proxy] Failed to update key status on success:', dbErr);
        }

        res.setHeader('X-Routed-Via', `${route.platform}/${route.modelId}`);
        if (searchExecuted) res.setHeader('X-Web-Search', 'executed');
        if (attempt > 0) res.setHeader('X-Fallback-Attempts', String(attempt));
        res.json(result);

        if (isCacheEnabled) {
          ResponseCache.set({
            messages,
            model: requestedModel,
            temperature,
            top_p,
            tools,
          }, result);
        }

        // Persist stored completions when store: true
        if (store) {
          try {
            const db = getDb();
            db.prepare(`
              INSERT OR IGNORE INTO stored_completions (id, object, created, model, choices, usage, system_fingerprint, metadata, messages)
              VALUES (?, 'chat.completion', ?, ?, ?, ?, ?, ?, ?)
            `).run(
              result.id,
              result.created,
              result.model,
              JSON.stringify(result.choices),
              JSON.stringify(result.usage),
              result.system_fingerprint || null,
              JSON.stringify(metadata || {}),
              JSON.stringify(parsed.data.messages),
            );
          } catch (storeErr) {
            console.error('[Proxy] Failed to store completion:', storeErr);
          }
        }

        logRequest(
          route.platform, route.modelId, 'success',
          result.usage?.prompt_tokens ?? 0,
          result.usage?.completion_tokens ?? 0,
          Date.now() - start, null,
        );
        return;
      }
    } catch (err: any) {
      const latency = Date.now() - start;
      logRequest(route.platform, route.modelId, 'error', estimatedInputTokens, 0, latency, err.message);

      const isModelNotFound = isModelNotFoundError(err);
      const isInvalidKey = isInvalidKeyError(err);

      if (isModelNotFound) {
        try {
          const db = getDb();
          db.prepare('UPDATE models SET enabled = 0 WHERE id = ?').run(route.modelDbId);
          console.warn(`[Proxy] Model '${route.modelId}' on platform '${route.platform}' returned 404 (not found). Automatically disabling this model in the database.`);
        } catch (dbErr) {
          console.error('[Proxy] Failed to disable model in DB:', dbErr);
        }
      }

      if (isInvalidKey) {
        try {
          const db = getDb();
          db.prepare("UPDATE api_keys SET status = 'invalid', enabled = 0 WHERE id = ?").run(route.keyId);
          console.warn(`[Proxy] Key ID ${route.keyId} for platform '${route.platform}' returned 401/403 (unauthorized). Automatically disabling this key in the database.`);
        } catch (dbErr) {
          console.error('[Proxy] Failed to disable key in DB:', dbErr);
        }
      }

      if (isRetryableError(err) || isModelNotFound || isInvalidKey) {
        // Put this model+key on cooldown and try the next one
        const skipId = `${route.platform}:${route.modelId}:${route.keyId}`;
        skipKeys.add(skipId);
        setCooldown(route.platform, route.modelId, route.keyId, undefined, err.message);
        recordRateLimitHit(route.modelDbId);
        lastError = err;
        console.log(`[Proxy] ${err.message.slice(0, 60)} from ${route.displayName}, falling back (attempt ${attempt + 1}/${MAX_RETRIES})`);
        continue;
      }

      // Non-retryable error (other 4xx, etc.): don't retry
      res.status(502).json({
        error: {
          message: `Provider error (${route.displayName}): ${err.message}`,
          type: 'provider_error',
        },
      });
      return;
    }
  }

  // Exhausted all retries
  res.status(429).json({
    error: {
      message: `All models rate-limited after ${MAX_RETRIES} attempts. Last: ${lastError?.message}`,
      type: 'rate_limit_error',
    },
  });
});

function logRequest(
  platform: string,
  modelId: string,
  status: string,
  inputTokens: number,
  outputTokens: number,
  latencyMs: number,
  error: string | null,
) {
  try {
    const db = getDb();
    db.prepare(`
      INSERT INTO requests (platform, model_id, status, input_tokens, output_tokens, latency_ms, error)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(platform, modelId, status, inputTokens, outputTokens, latencyMs, error);
  } catch (e) {
    console.error('Failed to log request:', e);
  }
}

// ---- GET /v1/models/:model — Retrieve individual model ----
proxyRouter.get('/models/:model', (req: Request, res: Response) => {
  const modelId = req.params.model;
  const db = getDb();
  const row = db.prepare('SELECT platform, model_id, display_name, context_window FROM models WHERE model_id = ? AND enabled = 1').get(modelId) as any;
  if (!row) {
    res.status(404).json({
      error: { message: `The model '${modelId}' does not exist`, type: 'invalid_request_error', code: 'model_not_found' },
    });
    return;
  }
  res.json({
    id: row.model_id,
    object: 'model',
    created: 0,
    owned_by: row.platform,
  });
});

// ---- DELETE /v1/models/:model — Delete fine-tuned model (stub) ----
proxyRouter.delete('/models/:model', (req: Request, res: Response) => {
  res.json({
    id: req.params.model,
    object: 'model',
    deleted: true,
  });
});

// ---- Stored Chat Completions CRUD ----

// GET /v1/chat/completions — List stored completions
proxyRouter.get('/chat/completions', (req: Request, res: Response) => {
  const db = getDb();
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const order = req.query.order === 'asc' ? 'ASC' : 'DESC';
  const after = req.query.after as string | undefined;
  const model = req.query.model as string | undefined;

  let query = 'SELECT * FROM stored_completions';
  const params: any[] = [];
  const conditions: string[] = [];

  if (after) {
    const afterRow = db.prepare('SELECT created FROM stored_completions WHERE id = ?').get(after) as any;
    if (afterRow) {
      conditions.push(order === 'DESC' ? 'created < ?' : 'created > ?');
      params.push(afterRow.created);
    }
  }
  if (model) {
    conditions.push('model = ?');
    params.push(model);
  }

  // Handle metadata filtering: metadata[key]=value query params
  for (const key of Object.keys(req.query)) {
    const match = key.match(/^metadata\[(.+)\]$/);
    if (match) {
      conditions.push(`json_extract(metadata, '$.' || ?) = ?`);
      params.push(match[1], req.query[key] as string);
    }
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  query += ` ORDER BY created ${order} LIMIT ?`;
  params.push(limit + 1);

  const rows = db.prepare(query).all(...params) as any[];
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit).map(r => ({
    id: r.id,
    object: r.object,
    created: r.created,
    model: r.model,
    choices: JSON.parse(r.choices),
    usage: r.usage ? JSON.parse(r.usage) : null,
    system_fingerprint: r.system_fingerprint,
    metadata: r.metadata ? JSON.parse(r.metadata) : {},
  }));

  res.json({
    object: 'list',
    data,
    first_id: data.length > 0 ? data[0].id : null,
    last_id: data.length > 0 ? data[data.length - 1].id : null,
    has_more: hasMore,
  });
});

// GET /v1/chat/completions/:completion_id — Retrieve stored completion
proxyRouter.get('/chat/completions/:completion_id', (req: Request, res: Response) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM stored_completions WHERE id = ?').get(req.params.completion_id) as any;
  if (!row) {
    res.status(404).json({
      error: { message: 'Chat completion not found', type: 'invalid_request_error' },
    });
    return;
  }
  res.json({
    id: row.id,
    object: row.object,
    created: row.created,
    model: row.model,
    choices: JSON.parse(row.choices),
    usage: row.usage ? JSON.parse(row.usage) : null,
    system_fingerprint: row.system_fingerprint,
    metadata: row.metadata ? JSON.parse(row.metadata) : {},
  });
});

// POST /v1/chat/completions/:completion_id — Modify metadata
proxyRouter.post('/chat/completions/:completion_id', (req: Request, res: Response) => {
  const db = getDb();
  const row = db.prepare('SELECT * FROM stored_completions WHERE id = ?').get(req.params.completion_id) as any;
  if (!row) {
    res.status(404).json({
      error: { message: 'Chat completion not found', type: 'invalid_request_error' },
    });
    return;
  }
  if (req.body.metadata) {
    db.prepare('UPDATE stored_completions SET metadata = ? WHERE id = ?').run(
      JSON.stringify(req.body.metadata),
      req.params.completion_id,
    );
  }
  const updated = db.prepare('SELECT * FROM stored_completions WHERE id = ?').get(req.params.completion_id) as any;
  res.json({
    id: updated.id,
    object: updated.object,
    created: updated.created,
    model: updated.model,
    choices: JSON.parse(updated.choices),
    usage: updated.usage ? JSON.parse(updated.usage) : null,
    system_fingerprint: updated.system_fingerprint,
    metadata: updated.metadata ? JSON.parse(updated.metadata) : {},
  });
});

// DELETE /v1/chat/completions/:completion_id — Delete stored completion
proxyRouter.delete('/chat/completions/:completion_id', (req: Request, res: Response) => {
  const db = getDb();
  const info = db.prepare('DELETE FROM stored_completions WHERE id = ?').run(req.params.completion_id);
  if (info.changes === 0) {
    res.status(404).json({
      error: { message: 'Chat completion not found', type: 'invalid_request_error' },
    });
    return;
  }
  res.json({
    id: req.params.completion_id,
    object: 'chat.completion.deleted',
    deleted: true,
  });
});

// GET /v1/chat/completions/:completion_id/messages — Get input messages
proxyRouter.get('/chat/completions/:completion_id/messages', (req: Request, res: Response) => {
  const db = getDb();
  const row = db.prepare('SELECT messages FROM stored_completions WHERE id = ?').get(req.params.completion_id) as any;
  if (!row) {
    res.status(404).json({
      error: { message: 'Chat completion not found', type: 'invalid_request_error' },
    });
    return;
  }
  const messages = JSON.parse(row.messages);
  const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
  const order = req.query.order === 'asc' ? messages : [...messages].reverse();
  const data = order.slice(0, limit);

  res.json({
    object: 'list',
    data,
    first_id: data.length > 0 ? `msg-0` : null,
    last_id: data.length > 0 ? `msg-${data.length - 1}` : null,
    has_more: order.length > limit,
  });
});
