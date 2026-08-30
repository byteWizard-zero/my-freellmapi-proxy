import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb } from '../../db/index.js';
import { ImageRouter } from '../../services/image-router.js';

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

describe('Images API (/v1/images/*)', () => {
  let app: Express;

  beforeEach(() => {
    initDb(':memory:');
    app = createApp();
  });

  it('rejects requests with missing prompt', async () => {
    const { status, body } = await sendRequest(app, 'POST', '/v1/images/generations', {});

    expect(status).toBe(400);
    expect(body.error).toBeDefined();
    expect(body.error.type).toBe('invalid_request_error');
  });

  it('generates images and returns OpenAI-compatible structure', async () => {
    vi.spyOn(ImageRouter, 'generateImage').mockResolvedValueOnce({
      created: 1740000000,
      data: [{ b64_json: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==' }],
      _routed_via: { platform: 'pollinations', model: 'flux' },
    });

    const { status, body, headers } = await sendRequest(app, 'POST', '/v1/images/generations', {
      prompt: 'A futuristic electric hypercar speeding across neon highway',
      size: '1024x1024',
      response_format: 'b64_json',
    });

    expect(status).toBe(200);
    expect(body.created).toBeDefined();
    expect(body.data).toHaveLength(1);
    expect(body.data[0].b64_json).toBeDefined();
    expect(headers['x-routed-via']).toBe('pollinations/flux');
  });

  it('handles image edits endpoint', async () => {
    vi.spyOn(ImageRouter, 'generateImage').mockResolvedValueOnce({
      created: 1740000000,
      data: [{ url: 'https://image.pollinations.ai/prompt/test' }],
      _routed_via: { platform: 'pollinations', model: 'flux' },
    });

    const { status, body } = await sendRequest(app, 'POST', '/v1/images/edits', {
      prompt: 'Add a red hat to the cat',
      size: '1024x1024',
    });

    expect(status).toBe(200);
    expect(body.data).toBeDefined();
  });
});
