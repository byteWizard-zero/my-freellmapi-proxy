import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb } from '../../db/index.js';
import { encrypt } from '../../lib/crypto.js';
import { getProvider } from '../../providers/index.js';

async function sendRequest(app: Express, method: string, path: string, body?: any) {
  const server = app.listen(0);
  const addr = server.address() as any;
  const url = `http://127.0.0.1:${addr.port}${path}`;

  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await res.json().catch(() => null);
    const headers = Object.fromEntries(res.headers.entries());
    return { status: res.status, body: data, headers };
  } finally {
    server.close();
  }
}

describe('Legacy Completions API (/v1/completions)', () => {
  let app: Express;

  beforeEach(() => {
    const db = initDb(':memory:');
    const { encrypted, iv, authTag } = encrypt('mock-groq-key');
    db.prepare(
      "INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled) VALUES ('groq', 'Test Key', ?, ?, ?, 'healthy', 1)"
    ).run(encrypted, iv, authTag);
    app = createApp();
  });

  it('rejects requests with missing prompt', async () => {
    const { status, body } = await sendRequest(app, 'POST', '/v1/completions', {});
    expect(status).toBe(400);
    expect(body.error).toBeDefined();
    expect(body.error.type).toBe('invalid_request_error');
  });

  it('completes prompt and returns text_completion object', async () => {
    const groq = getProvider('groq');
    if (groq) {
      vi.spyOn(groq, 'chatCompletion').mockResolvedValueOnce({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 1740000000,
        model: 'llama-3.3-70b-versatile',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Here is completed text.' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 6, completion_tokens: 5, total_tokens: 11 },
      });
    }

    const { status, body, headers } = await sendRequest(app, 'POST', '/v1/completions', {
      prompt: 'Write a haiku:',
      max_tokens: 50,
    });

    expect(status).toBe(200);
    expect(body.object).toBe('text_completion');
    expect(body.choices).toHaveLength(1);
    expect(body.choices[0].text).toBe('Here is completed text.');
    expect(headers['x-routed-via']).toBeDefined();
  });

  it('handles n > 1 completions', async () => {
    const groq = getProvider('groq');
    if (groq) {
      vi.spyOn(groq, 'chatCompletion')
        .mockResolvedValueOnce({
          id: 'chatcmpl-1',
          object: 'chat.completion',
          created: 1740000000,
          model: 'llama-3.3-70b-versatile',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Choice 1' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
        })
        .mockResolvedValueOnce({
          id: 'chatcmpl-2',
          object: 'chat.completion',
          created: 1740000000,
          model: 'llama-3.3-70b-versatile',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Choice 2' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 4, completion_tokens: 2, total_tokens: 6 },
        });
    }

    const { status, body } = await sendRequest(app, 'POST', '/v1/completions', {
      prompt: 'Suggest names:',
      n: 2,
    });

    expect(status).toBe(200);
    expect(body.choices).toHaveLength(2);
    expect(body.choices[0].text).toBe('Choice 1');
    expect(body.choices[1].text).toBe('Choice 2');
    expect(body.choices[1].index).toBe(1);
    expect(body.usage.completion_tokens).toBe(4);
  });
});
