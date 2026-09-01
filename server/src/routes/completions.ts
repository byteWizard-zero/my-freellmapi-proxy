import crypto from 'crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { ChatMessage, CompletionResponse, CompletionChoice } from '@freellmapi/shared/types.js';
import { routeRequest, recordRateLimitHit, recordSuccess, type RouteResult } from '../services/router.js';
import { recordRequest, recordTokens, setCooldown } from '../services/ratelimit.js';
import { getDb, getUnifiedApiKey, validateClientApiKey, recordClientKeyUsage } from '../db/index.js';

export const completionsRouter = Router();

function timingSafeStringEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  const compareA = a.length === b.length ? a : Buffer.alloc(b.length);
  return crypto.timingSafeEqual(compareA, b) && a.length === b.length;
}

const completionSchema = z.object({
  model: z.string().optional(),
  prompt: z.union([z.string(), z.array(z.string())]),
  max_tokens: z.number().int().positive().optional().default(100),
  temperature: z.number().min(0).max(2).optional(),
  top_p: z.number().min(0).max(1).optional(),
  n: z.number().int().min(1).max(10).optional().default(1),
  stream: z.boolean().optional(),
  logprobs: z.number().int().nullable().optional(),
  echo: z.boolean().optional(),
  stop: z.union([z.string(), z.array(z.string())]).optional(),
  user: z.string().optional(),
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

completionsRouter.post('/', async (req: Request, res: Response) => {
  const start = Date.now();
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

  const parsed = completionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: {
        message: `Invalid request: ${parsed.error.errors.map(e => e.message).join(', ')}`,
        type: 'invalid_request_error',
      },
    });
    return;
  }

  const { model: requestedModel, prompt: rawPrompt, max_tokens, temperature, top_p, n, stream } = parsed.data;
  const promptText = Array.isArray(rawPrompt) ? rawPrompt.join('\n') : rawPrompt;
  const messages: ChatMessage[] = [
    { role: 'user', content: promptText },
  ];

  const estimatedInputTokens = Math.ceil(promptText.length / 4);
  const estimatedTotal = (estimatedInputTokens + max_tokens) * n;

  let preferredModel: number | undefined;
  if (requestedModel && requestedModel !== 'auto') {
    const db = getDb();
    const modelRow = db.prepare('SELECT id, platform FROM models WHERE model_id = ? AND enabled = 1').get(requestedModel) as { id: number; platform: string } | undefined;
    if (modelRow) {
      preferredModel = modelRow.id;
    }
  }

  const skipKeys = new Set<string>();
  const MAX_RETRIES = 20;
  let lastError: any = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    let route: RouteResult;
    try {
      route = routeRequest(estimatedTotal, skipKeys.size > 0 ? skipKeys : undefined, preferredModel, false, false);
    } catch (err: any) {
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
        let streamStarted = false;
        let totalOutputTokens = 0;
        const cmplId = `cmpl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const created = Math.floor(Date.now() / 1000);

        try {
          const gen = route.provider.streamChatCompletion(
            route.apiKey,
            messages,
            route.modelId,
            { temperature, max_tokens, top_p },
          );

          for await (const chunk of gen) {
            if (!streamStarted) {
              res.setHeader('Content-Type', 'text/event-stream');
              res.setHeader('Cache-Control', 'no-cache');
              res.setHeader('Connection', 'keep-alive');
              res.setHeader('X-Routed-Via', `${route.platform}/${route.modelId}`);
              streamStarted = true;
            }

            const text = chunk.choices[0]?.delta?.content ?? '';
            totalOutputTokens += Math.ceil(text.length / 4);

            const completionChunk = {
              id: cmplId,
              object: 'text_completion',
              created,
              model: route.modelId,
              choices: [
                {
                  text,
                  index: 0,
                  logprobs: null,
                  finish_reason: chunk.choices[0]?.finish_reason ?? null,
                },
              ],
            };

            res.write(`data: ${JSON.stringify(completionChunk)}\n\n`);
          }

          res.write('data: [DONE]\n\n');
          res.end();

          const totalTokens = estimatedInputTokens + totalOutputTokens;
          recordTokens(route.platform, route.modelId, route.keyId, totalTokens);
          if (clientKeyId) recordClientKeyUsage(clientKeyId, totalTokens);
          recordSuccess(route.modelDbId);

          try {
            const db = getDb();
            db.prepare(`
              INSERT INTO requests (platform, model_id, status, input_tokens, output_tokens, latency_ms, error)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(route.platform, route.modelId, 'success', estimatedInputTokens, totalOutputTokens, Date.now() - start, null);
          } catch {}

          return;
        } catch (streamErr: any) {
          if (streamStarted) {
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }
          throw streamErr;
        }
      } else {
        // Non-streaming: handle n completions
        const completionPromises: Promise<any>[] = [];
        for (let i = 0; i < n; i++) {
          const effTemp = temperature !== undefined ? (n > 1 ? Math.min(2, temperature + i * 0.1) : temperature) : undefined;
          completionPromises.push(
            route.provider.chatCompletion(
              route.apiKey,
              messages,
              route.modelId,
              { temperature: effTemp, max_tokens, top_p },
            )
          );
        }

        const chatResults = await Promise.all(completionPromises);
        const choices: CompletionChoice[] = chatResults.map((cr, idx) => {
          const choiceMsg = cr.choices?.[0]?.message;
          const text = typeof choiceMsg?.content === 'string' ? choiceMsg.content : (Array.isArray(choiceMsg?.content) ? choiceMsg.content.map((c: any) => c.text || '').join('') : '');
          return {
            text,
            index: idx,
            logprobs: null,
            finish_reason: cr.choices?.[0]?.finish_reason || 'stop',
          };
        });

        const promptTokens = chatResults[0]?.usage?.prompt_tokens ?? estimatedInputTokens;
        const completionTokens = chatResults.reduce((sum, cr) => sum + (cr.usage?.completion_tokens ?? 0), 0);
        const totalTokens = promptTokens + completionTokens;

        recordTokens(route.platform, route.modelId, route.keyId, totalTokens);
        if (clientKeyId) recordClientKeyUsage(clientKeyId, totalTokens);
        recordSuccess(route.modelDbId);

        const responsePayload: CompletionResponse = {
          id: `cmpl-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          object: 'text_completion',
          created: Math.floor(Date.now() / 1000),
          model: route.modelId,
          choices,
          usage: {
            prompt_tokens: promptTokens,
            completion_tokens: completionTokens,
            total_tokens: totalTokens,
          },
          _routed_via: {
            platform: route.platform as any,
            model: route.modelId,
          },
        };

        try {
          const db = getDb();
          db.prepare(`
            INSERT INTO requests (platform, model_id, status, input_tokens, output_tokens, latency_ms, error)
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `).run(route.platform, route.modelId, 'success', promptTokens, completionTokens, Date.now() - start, null);
        } catch {}

        res.setHeader('X-Routed-Via', `${route.platform}/${route.modelId}`);
        res.json(responsePayload);
        return;
      }
    } catch (err: any) {
      if (isRetryableError(err)) {
        const skipId = `${route.platform}:${route.modelId}:${route.keyId}`;
        skipKeys.add(skipId);
        setCooldown(route.platform, route.modelId, route.keyId, 43_200_000, err.message);
        recordRateLimitHit(route.modelDbId);
        lastError = err;
        continue;
      }

      res.status(502).json({
        error: {
          message: `Provider error (${route.displayName}): ${err.message}`,
          type: 'provider_error',
        },
      });
      return;
    }
  }

  res.status(429).json({
    error: {
      message: `All models rate-limited after ${MAX_RETRIES} attempts. Last: ${lastError?.message}`,
      type: 'rate_limit_error',
    },
  });
});
