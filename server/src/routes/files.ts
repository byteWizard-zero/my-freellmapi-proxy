import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import multer from 'multer';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, getUnifiedApiKey } from '../db/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const FILES_DIR = path.resolve(__dirname, '../../data/files');

const storage = multer.memoryStorage();
const upload = multer({ storage });

export const filesRouter = Router();

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

// Ensure FILES_DIR exists
fs.mkdir(FILES_DIR, { recursive: true }).catch(console.error);

filesRouter.post('/', upload.single('file'), async (req, res) => {
  if (!authenticateRequest(req, res)) return;

  const file = req.file;
  const purpose = req.body.purpose;

  if (!file) {
    return res.status(400).json({ error: { message: 'Missing file parameter', type: 'invalid_request_error' } });
  }

  const validPurposes = ['assistants', 'batch', 'fine-tune', 'vision'];
  if (!validPurposes.includes(purpose)) {
    return res.status(400).json({ error: { message: `Invalid purpose: ${purpose}`, type: 'invalid_request_error', param: 'purpose' } });
  }

  const id = `file-${crypto.randomUUID()}`;
  const createdAt = Math.floor(Date.now() / 1000);
  
  const fileDir = path.join(FILES_DIR, id);
  const storagePath = path.join(fileDir, file.originalname);

  try {
    await fs.mkdir(fileDir, { recursive: true });
    await fs.writeFile(storagePath, file.buffer);

    const db = getDb();
    const insertStmt = db.prepare(`
      INSERT INTO files (id, object, bytes, created_at, filename, purpose, status, storage_path)
      VALUES (?, 'file', ?, ?, ?, ?, 'uploaded', ?)
    `);
    
    insertStmt.run(id, file.size, createdAt, file.originalname, purpose, storagePath);

    const fileObj = {
      id,
      object: 'file',
      bytes: file.size,
      created_at: createdAt,
      filename: file.originalname,
      purpose,
      status: 'uploaded'
    };

    res.status(200).json(fileObj);
  } catch (err: any) {
    console.error('File upload error:', err);
    res.status(500).json({ error: { message: 'Internal server error', type: 'server_error' } });
  }
});

filesRouter.get('/', (req, res) => {
  if (!authenticateRequest(req, res)) return;

  const purpose = req.query.purpose as string | undefined;
  const limit = Math.min(Math.max(parseInt((req.query.limit as string) || '20', 10), 1), 100);
  const order = req.query.order === 'asc' ? 'ASC' : 'DESC';
  const after = req.query.after as string | undefined;

  const db = getDb();
  let query = 'SELECT * FROM files';
  const params: any[] = [];
  const conditions: string[] = [];

  if (purpose) {
    conditions.push('purpose = ?');
    params.push(purpose);
  }

  if (after) {
    const afterFile = db.prepare('SELECT created_at, id FROM files WHERE id = ?').get(after) as any;
    if (afterFile) {
      if (order === 'DESC') {
        conditions.push('(created_at < ? OR (created_at = ? AND id < ?))');
      } else {
        conditions.push('(created_at > ? OR (created_at = ? AND id > ?))');
      }
      params.push(afterFile.created_at, afterFile.created_at, afterFile.id);
    }
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ` ORDER BY created_at ${order}, id ${order} LIMIT ?`;
  params.push(limit + 1);

  const results = db.prepare(query).all(...params) as any[];
  const has_more = results.length > limit;
  const data = results.slice(0, limit).map(row => ({
    id: row.id,
    object: row.object,
    bytes: row.bytes,
    created_at: row.created_at,
    filename: row.filename,
    purpose: row.purpose,
    status: row.status
  }));

  res.status(200).json({
    object: 'list',
    data,
    has_more
  });
});

filesRouter.get('/:file_id', (req, res) => {
  if (!authenticateRequest(req, res)) return;

  const { file_id } = req.params;
  const db = getDb();
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(file_id) as any;

  if (!file) {
    return res.status(404).json({ error: { message: `No such File object: ${file_id}`, type: 'invalid_request_error', param: 'id' } });
  }

  res.status(200).json({
    id: file.id,
    object: file.object,
    bytes: file.bytes,
    created_at: file.created_at,
    filename: file.filename,
    purpose: file.purpose,
    status: file.status
  });
});

filesRouter.delete('/:file_id', async (req, res) => {
  if (!authenticateRequest(req, res)) return;

  const { file_id } = req.params;
  const db = getDb();
  
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(file_id) as any;
  if (!file) {
    return res.status(404).json({ error: { message: `No such File object: ${file_id}`, type: 'invalid_request_error', param: 'id' } });
  }

  db.prepare('DELETE FROM files WHERE id = ?').run(file_id);

  try {
    const fileDir = path.dirname(file.storage_path);
    await fs.rm(fileDir, { recursive: true, force: true });
  } catch (err) {
    console.error('Error deleting file from disk:', err);
  }

  res.status(200).json({
    id: file_id,
    object: 'file',
    deleted: true
  });
});

filesRouter.get('/:file_id/content', async (req, res) => {
  if (!authenticateRequest(req, res)) return;

  const { file_id } = req.params;
  const db = getDb();
  const file = db.prepare('SELECT * FROM files WHERE id = ?').get(file_id) as any;

  if (!file) {
    return res.status(404).json({ error: { message: `No such File object: ${file_id}`, type: 'invalid_request_error', param: 'id' } });
  }

  try {
    await fs.access(file.storage_path);
  } catch {
    return res.status(404).json({ error: { message: 'File content not found on disk', type: 'invalid_request_error' } });
  }

  const ext = path.extname(file.filename).toLowerCase();
  let contentType = 'application/octet-stream';
  if (ext === '.json') contentType = 'application/json';
  else if (ext === '.jsonl') contentType = 'application/x-ndjson';
  else if (ext === '.txt') contentType = 'text/plain';
  else if (ext === '.png') contentType = 'image/png';
  else if (ext === '.jpg' || ext === '.jpeg') contentType = 'image/jpeg';
  else if (ext === '.pdf') contentType = 'application/pdf';

  res.setHeader('Content-Type', contentType);
  const readStream = createReadStream(file.storage_path);
  readStream.pipe(res);
});
