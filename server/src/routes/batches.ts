import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { getDb, getUnifiedApiKey } from '../db/index.js';
import { processBatch } from '../services/batch-worker.js';

export const batchesRouter = Router();

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

const createBatchSchema = z.object({
  input_file_id: z.string(),
  endpoint: z.enum(['/v1/chat/completions', '/v1/embeddings', '/v1/completions']),
  completion_window: z.enum(['24h']).default('24h'),
  metadata: z.record(z.string()).optional()
});

batchesRouter.post('/', (req, res) => {
  if (!authenticateRequest(req, res)) return;

  const parsed = createBatchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { message: 'Invalid request body', type: 'invalid_request_error' } });
  }

  const { input_file_id, endpoint, completion_window, metadata } = parsed.data;
  const db = getDb();

  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(input_file_id);
  if (!file) {
    return res.status(400).json({ error: { message: `File ${input_file_id} not found`, type: 'invalid_request_error' } });
  }

  const batchId = `batch_${crypto.randomUUID()}`;
  const now = Math.floor(Date.now() / 1000);
  const expires_at = now + 24 * 60 * 60; // 24h

  const insertStmt = db.prepare(`
    INSERT INTO batches (
      id, endpoint, input_file_id, completion_window, status,
      created_at, expires_at, metadata
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertStmt.run(
    batchId,
    endpoint,
    input_file_id,
    completion_window,
    'validating',
    now,
    expires_at,
    metadata ? JSON.stringify(metadata) : '{}'
  );

  const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(batchId) as any;

  // Process async (fire and forget)
  processBatch(batchId).catch(console.error);

  res.status(200).json({
    id: batch.id,
    object: batch.object,
    endpoint: batch.endpoint,
    input_file_id: batch.input_file_id,
    completion_window: batch.completion_window,
    status: batch.status,
    output_file_id: batch.output_file_id,
    error_file_id: batch.error_file_id,
    created_at: batch.created_at,
    in_progress_at: batch.in_progress_at,
    expires_at: batch.expires_at,
    finalizing_at: batch.finalizing_at,
    completed_at: batch.completed_at,
    failed_at: batch.failed_at,
    cancelled_at: batch.cancelled_at,
    request_counts: {
      total: batch.request_counts_total,
      completed: batch.request_counts_completed,
      failed: batch.request_counts_failed
    },
    metadata: JSON.parse(batch.metadata || '{}'),
    errors: JSON.parse(batch.errors || '[]')
  });
});

batchesRouter.get('/', (req, res) => {
  if (!authenticateRequest(req, res)) return;

  const limit = parseInt(req.query.limit as string) || 20;
  const after = req.query.after as string;

  const db = getDb();
  let query = 'SELECT * FROM batches ORDER BY created_at DESC LIMIT ?';
  let params: any[] = [limit + 1];

  if (after) {
    const afterBatch = db.prepare('SELECT created_at FROM batches WHERE id = ?').get(after) as any;
    if (afterBatch) {
      query = 'SELECT * FROM batches WHERE created_at < ? ORDER BY created_at DESC LIMIT ?';
      params = [afterBatch.created_at, limit + 1];
    }
  }

  const rows = db.prepare(query).all(...params) as any[];
  const has_more = rows.length > limit;
  const data = rows.slice(0, limit).map(batch => ({
    id: batch.id,
    object: batch.object,
    endpoint: batch.endpoint,
    input_file_id: batch.input_file_id,
    completion_window: batch.completion_window,
    status: batch.status,
    output_file_id: batch.output_file_id,
    error_file_id: batch.error_file_id,
    created_at: batch.created_at,
    in_progress_at: batch.in_progress_at,
    expires_at: batch.expires_at,
    finalizing_at: batch.finalizing_at,
    completed_at: batch.completed_at,
    failed_at: batch.failed_at,
    cancelled_at: batch.cancelled_at,
    request_counts: {
      total: batch.request_counts_total,
      completed: batch.request_counts_completed,
      failed: batch.request_counts_failed
    },
    metadata: JSON.parse(batch.metadata || '{}'),
    errors: JSON.parse(batch.errors || '[]')
  }));

  res.status(200).json({
    object: 'list',
    data,
    first_id: data.length > 0 ? data[0].id : null,
    last_id: data.length > 0 ? data[data.length - 1].id : null,
    has_more
  });
});

batchesRouter.get('/:batch_id', (req, res) => {
  if (!authenticateRequest(req, res)) return;

  const db = getDb();
  const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(req.params.batch_id) as any;

  if (!batch) {
    return res.status(404).json({ error: { message: 'Batch not found', type: 'invalid_request_error' } });
  }

  res.status(200).json({
    id: batch.id,
    object: batch.object,
    endpoint: batch.endpoint,
    input_file_id: batch.input_file_id,
    completion_window: batch.completion_window,
    status: batch.status,
    output_file_id: batch.output_file_id,
    error_file_id: batch.error_file_id,
    created_at: batch.created_at,
    in_progress_at: batch.in_progress_at,
    expires_at: batch.expires_at,
    finalizing_at: batch.finalizing_at,
    completed_at: batch.completed_at,
    failed_at: batch.failed_at,
    cancelled_at: batch.cancelled_at,
    request_counts: {
      total: batch.request_counts_total,
      completed: batch.request_counts_completed,
      failed: batch.request_counts_failed
    },
    metadata: JSON.parse(batch.metadata || '{}'),
    errors: JSON.parse(batch.errors || '[]')
  });
});

batchesRouter.post('/:batch_id/cancel', (req, res) => {
  if (!authenticateRequest(req, res)) return;

  const db = getDb();
  const batch = db.prepare('SELECT * FROM batches WHERE id = ?').get(req.params.batch_id) as any;

  if (!batch) {
    return res.status(404).json({ error: { message: 'Batch not found', type: 'invalid_request_error' } });
  }

  if (['completed', 'failed', 'cancelled', 'cancelling'].includes(batch.status)) {
    return res.status(400).json({ error: { message: `Cannot cancel batch in status: ${batch.status}`, type: 'invalid_request_error' } });
  }

  db.prepare('UPDATE batches SET status = ?, cancelled_at = ? WHERE id = ?')
    .run('cancelling', Math.floor(Date.now() / 1000), req.params.batch_id);

  const updatedBatch = db.prepare('SELECT * FROM batches WHERE id = ?').get(req.params.batch_id) as any;

  res.status(200).json({
    id: updatedBatch.id,
    object: updatedBatch.object,
    endpoint: updatedBatch.endpoint,
    input_file_id: updatedBatch.input_file_id,
    completion_window: updatedBatch.completion_window,
    status: updatedBatch.status,
    output_file_id: updatedBatch.output_file_id,
    error_file_id: updatedBatch.error_file_id,
    created_at: updatedBatch.created_at,
    in_progress_at: updatedBatch.in_progress_at,
    expires_at: updatedBatch.expires_at,
    finalizing_at: updatedBatch.finalizing_at,
    completed_at: updatedBatch.completed_at,
    failed_at: updatedBatch.failed_at,
    cancelled_at: updatedBatch.cancelled_at,
    request_counts: {
      total: updatedBatch.request_counts_total,
      completed: updatedBatch.request_counts_completed,
      failed: updatedBatch.request_counts_failed
    },
    metadata: JSON.parse(updatedBatch.metadata || '{}'),
    errors: JSON.parse(updatedBatch.errors || '[]')
  });
});
