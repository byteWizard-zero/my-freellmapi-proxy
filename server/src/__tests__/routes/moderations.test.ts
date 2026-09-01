import { describe, it, expect, beforeEach } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb } from '../../db/index.js';

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

describe('Moderations API (/v1/moderations)', () => {
  let app: Express;

  beforeEach(() => {
    initDb(':memory:');
    app = createApp();
  });

  it('rejects request with missing input', async () => {
    const { status, body } = await sendRequest(app, 'POST', '/v1/moderations', {});
    expect(status).toBe(400);
    expect(body.error).toBeDefined();
    expect(body.error.type).toBe('invalid_request_error');
  });

  it('checks text moderation and returns category scores and flags', async () => {
    const { status, body, headers } = await sendRequest(app, 'POST', '/v1/moderations', {
      input: 'I love writing code and building applications.',
    });

    expect(status).toBe(200);
    expect(body.id).toMatch(/^modr-/);
    expect(body.results).toHaveLength(1);
    expect(body.results[0].flagged).toBe(false);
    expect(body.results[0].categories.sexual).toBe(false);
    expect(body.results[0].category_scores.sexual).toBeLessThan(0.1);
    expect(headers['x-routed-via']).toBeDefined();
  });
});
