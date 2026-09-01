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
    return { status: res.status, body: data };
  } finally {
    server.close();
  }
}

describe('Proxy n > 1 completions', () => {
  let app: Express;

  beforeEach(() => {
    const db = initDb(':memory:');
    const { encrypted, iv, authTag } = encrypt('mock-groq-key');
    db.prepare(
      "INSERT INTO api_keys (platform, label, encrypted_key, iv, auth_tag, status, enabled) VALUES ('groq', 'Test Key', ?, ?, ?, 'healthy', 1)"
    ).run(encrypted, iv, authTag);
    app = createApp();
  });

  it('returns n choices for chat completion with aggregated tokens', async () => {
    const groq = getProvider('groq');
    if (groq) {
      vi.spyOn(groq, 'chatCompletion')
        .mockResolvedValueOnce({
          id: 'chatcmpl-1',
          object: 'chat.completion',
          created: 1740000000,
          model: 'llama-3.3-70b-versatile',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Choice A' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        })
        .mockResolvedValueOnce({
          id: 'chatcmpl-2',
          object: 'chat.completion',
          created: 1740000000,
          model: 'llama-3.3-70b-versatile',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Choice B' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 },
        });
    }

    const { status, body } = await sendRequest(app, 'POST', '/v1/chat/completions', {
      messages: [{ role: 'user', content: 'Tell me a joke' }],
      n: 2,
    });

    expect(status).toBe(200);
    expect(body.choices).toHaveLength(2);
    expect(body.choices[0].message.content).toBe('Choice A');
    expect(body.choices[0].index).toBe(0);
    expect(body.choices[1].message.content).toBe('Choice B');
    expect(body.choices[1].index).toBe(1);
    expect(body.usage.completion_tokens).toBe(7);
  });
});
