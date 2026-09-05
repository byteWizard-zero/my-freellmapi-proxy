import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import multer from 'multer';
import fs from 'fs/promises';
import { createReadStream, createWriteStream } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getDb, getUnifiedApiKey } from '../db/index.js';
import { pipeline } from 'stream/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = path.resolve(__dirname, '../../data/uploads');
const FILES_DIR = path.resolve(__dirname, '../../data/files');

const storage = multer.memoryStorage();
const upload = multer({ storage });

export const uploadsRouter = Router();

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

// Ensure directories exist
fs.mkdir(UPLOADS_DIR, { recursive: true }).catch(console.error);
fs.mkdir(FILES_DIR, { recursive: true }).catch(console.error);

uploadsRouter.post('/', async (req, res) => {
  if (!authenticateRequest(req, res)) return;

  const { filename, purpose, bytes, mime_type } = req.body;
  
  if (!filename || !purpose || bytes === undefined) {
    return res.status(400).json({ error: { message: 'Missing required parameters', type: 'invalid_request_error' } });
  }

  const id = `upload-${crypto.randomUUID()}`;
  const createdAt = Math.floor(Date.now() / 1000);
  const expiresAt = createdAt + 3600; // 1 hour

  const uploadDir = path.join(UPLOADS_DIR, id);
  try {
    await fs.mkdir(uploadDir, { recursive: true });

    const db = getDb();
    db.prepare(`
      INSERT INTO uploads (id, object, bytes, created_at, filename, purpose, status, expires_at, mime_type)
      VALUES (?, 'upload', ?, ?, ?, ?, 'pending', ?, ?)
    `).run(id, bytes, createdAt, filename, purpose, expiresAt, mime_type || null);

    const uploadObj = {
      id,
      object: 'upload',
      bytes,
      created_at: createdAt,
      filename,
      purpose,
      status: 'pending',
      expires_at: expiresAt,
      file: null
    };

    res.status(200).json(uploadObj);
  } catch (err) {
    console.error('Upload session creation error:', err);
    res.status(500).json({ error: { message: 'Internal server error', type: 'server_error' } });
  }
});

uploadsRouter.post('/:upload_id/parts', upload.single('data'), async (req, res) => {
  if (!authenticateRequest(req, res)) return;

  const upload_id = String(req.params.upload_id);
  const chunk = req.file;
  
  if (!chunk) {
    return res.status(400).json({ error: { message: 'Missing file part data', type: 'invalid_request_error' } });
  }

  const db = getDb();
  const uploadSession = db.prepare('SELECT * FROM uploads WHERE id = ?').get(upload_id) as any;
  if (!uploadSession || uploadSession.status !== 'pending') {
    return res.status(404).json({ error: { message: `No pending upload with id ${upload_id}`, type: 'invalid_request_error', param: 'upload_id' } });
  }

  const partId = `part-${crypto.randomUUID()}`;
  const createdAt = Math.floor(Date.now() / 1000);
  
  // Get max part_index
  const maxPartIndexResult = db.prepare('SELECT MAX(part_index) as max_idx FROM upload_parts WHERE upload_id = ?').get(upload_id) as any;
  const partIndex = (maxPartIndexResult.max_idx !== null ? maxPartIndexResult.max_idx + 1 : 0);

  const storagePath = path.join(UPLOADS_DIR, upload_id, `part-${partIndex}`);

  try {
    await fs.writeFile(storagePath, chunk.buffer);
    db.prepare(`
      INSERT INTO upload_parts (id, upload_id, created_at, part_index, storage_path)
      VALUES (?, ?, ?, ?, ?)
    `).run(partId, upload_id, createdAt, partIndex, storagePath);

    res.status(200).json({
      id: partId,
      object: 'upload.part',
      created_at: createdAt,
      upload_id
    });
  } catch (err) {
    console.error('Error saving part:', err);
    res.status(500).json({ error: { message: 'Internal server error', type: 'server_error' } });
  }
});

uploadsRouter.post('/:upload_id/complete', async (req, res) => {
  if (!authenticateRequest(req, res)) return;

  const { upload_id } = req.params;
  const { part_ids } = req.body;

  if (!Array.isArray(part_ids)) {
    return res.status(400).json({ error: { message: 'part_ids must be an array', type: 'invalid_request_error' } });
  }

  const db = getDb();
  const uploadSession = db.prepare('SELECT * FROM uploads WHERE id = ?').get(upload_id) as any;
  if (!uploadSession || uploadSession.status !== 'pending') {
    return res.status(404).json({ error: { message: `No pending upload with id ${upload_id}`, type: 'invalid_request_error', param: 'upload_id' } });
  }

  const parts = db.prepare('SELECT * FROM upload_parts WHERE upload_id = ? ORDER BY part_index ASC').all(upload_id) as any[];
  
  if (parts.length !== part_ids.length || !part_ids.every((id, idx) => parts[idx] && parts[idx].id === id)) {
    return res.status(400).json({ error: { message: 'part_ids do not match uploaded parts in order', type: 'invalid_request_error' } });
  }

  const fileId = `file-${crypto.randomUUID()}`;
  const fileDir = path.join(FILES_DIR, fileId);
  const storagePath = path.join(fileDir, uploadSession.filename);

  try {
    await fs.mkdir(fileDir, { recursive: true });
    
    // Concatenate parts
    const writeStream = createWriteStream(storagePath);
    for (const part of parts) {
      const readStream = createReadStream(part.storage_path);
      await pipeline(readStream, writeStream, { end: false });
    }
    writeStream.end();

    const createdAt = Math.floor(Date.now() / 1000);

    db.transaction(() => {
      db.prepare(`
        INSERT INTO files (id, object, bytes, created_at, filename, purpose, status, storage_path)
        VALUES (?, 'file', ?, ?, ?, ?, 'uploaded', ?)
      `).run(fileId, uploadSession.bytes, createdAt, uploadSession.filename, uploadSession.purpose, storagePath);

      db.prepare('UPDATE uploads SET status = ?, file_id = ? WHERE id = ?').run('completed', fileId, upload_id);
    })();

    // Cleanup temp parts async
    fs.rm(path.join(UPLOADS_DIR, upload_id), { recursive: true, force: true }).catch(console.error);

    const fileObj = {
      id: fileId,
      object: 'file',
      bytes: uploadSession.bytes,
      created_at: createdAt,
      filename: uploadSession.filename,
      purpose: uploadSession.purpose,
      status: 'uploaded'
    };

    res.status(200).json({
      id: uploadSession.id,
      object: 'upload',
      bytes: uploadSession.bytes,
      created_at: uploadSession.created_at,
      filename: uploadSession.filename,
      purpose: uploadSession.purpose,
      status: 'completed',
      expires_at: uploadSession.expires_at,
      file: fileObj
    });
  } catch (err) {
    console.error('Error completing upload:', err);
    res.status(500).json({ error: { message: 'Internal server error', type: 'server_error' } });
  }
});

uploadsRouter.post('/:upload_id/cancel', async (req, res) => {
  if (!authenticateRequest(req, res)) return;

  const { upload_id } = req.params;

  const db = getDb();
  const uploadSession = db.prepare('SELECT * FROM uploads WHERE id = ?').get(upload_id) as any;
  if (!uploadSession || uploadSession.status !== 'pending') {
    return res.status(404).json({ error: { message: `No pending upload with id ${upload_id}`, type: 'invalid_request_error', param: 'upload_id' } });
  }

  db.prepare('UPDATE uploads SET status = ? WHERE id = ?').run('cancelled', upload_id);

  // Cleanup temp parts async
  fs.rm(path.join(UPLOADS_DIR, upload_id), { recursive: true, force: true }).catch(console.error);

  res.status(200).json({
    id: uploadSession.id,
    object: 'upload',
    bytes: uploadSession.bytes,
    created_at: uploadSession.created_at,
    filename: uploadSession.filename,
    purpose: uploadSession.purpose,
    status: 'cancelled',
    expires_at: uploadSession.expires_at,
    file: null
  });
});
