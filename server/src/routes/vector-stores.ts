import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { getDb, getUnifiedApiKey } from '../db/index.js';
import { indexFile } from '../services/vector-indexer.js';

export const vectorStoresRouter = Router();

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

function parsePaginationParams(req: Request) {
  const limit = Math.min(Math.max(parseInt((req.query.limit as string) || '20', 10), 1), 100);
  const order = (req.query.order as string) === 'asc' ? 'asc' : 'desc';
  const after = req.query.after as string | undefined;
  const before = req.query.before as string | undefined;
  return { limit, order, after, before };
}

function formatVectorStore(vs: any) {
  return {
    id: vs.id,
    object: 'vector_store',
    created_at: vs.created_at,
    name: vs.name,
    description: vs.description,
    usage_bytes: vs.usage_bytes,
    file_counts: {
      total: vs.file_counts_total,
      completed: vs.file_counts_completed,
      in_progress: vs.file_counts_in_progress,
      failed: vs.file_counts_failed,
      cancelled: vs.file_counts_cancelled
    },
    status: vs.status,
    expires_after: vs.expires_after ? JSON.parse(vs.expires_after) : null,
    expires_at: vs.expires_at,
    last_active_at: vs.last_active_at,
    metadata: vs.metadata ? JSON.parse(vs.metadata) : {}
  };
}

// 1. Create vector store
vectorStoresRouter.post('/', (req, res) => {
  if (!authenticateRequest(req, res)) return;

  try {
    const db = getDb();
    const { file_ids, name, description, expires_after, chunking_strategy, metadata } = req.body;
    
    const id = `vs_${crypto.randomUUID()}`;
    const now = Math.floor(Date.now() / 1000);
    
    let fileCountsTotal = 0;
    let fileCountsInProgress = 0;

    if (Array.isArray(file_ids) && file_ids.length > 0) {
      fileCountsTotal = file_ids.length;
      fileCountsInProgress = file_ids.length;
    }

    db.prepare(`
      INSERT INTO vector_stores (
        id, created_at, name, description, status, expires_after, 
        last_active_at, metadata, file_counts_total, file_counts_in_progress
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, now, name || null, description || null, 'in_progress', 
      expires_after ? JSON.stringify(expires_after) : null,
      now, metadata ? JSON.stringify(metadata) : '{}',
      fileCountsTotal, fileCountsInProgress
    );

    if (Array.isArray(file_ids) && file_ids.length > 0) {
      const insertFile = db.prepare(`
        INSERT INTO vector_store_files (
          id, vector_store_id, file_id, created_at, status, chunking_strategy
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);

      const strategyStr = chunking_strategy ? JSON.stringify(chunking_strategy) : '{"type":"auto"}';

      db.transaction(() => {
        for (const fileId of file_ids) {
          const vsFileId = `vsf_${crypto.randomUUID()}`;
          insertFile.run(vsFileId, id, fileId, now, 'in_progress', strategyStr);
        }
      })();

      // Trigger background indexing
      for (const fileId of file_ids) {
        indexFile(id, fileId).catch(err => console.error(`Failed to index file ${fileId}:`, err));
      }
    } else {
      db.prepare(`UPDATE vector_stores SET status = 'completed' WHERE id = ?`).run(id);
    }

    const vs = db.prepare('SELECT * FROM vector_stores WHERE id = ?').get(id);
    res.json(formatVectorStore(vs));

  } catch (error: any) {
    res.status(500).json({ error: { message: error.message, type: 'server_error' } });
  }
});

// 2. List vector stores
vectorStoresRouter.get('/', (req, res) => {
  if (!authenticateRequest(req, res)) return;

  try {
    const db = getDb();
    const { limit, order, after, before } = parsePaginationParams(req);
    
    let query = 'SELECT * FROM vector_stores';
    const params: any[] = [];
    const conditions: string[] = [];

    if (after) {
      conditions.push('id > ?');
      params.push(after);
    }
    if (before) {
      conditions.push('id < ?');
      params.push(before);
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    query += ` ORDER BY id ${order === 'asc' ? 'ASC' : 'DESC'} LIMIT ?`;
    params.push(limit);

    const rows = db.prepare(query).all(...params);
    const data = rows.map(formatVectorStore);

    res.json({
      object: 'list',
      data,
      first_id: data.length > 0 ? data[0].id : null,
      last_id: data.length > 0 ? data[data.length - 1].id : null,
      has_more: data.length === limit
    });
  } catch (error: any) {
    res.status(500).json({ error: { message: error.message, type: 'server_error' } });
  }
});

// 3. Retrieve
vectorStoresRouter.get('/:vector_store_id', (req, res) => {
  if (!authenticateRequest(req, res)) return;
  const db = getDb();
  const vs = db.prepare('SELECT * FROM vector_stores WHERE id = ?').get(req.params.vector_store_id);
  if (!vs) return res.status(404).json({ error: { message: 'Vector store not found', type: 'invalid_request_error' } });
  res.json(formatVectorStore(vs));
});

// 4. Modify
vectorStoresRouter.post('/:vector_store_id', (req, res) => {
  if (!authenticateRequest(req, res)) return;
  try {
    const db = getDb();
    const { name, expires_after, metadata } = req.body;
    const vs = db.prepare('SELECT * FROM vector_stores WHERE id = ?').get(req.params.vector_store_id);
    if (!vs) return res.status(404).json({ error: { message: 'Vector store not found', type: 'invalid_request_error' } });

    const updates: string[] = [];
    const params: any[] = [];

    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name);
    }
    if (expires_after !== undefined) {
      updates.push('expires_after = ?');
      params.push(expires_after === null ? null : JSON.stringify(expires_after));
    }
    if (metadata !== undefined) {
      updates.push('metadata = ?');
      params.push(metadata === null ? '{}' : JSON.stringify(metadata));
    }

    if (updates.length > 0) {
      params.push(req.params.vector_store_id);
      db.prepare(`UPDATE vector_stores SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    }

    const updatedVs = db.prepare('SELECT * FROM vector_stores WHERE id = ?').get(req.params.vector_store_id);
    res.json(formatVectorStore(updatedVs));
  } catch (error: any) {
    res.status(500).json({ error: { message: error.message, type: 'server_error' } });
  }
});

// 5. Delete
vectorStoresRouter.delete('/:vector_store_id', (req, res) => {
  if (!authenticateRequest(req, res)) return;
  try {
    const db = getDb();
    const id = req.params.vector_store_id;
    const vs = db.prepare('SELECT id FROM vector_stores WHERE id = ?').get(id);
    if (!vs) return res.status(404).json({ error: { message: 'Vector store not found', type: 'invalid_request_error' } });

    db.transaction(() => {
      db.prepare('DELETE FROM vector_chunks WHERE vector_store_id = ?').run(id);
      db.prepare('DELETE FROM vector_store_files WHERE vector_store_id = ?').run(id);
      db.prepare('DELETE FROM vector_store_file_batches WHERE vector_store_id = ?').run(id);
      db.prepare('DELETE FROM vector_stores WHERE id = ?').run(id);
    })();

    res.json({ id, object: 'vector_store.deleted', deleted: true });
  } catch (error: any) {
    res.status(500).json({ error: { message: error.message, type: 'server_error' } });
  }
});

// --- Vector Store Files ---

// 6. Add file
vectorStoresRouter.post('/:vector_store_id/files', (req, res) => {
  if (!authenticateRequest(req, res)) return;
  try {
    const db = getDb();
    const vsId = req.params.vector_store_id;
    const { file_id, chunking_strategy } = req.body;
    
    if (!file_id) return res.status(400).json({ error: { message: 'Missing file_id', type: 'invalid_request_error' } });
    
    const vs = db.prepare('SELECT id FROM vector_stores WHERE id = ?').get(vsId);
    if (!vs) return res.status(404).json({ error: { message: 'Vector store not found', type: 'invalid_request_error' } });

    const file = db.prepare('SELECT id FROM files WHERE id = ?').get(file_id);
    if (!file) return res.status(404).json({ error: { message: 'File not found', type: 'invalid_request_error' } });

    const vsFileId = `vsf_${crypto.randomUUID()}`;
    const now = Math.floor(Date.now() / 1000);
    const strategyStr = chunking_strategy ? JSON.stringify(chunking_strategy) : '{"type":"auto"}';

    db.transaction(() => {
      db.prepare(`
        INSERT INTO vector_store_files (id, vector_store_id, file_id, created_at, status, chunking_strategy)
        VALUES (?, ?, ?, ?, 'in_progress', ?)
      `).run(vsFileId, vsId, file_id, now, strategyStr);

      db.prepare(`
        UPDATE vector_stores 
        SET file_counts_total = file_counts_total + 1,
            file_counts_in_progress = file_counts_in_progress + 1,
            status = 'in_progress'
        WHERE id = ?
      `).run(vsId);
    })();

    indexFile(vsId, file_id).catch(err => console.error(`Failed to index file ${file_id}:`, err));

    const vsFile = db.prepare('SELECT * FROM vector_store_files WHERE id = ?').get(vsFileId) as any;
    res.json({
      id: vsFile.id,
      object: 'vector_store.file',
      usage_bytes: vsFile.usage_bytes,
      created_at: vsFile.created_at,
      vector_store_id: vsFile.vector_store_id,
      status: vsFile.status,
      last_error: vsFile.last_error ? { code: 'server_error', message: vsFile.last_error } : null,
      chunking_strategy: JSON.parse(vsFile.chunking_strategy)
    });
  } catch (error: any) {
    res.status(500).json({ error: { message: error.message, type: 'server_error' } });
  }
});

// 7. List files in store
vectorStoresRouter.get('/:vector_store_id/files', (req, res) => {
  if (!authenticateRequest(req, res)) return;
  try {
    const db = getDb();
    const vsId = req.params.vector_store_id;
    const { limit, order, after, before } = parsePaginationParams(req);
    const filter = req.query.filter as string | undefined;

    let query = 'SELECT * FROM vector_store_files WHERE vector_store_id = ?';
    const params: any[] = [vsId];

    if (filter) {
      query += ' AND status = ?';
      params.push(filter);
    }
    if (after) {
      query += ' AND id > ?';
      params.push(after);
    }
    if (before) {
      query += ' AND id < ?';
      params.push(before);
    }

    query += ` ORDER BY id ${order === 'asc' ? 'ASC' : 'DESC'} LIMIT ?`;
    params.push(limit);

    const rows = db.prepare(query).all(...params) as any[];
    const data = rows.map(vsFile => ({
      id: vsFile.id,
      object: 'vector_store.file',
      usage_bytes: vsFile.usage_bytes,
      created_at: vsFile.created_at,
      vector_store_id: vsFile.vector_store_id,
      status: vsFile.status,
      last_error: vsFile.last_error ? { code: 'server_error', message: vsFile.last_error } : null,
      chunking_strategy: JSON.parse(vsFile.chunking_strategy)
    }));

    res.json({
      object: 'list',
      data,
      first_id: data.length > 0 ? data[0].id : null,
      last_id: data.length > 0 ? data[data.length - 1].id : null,
      has_more: data.length === limit
    });
  } catch (error: any) {
    res.status(500).json({ error: { message: error.message, type: 'server_error' } });
  }
});

// 8. Retrieve file
vectorStoresRouter.get('/:vector_store_id/files/:file_id', (req, res) => {
  if (!authenticateRequest(req, res)) return;
  const db = getDb();
  const vsFile = db.prepare('SELECT * FROM vector_store_files WHERE vector_store_id = ? AND file_id = ?').get(req.params.vector_store_id, req.params.file_id) as any;
  if (!vsFile) return res.status(404).json({ error: { message: 'Vector store file not found', type: 'invalid_request_error' } });
  
  res.json({
    id: vsFile.id,
    object: 'vector_store.file',
    usage_bytes: vsFile.usage_bytes,
    created_at: vsFile.created_at,
    vector_store_id: vsFile.vector_store_id,
    status: vsFile.status,
    last_error: vsFile.last_error ? { code: 'server_error', message: vsFile.last_error } : null,
    chunking_strategy: JSON.parse(vsFile.chunking_strategy)
  });
});

// 9. Delete file
vectorStoresRouter.delete('/:vector_store_id/files/:file_id', (req, res) => {
  if (!authenticateRequest(req, res)) return;
  try {
    const db = getDb();
    const vsId = req.params.vector_store_id;
    const fileId = req.params.file_id;
    
    const vsFile = db.prepare('SELECT id, status, usage_bytes FROM vector_store_files WHERE vector_store_id = ? AND file_id = ?').get(vsId, fileId) as any;
    if (!vsFile) return res.status(404).json({ error: { message: 'Vector store file not found', type: 'invalid_request_error' } });

    db.transaction(() => {
      db.prepare('DELETE FROM vector_chunks WHERE vector_store_id = ? AND file_id = ?').run(vsId, fileId);
      db.prepare('DELETE FROM vector_store_files WHERE id = ?').run(vsFile.id);
      
      const decrementStatus = vsFile.status === 'completed' ? 'file_counts_completed' :
                              vsFile.status === 'in_progress' ? 'file_counts_in_progress' :
                              vsFile.status === 'failed' ? 'file_counts_failed' : 'file_counts_cancelled';

      db.prepare(`
        UPDATE vector_stores 
        SET file_counts_total = MAX(0, file_counts_total - 1),
            ${decrementStatus} = MAX(0, ${decrementStatus} - 1),
            usage_bytes = MAX(0, usage_bytes - ?)
        WHERE id = ?
      `).run(vsFile.usage_bytes || 0, vsId);
    })();

    res.json({ id: fileId, object: 'vector_store.file.deleted', deleted: true });
  } catch (error: any) {
    res.status(500).json({ error: { message: error.message, type: 'server_error' } });
  }
});

// --- File Batches ---

// 10. Create file batch
vectorStoresRouter.post('/:vector_store_id/file_batches', (req, res) => {
  if (!authenticateRequest(req, res)) return;
  try {
    const db = getDb();
    const vsId = req.params.vector_store_id;
    const { file_ids, chunking_strategy } = req.body;
    
    if (!Array.isArray(file_ids) || file_ids.length === 0) {
      return res.status(400).json({ error: { message: 'Missing file_ids array', type: 'invalid_request_error' } });
    }

    const vs = db.prepare('SELECT id FROM vector_stores WHERE id = ?').get(vsId);
    if (!vs) return res.status(404).json({ error: { message: 'Vector store not found', type: 'invalid_request_error' } });

    const batchId = `vsfb_${crypto.randomUUID()}`;
    const now = Math.floor(Date.now() / 1000);
    const strategyStr = chunking_strategy ? JSON.stringify(chunking_strategy) : '{"type":"auto"}';

    db.transaction(() => {
      db.prepare(`
        INSERT INTO vector_store_file_batches (
          id, vector_store_id, created_at, status, file_counts_total, file_counts_in_progress
        ) VALUES (?, ?, ?, 'in_progress', ?, ?)
      `).run(batchId, vsId, now, file_ids.length, file_ids.length);

      const insertFile = db.prepare(`
        INSERT INTO vector_store_files (id, vector_store_id, file_id, created_at, status, chunking_strategy)
        VALUES (?, ?, ?, ?, 'in_progress', ?)
      `);

      for (const fileId of file_ids) {
        insertFile.run(`vsf_${crypto.randomUUID()}`, vsId, fileId, now, strategyStr);
      }

      db.prepare(`
        UPDATE vector_stores 
        SET file_counts_total = file_counts_total + ?,
            file_counts_in_progress = file_counts_in_progress + ?,
            status = 'in_progress'
        WHERE id = ?
      `).run(file_ids.length, file_ids.length, vsId);
    })();

    for (const fileId of file_ids) {
      indexFile(vsId, fileId).catch(err => console.error(`Failed to index file ${fileId} in batch ${batchId}:`, err));
    }

    const batch = db.prepare('SELECT * FROM vector_store_file_batches WHERE id = ?').get(batchId) as any;
    res.json({
      id: batch.id,
      object: 'vector_store.file_batch',
      created_at: batch.created_at,
      vector_store_id: batch.vector_store_id,
      status: batch.status,
      file_counts: {
        total: batch.file_counts_total,
        completed: batch.file_counts_completed,
        in_progress: batch.file_counts_in_progress,
        failed: batch.file_counts_failed,
        cancelled: batch.file_counts_cancelled
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: { message: error.message, type: 'server_error' } });
  }
});

// 11. Retrieve file batch
vectorStoresRouter.get('/:vector_store_id/file_batches/:batch_id', (req, res) => {
  if (!authenticateRequest(req, res)) return;
  const db = getDb();
  const batch = db.prepare('SELECT * FROM vector_store_file_batches WHERE vector_store_id = ? AND id = ?').get(req.params.vector_store_id, req.params.batch_id) as any;
  if (!batch) return res.status(404).json({ error: { message: 'Batch not found', type: 'invalid_request_error' } });

  res.json({
    id: batch.id,
    object: 'vector_store.file_batch',
    created_at: batch.created_at,
    vector_store_id: batch.vector_store_id,
    status: batch.status,
    file_counts: {
      total: batch.file_counts_total,
      completed: batch.file_counts_completed,
      in_progress: batch.file_counts_in_progress,
      failed: batch.file_counts_failed,
      cancelled: batch.file_counts_cancelled
    }
  });
});

// 12. Cancel batch
vectorStoresRouter.post('/:vector_store_id/file_batches/:batch_id/cancel', (req, res) => {
  if (!authenticateRequest(req, res)) return;
  try {
    const db = getDb();
    const batch = db.prepare('SELECT * FROM vector_store_file_batches WHERE vector_store_id = ? AND id = ?').get(req.params.vector_store_id, req.params.batch_id) as any;
    if (!batch) return res.status(404).json({ error: { message: 'Batch not found', type: 'invalid_request_error' } });

    if (batch.status === 'in_progress') {
      db.prepare(`UPDATE vector_store_file_batches SET status = 'cancelled' WHERE id = ?`).run(batch.id);
    }
    
    const updated = db.prepare('SELECT * FROM vector_store_file_batches WHERE id = ?').get(batch.id) as any;
    res.json({
      id: updated.id,
      object: 'vector_store.file_batch',
      created_at: updated.created_at,
      vector_store_id: updated.vector_store_id,
      status: updated.status,
      file_counts: {
        total: updated.file_counts_total,
        completed: updated.file_counts_completed,
        in_progress: updated.file_counts_in_progress,
        failed: updated.file_counts_failed,
        cancelled: updated.file_counts_cancelled
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: { message: error.message, type: 'server_error' } });
  }
});

// 13. List files in batch
vectorStoresRouter.get('/:vector_store_id/file_batches/:batch_id/files', (req, res) => {
  if (!authenticateRequest(req, res)) return;
  res.json({
    object: 'list',
    data: [],
    first_id: null,
    last_id: null,
    has_more: false
  });
});
