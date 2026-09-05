import { describe, it, expect, beforeEach } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../../app.js';
import { initDb, getDb } from '../../db/index.js';

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

describe('OpenAI API Full Parity Endpoints', () => {
  let app: Express;

  beforeEach(() => {
    initDb(':memory:');
    app = createApp();
  });

  describe('Models Detail & Delete API', () => {
    it('retrieves individual model detail with GET /v1/models/:model', async () => {
      const { status, body } = await sendRequest(app, 'GET', '/v1/models/gemini-2.5-flash');
      expect(status).toBe(200);
      expect(body.id).toBe('gemini-2.5-flash');
      expect(body.object).toBe('model');
      expect(body.owned_by).toBe('google');
    });

    it('returns 404 for unknown model', async () => {
      const { status, body } = await sendRequest(app, 'GET', '/v1/models/non-existent-model');
      expect(status).toBe(404);
      expect(body.error.code).toBe('model_not_found');
    });

    it('deletes model with DELETE /v1/models/:model', async () => {
      const { status, body } = await sendRequest(app, 'DELETE', '/v1/models/custom-model');
      expect(status).toBe(200);
      expect(body.id).toBe('custom-model');
      expect(body.deleted).toBe(true);
    });
  });

  describe('Stored Chat Completions API', () => {
    it('lists stored completions with GET /v1/chat/completions', async () => {
      const db = getDb();
      db.prepare(`
        INSERT INTO stored_completions (id, object, created, model, choices, usage, metadata, messages)
        VALUES ('chatcmpl-test-1', 'chat.completion', 1700000000, 'gpt-4o', '[]', '{}', '{"test":"true"}', '[]')
      `).run();

      const { status, body } = await sendRequest(app, 'GET', '/v1/chat/completions');
      expect(status).toBe(200);
      expect(body.object).toBe('list');
      expect(body.data).toHaveLength(1);
      expect(body.data[0].id).toBe('chatcmpl-test-1');
      expect(body.data[0].model).toBe('gpt-4o');
    });

    it('retrieves stored completion by id', async () => {
      const db = getDb();
      db.prepare(`
        INSERT INTO stored_completions (id, object, created, model, choices, usage, metadata, messages)
        VALUES ('chatcmpl-test-2', 'chat.completion', 1700000000, 'gpt-4o', '[]', '{}', '{"test":"true"}', '[{"role":"user","content":"hi"}]')
      `).run();

      const { status, body } = await sendRequest(app, 'GET', '/v1/chat/completions/chatcmpl-test-2');
      expect(status).toBe(200);
      expect(body.id).toBe('chatcmpl-test-2');

      const msgRes = await sendRequest(app, 'GET', '/v1/chat/completions/chatcmpl-test-2/messages');
      expect(msgRes.status).toBe(200);
      expect(msgRes.body.data[0].content).toBe('hi');
    });
  });

  describe('Files & Uploads API', () => {
    it('lists files with GET /v1/files', async () => {
      const { status, body } = await sendRequest(app, 'GET', '/v1/files');
      expect(status).toBe(200);
      expect(body.object).toBe('list');
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('creates and cancels upload session with /v1/uploads', async () => {
      const createRes = await sendRequest(app, 'POST', '/v1/uploads', {
        filename: 'dataset.jsonl',
        purpose: 'batch',
        bytes: 1024,
        mime_type: 'application/jsonl',
      });
      expect(createRes.status).toBe(200);
      expect(createRes.body.object).toBe('upload');
      expect(createRes.body.filename).toBe('dataset.jsonl');

      const uploadId = createRes.body.id;
      const cancelRes = await sendRequest(app, 'POST', `/v1/uploads/${uploadId}/cancel`);
      expect(cancelRes.status).toBe(200);
      expect(cancelRes.body.status).toBe('cancelled');
    });
  });

  describe('Batches API', () => {
    it('lists batches with GET /v1/batches', async () => {
      const { status, body } = await sendRequest(app, 'GET', '/v1/batches');
      expect(status).toBe(200);
      expect(body.object).toBe('list');
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('rejects batch creation if input file does not exist', async () => {
      const { status, body } = await sendRequest(app, 'POST', '/v1/batches', {
        input_file_id: 'file-nonexistent',
        endpoint: '/v1/chat/completions',
      });
      expect(status).toBe(400);
      expect(body.error).toBeDefined();
    });
  });

  describe('Assistants & Threads API', () => {
    it('creates, retrieves, and deletes an assistant', async () => {
      const createRes = await sendRequest(app, 'POST', '/v1/assistants', {
        model: 'gemini-2.5-flash',
        name: 'Math Tutor',
        instructions: 'You are a helpful math tutor.',
      });
      expect(createRes.status).toBe(200);
      expect(createRes.body.name).toBe('Math Tutor');
      expect(createRes.body.id).toMatch(/^asst_/);

      const asstId = createRes.body.id;

      const getRes = await sendRequest(app, 'GET', `/v1/assistants/${asstId}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body.id).toBe(asstId);

      const delRes = await sendRequest(app, 'DELETE', `/v1/assistants/${asstId}`);
      expect(delRes.status).toBe(200);
      expect(delRes.body.deleted).toBe(true);
    });

    it('creates thread and adds message', async () => {
      const threadRes = await sendRequest(app, 'POST', '/v1/threads', {
        messages: [{ role: 'user', content: 'What is 2+2?' }],
      });
      expect(threadRes.status).toBe(200);
      expect(threadRes.body.id).toMatch(/^thread_/);

      const threadId = threadRes.body.id;

      const msgRes = await sendRequest(app, 'POST', `/v1/threads/${threadId}/messages`, {
        role: 'user',
        content: 'Another question',
      });
      expect(msgRes.status).toBe(200);
      expect(msgRes.body.id).toMatch(/^msg_/);

      const listRes = await sendRequest(app, 'GET', `/v1/threads/${threadId}/messages`);
      expect(listRes.status).toBe(200);
      expect(listRes.body.data.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('Vector Stores API', () => {
    it('creates and lists vector stores', async () => {
      const createRes = await sendRequest(app, 'POST', '/v1/vector_stores', {
        name: 'Knowledge Base',
      });
      expect(createRes.status).toBe(200);
      expect(createRes.body.id).toMatch(/^vs_/);
      expect(createRes.body.name).toBe('Knowledge Base');

      const vsId = createRes.body.id;

      const listRes = await sendRequest(app, 'GET', '/v1/vector_stores');
      expect(listRes.status).toBe(200);
      expect(listRes.body.data.length).toBeGreaterThanOrEqual(1);

      const delRes = await sendRequest(app, 'DELETE', `/v1/vector_stores/${vsId}`);
      expect(delRes.status).toBe(200);
      expect(delRes.body.deleted).toBe(true);
    });
  });

  describe('Responses API', () => {
    it('returns 404 for non-existent stored response', async () => {
      const { status, body } = await sendRequest(app, 'GET', '/v1/responses/resp-nonexistent');
      expect(status).toBe(404);
      expect(body.error).toBeDefined();
    });
  });

  describe('Fine-tuning API Stubs', () => {
    it('returns empty job list without errors', async () => {
      const { status, body } = await sendRequest(app, 'GET', '/v1/fine_tuning/jobs');
      expect(status).toBe(200);
      expect(body.object).toBe('list');
      expect(body.data).toEqual([]);
    });

    it('returns graceful not_supported job when requested', async () => {
      const { status, body } = await sendRequest(app, 'POST', '/v1/fine_tuning/jobs', {
        model: 'gpt-4o-mini',
        training_file: 'file-123',
      });
      expect(status).toBe(200);
      expect(body.object).toBe('fine_tuning.job');
      expect(body.status).toBe('failed');
      expect(body.error.code).toBe('not_supported');
    });
  });

  describe('Realtime API', () => {
    it('handles session creation attempt gracefully', async () => {
      const { status, body } = await sendRequest(app, 'POST', '/v1/realtime/sessions', {
        model: 'gpt-4o-realtime-preview',
      });
      // Without an OPENAI_API_KEY or GitHub key configured in test env, it returns 400 with helpful error
      expect([200, 400]).toContain(status);
      if (status === 400) {
        expect(body.error.message).toContain('Realtime API requires an OpenAI API key');
      }
    });
  });

  describe('Organization Admin Stubs', () => {
    it('returns empty lists for org endpoints without crashing', async () => {
      const usersRes = await sendRequest(app, 'GET', '/v1/organization/users');
      expect(usersRes.status).toBe(200);
      expect(usersRes.body.data).toEqual([]);

      const usageRes = await sendRequest(app, 'GET', '/v1/organization/usage');
      expect(usageRes.status).toBe(200);
      expect(usageRes.body.data).toEqual([]);

      const usageCompRes = await sendRequest(app, 'GET', '/v1/organization/usage/completions');
      expect(usageCompRes.status).toBe(200);
      expect(usageCompRes.body.data).toEqual([]);
    });
  });
});
