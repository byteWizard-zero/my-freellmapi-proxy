import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb } from '../../db/index.js';
import { EmbeddingRouter } from '../../services/embedding-router.js';

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

describe('Embeddings API (/v1/embeddings)', () => {
  let app: Express;

  beforeEach(() => {
    initDb(':memory:');
    app = createApp();
  });

  it('rejects request with missing input', async () => {
    const { status, body } = await sendRequest(app, 'POST', '/v1/embeddings', {});
    expect(status).toBe(400);
    expect(body.error).toBeDefined();
    expect(body.error.type).toBe('invalid_request_error');
  });

  it('generates embeddings for string input and returns OpenAI structure', async () => {
    vi.spyOn(EmbeddingRouter, 'generateEmbeddings').mockResolvedValueOnce({
      object: 'list',
      data: [{ object: 'embedding', index: 0, embedding: [0.01, -0.02, 0.03] }],
      model: 'text-embedding-004',
      usage: { prompt_tokens: 5, total_tokens: 5 },
      _routed_via: { platform: 'google', model: 'text-embedding-004' },
    });

    const { status, body, headers } = await sendRequest(app, 'POST', '/v1/embeddings', {
      input: 'Hello world',
      model: 'text-embedding-004',
    });

    expect(status).toBe(200);
    expect(body.object).toBe('list');
    expect(body.data).toHaveLength(1);
    expect(body.data[0].embedding).toEqual([0.01, -0.02, 0.03]);
    expect(body.usage.prompt_tokens).toBe(5);
    expect(headers['x-routed-via']).toBe('google/text-embedding-004');
  });

  it('generates embeddings for batch array input', async () => {
    vi.spyOn(EmbeddingRouter, 'generateEmbeddings').mockResolvedValueOnce({
      object: 'list',
      data: [
        { object: 'embedding', index: 0, embedding: [0.01, 0.02] },
        { object: 'embedding', index: 1, embedding: [0.03, 0.04] },
      ],
      model: 'mistral-embed',
      usage: { prompt_tokens: 10, total_tokens: 10 },
      _routed_via: { platform: 'mistral', model: 'mistral-embed' },
    });

    const { status, body } = await sendRequest(app, 'POST', '/v1/embeddings', {
      input: ['first sentence', 'second sentence'],
      model: 'mistral-embed',
    });

    expect(status).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(body.data[1].index).toBe(1);
  });
});
