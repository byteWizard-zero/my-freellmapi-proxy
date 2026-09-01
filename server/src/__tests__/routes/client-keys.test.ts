import { describe, it, expect, beforeEach } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb, validateClientApiKey } from '../../db/index.js';

async function sendRequest(app: Express, method: string, path: string, body?: any, token?: string) {
  const server = app.listen(0);
  const addr = server.address() as any;
  const url = `http://127.0.0.1:${addr.port}${path}`;

  try {
    const headers: Record<string, string> = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const res = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = await res.json().catch(() => null);
    return { status: res.status, body: data };
  } finally {
    server.close();
  }
}

describe('Client Keys Management API (/api/client-keys)', () => {
  let app: Express;

  beforeEach(() => {
    initDb(':memory:');
    app = createApp();
  });

  it('creates, lists, and toggles client API keys', async () => {
    // 1. Create client key
    const createRes = await sendRequest(app, 'POST', '/api/client-keys', {
      name: 'Agent App 1',
      rateLimitRpm: 120,
      monthlyTokenBudget: 500000,
    });

    expect(createRes.status).toBe(201);
    expect(createRes.body.key).toMatch(/^freellm-client-/);
    expect(createRes.body.name).toBe('Agent App 1');
    const createdKey = createRes.body.key;
    const keyId = createRes.body.id;

    // 2. Validate client key helper
    const validated = validateClientApiKey(createdKey);
    expect(validated.isValid).toBe(true);
    expect(validated.clientKey?.name).toBe('Agent App 1');

    // 3. List client keys
    const listRes = await sendRequest(app, 'GET', '/api/client-keys');
    expect(listRes.status).toBe(200);
    expect(listRes.body.keys).toHaveLength(1);
    expect(listRes.body.keys[0].name).toBe('Agent App 1');

    // 4. Toggle disabled
    const patchRes = await sendRequest(app, 'PATCH', `/api/client-keys/${keyId}`, { enabled: false });
    expect(patchRes.status).toBe(200);

    const postDisabledValidation = validateClientApiKey(createdKey);
    expect(postDisabledValidation.isValid).toBe(false);

    // 5. Delete client key
    const delRes = await sendRequest(app, 'DELETE', `/api/client-keys/${keyId}`);
    expect(delRes.status).toBe(200);

    const postDeleteValidation = validateClientApiKey(createdKey);
    expect(postDeleteValidation.isValid).toBe(false);
  });
});
