import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { getDb, getUnifiedApiKey } from '../db/index.js';
import { executeResponse } from '../services/response-executor.js';

export const responsesRouter = Router();

function authenticateRequest(req: Request, res: Response): boolean {
  const isLocal = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
  if (!isLocal) {
    const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    const unifiedKey = getUnifiedApiKey();
    if (!token || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(unifiedKey))) {
      res.status(401).json({ error: { message: 'Invalid API key', type: 'authentication_error' } });
      return false;
    }
  }
  return true;
}

const createResponseSchema = z.object({
  model: z.string(),
  input: z.union([z.string(), z.array(z.any())]).optional(),
  instructions: z.string().optional(),
  previous_response_id: z.string().optional(),
  store: z.boolean().default(true),
  stream: z.boolean().default(false),
  tools: z.array(z.any()).optional(),
  tool_choice: z.any().optional(),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  max_output_tokens: z.number().optional(),
  metadata: z.record(z.string()).optional()
});

responsesRouter.post('/', async (req, res) => {
  if (!authenticateRequest(req, res)) return;

  const parsed = createResponseSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { message: 'Invalid request body', type: 'invalid_request_error' } });
  }

  const { model, input, instructions, previous_response_id, store, stream, tools, tool_choice, temperature, top_p, max_output_tokens, metadata } = parsed.data;
  
  if (stream) {
    return res.status(400).json({ error: { message: 'Streaming Responses API not implemented', type: 'invalid_request_error' } });
  }

  const db = getDb();
  let chatMessages: any[] = [];

  if (previous_response_id) {
    const prevResponse = db.prepare('SELECT * FROM responses WHERE id = ?').get(previous_response_id) as any;
    if (prevResponse) {
      if (prevResponse.input) {
        const parsedInput = JSON.parse(prevResponse.input);
        if (Array.isArray(parsedInput)) {
          // Simplistic extraction of previous context. Production needs more sophisticated merging.
          parsedInput.forEach(i => {
            if (i.role) chatMessages.push(i);
          });
        }
      }
      if (prevResponse.output) {
        const parsedOutput = JSON.parse(prevResponse.output);
        if (Array.isArray(parsedOutput)) {
          parsedOutput.forEach(o => {
            if (o.type === 'message') {
              chatMessages.push({
                role: o.role,
                content: o.content.map((c: any) => c.text).join('')
              });
            }
          });
        }
      }
    }
  }

  if (instructions) {
    chatMessages.push({ role: 'system', content: instructions });
  }

  if (input) {
    if (typeof input === 'string') {
      chatMessages.push({ role: 'user', content: input });
    } else if (Array.isArray(input)) {
      input.forEach(item => {
        if (item.type === 'message') {
          chatMessages.push(item);
        } else if (item.type === 'input_text') {
          chatMessages.push({ role: 'user', content: item.text });
        }
      });
    }
  }

  try {
    const result = await executeResponse({
      model,
      messages: chatMessages,
      tools,
      tool_choice,
      temperature,
      top_p,
      max_tokens: max_output_tokens
    });

    const responseId = `resp_${crypto.randomUUID()}`;
    const now = Math.floor(Date.now() / 1000);

    const responseObject = {
      id: responseId,
      object: 'response',
      created_at: now,
      model,
      status: 'completed',
      output: result.output,
      usage: result.usage,
      error: null,
      metadata: metadata || {},
      temperature: temperature || null,
      top_p: top_p || null,
      max_output_tokens: max_output_tokens || null,
      previous_response_id: previous_response_id || null
    };

    if (store) {
      const insertStmt = db.prepare(`
        INSERT INTO responses (
          id, created_at, model, status, output, usage, input, instructions,
          previous_response_id, metadata, temperature, top_p, max_output_tokens
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insertStmt.run(
        responseId,
        now,
        model,
        'completed',
        JSON.stringify(result.output),
        JSON.stringify(result.usage || {}),
        JSON.stringify(input || []),
        instructions || null,
        previous_response_id || null,
        JSON.stringify(metadata || {}),
        temperature || null,
        top_p || null,
        max_output_tokens || null
      );
    }

    res.status(200).json(responseObject);

  } catch (e: any) {
    res.status(500).json({ error: { message: e.message || 'Internal server error', type: 'api_error' } });
  }
});

responsesRouter.get('/:response_id', (req, res) => {
  if (!authenticateRequest(req, res)) return;

  const db = getDb();
  const response = db.prepare('SELECT * FROM responses WHERE id = ?').get(req.params.response_id) as any;

  if (!response) {
    return res.status(404).json({ error: { message: 'Response not found', type: 'invalid_request_error' } });
  }

  res.status(200).json({
    id: response.id,
    object: response.object,
    created_at: response.created_at,
    model: response.model,
    status: response.status,
    output: JSON.parse(response.output || '[]'),
    usage: response.usage ? JSON.parse(response.usage) : null,
    error: response.error ? JSON.parse(response.error) : null,
    metadata: JSON.parse(response.metadata || '{}'),
    temperature: response.temperature,
    top_p: response.top_p,
    max_output_tokens: response.max_output_tokens,
    previous_response_id: response.previous_response_id
  });
});

responsesRouter.delete('/:response_id', (req, res) => {
  if (!authenticateRequest(req, res)) return;

  const db = getDb();
  const info = db.prepare('DELETE FROM responses WHERE id = ?').run(req.params.response_id);

  if (info.changes === 0) {
    return res.status(404).json({ error: { message: 'Response not found', type: 'invalid_request_error' } });
  }

  res.status(200).json({ id: req.params.response_id, object: 'response.deleted', deleted: true });
});

responsesRouter.post('/:response_id/cancel', (req, res) => {
  if (!authenticateRequest(req, res)) return;

  const db = getDb();
  const response = db.prepare('SELECT * FROM responses WHERE id = ?').get(req.params.response_id) as any;

  if (!response) {
    return res.status(404).json({ error: { message: 'Response not found', type: 'invalid_request_error' } });
  }

  db.prepare('UPDATE responses SET status = ? WHERE id = ?').run('cancelled', req.params.response_id);
  
  response.status = 'cancelled';
  res.status(200).json({
    id: response.id,
    object: response.object,
    created_at: response.created_at,
    model: response.model,
    status: 'cancelled',
    output: JSON.parse(response.output || '[]'),
    usage: response.usage ? JSON.parse(response.usage) : null,
    metadata: JSON.parse(response.metadata || '{}')
  });
});

responsesRouter.get('/:response_id/input_items', (req, res) => {
  if (!authenticateRequest(req, res)) return;

  const db = getDb();
  const response = db.prepare('SELECT input FROM responses WHERE id = ?').get(req.params.response_id) as any;

  if (!response) {
    return res.status(404).json({ error: { message: 'Response not found', type: 'invalid_request_error' } });
  }

  res.status(200).json({
    object: 'list',
    data: JSON.parse(response.input || '[]')
  });
});
