import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { getDb, getUnifiedApiKey } from '../db/index.js';

export const assistantsRouter = Router();

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

// Middleware to apply authentication to all routes in this router
assistantsRouter.use((req: Request, res: Response, next: NextFunction) => {
  if (authenticateRequest(req, res)) {
    next();
  }
});

// POST / - Create assistant
assistantsRouter.post('/', (req: Request, res: Response) => {
  const db = getDb();
  const {
    model, name, description, instructions, tools, tool_resources,
    metadata, temperature, top_p, response_format
  } = req.body;

  if (!model) {
    return res.status(400).json({ error: { message: 'Missing required parameter: model', type: 'invalid_request_error', param: 'model' } });
  }

  const id = `asst_${crypto.randomUUID()}`;
  const created_at = Math.floor(Date.now() / 1000);

  const stmt = db.prepare(`
    INSERT INTO assistants (
      id, object, created_at, model, name, description, instructions,
      tools, tool_resources, metadata, temperature, top_p, response_format
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?
    )
  `);

  stmt.run(
    id, 'assistant', created_at, model, name || null, description || null, instructions || null,
    tools ? JSON.stringify(tools) : '[]',
    tool_resources ? JSON.stringify(tool_resources) : null,
    metadata ? JSON.stringify(metadata) : '{}',
    temperature ?? 1.0, top_p ?? 1.0,
    response_format ? (typeof response_format === 'string' ? response_format : JSON.stringify(response_format)) : null
  );

  const assistant = db.prepare('SELECT * FROM assistants WHERE id = ?').get(id) as any;
  assistant.tools = JSON.parse(assistant.tools);
  if (assistant.tool_resources) assistant.tool_resources = JSON.parse(assistant.tool_resources);
  assistant.metadata = JSON.parse(assistant.metadata);
  if (assistant.response_format && assistant.response_format.startsWith('{')) assistant.response_format = JSON.parse(assistant.response_format);

  res.status(200).json(assistant);
});

// GET / - List assistants
assistantsRouter.get('/', (req: Request, res: Response) => {
  const db = getDb();
  const limit = parseInt(req.query.limit as string) || 20;
  const order = (req.query.order as string) === 'asc' ? 'ASC' : 'DESC';
  const after = req.query.after as string;
  const before = req.query.before as string;

  let query = 'SELECT * FROM assistants';
  const params: any[] = [];
  const conditions: string[] = [];

  if (after) {
    conditions.push(`created_at ${order === 'ASC' ? '>' : '<'} (SELECT created_at FROM assistants WHERE id = ?)`);
    params.push(after);
  }
  if (before) {
    conditions.push(`created_at ${order === 'ASC' ? '<' : '>'} (SELECT created_at FROM assistants WHERE id = ?)`);
    params.push(before);
  }

  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }

  query += ` ORDER BY created_at ${order} LIMIT ?`;
  params.push(limit + 1);

  const rows = db.prepare(query).all(...params) as any[];
  
  const has_more = rows.length > limit;
  const data = rows.slice(0, limit).map(row => {
    row.tools = JSON.parse(row.tools);
    if (row.tool_resources) row.tool_resources = JSON.parse(row.tool_resources);
    row.metadata = JSON.parse(row.metadata);
    if (row.response_format && row.response_format.startsWith('{')) row.response_format = JSON.parse(row.response_format);
    return row;
  });

  const first_id = data.length > 0 ? data[0].id : null;
  const last_id = data.length > 0 ? data[data.length - 1].id : null;

  res.status(200).json({
    object: 'list',
    data,
    first_id,
    last_id,
    has_more
  });
});

// GET /:assistant_id - Retrieve assistant
assistantsRouter.get('/:assistant_id', (req: Request, res: Response) => {
  const db = getDb();
  const assistant = db.prepare('SELECT * FROM assistants WHERE id = ?').get(req.params.assistant_id) as any;
  if (!assistant) {
    return res.status(404).json({ error: { message: `No assistant found with id '${req.params.assistant_id}'`, type: 'invalid_request_error' } });
  }

  assistant.tools = JSON.parse(assistant.tools);
  if (assistant.tool_resources) assistant.tool_resources = JSON.parse(assistant.tool_resources);
  assistant.metadata = JSON.parse(assistant.metadata);
  if (assistant.response_format && assistant.response_format.startsWith('{')) assistant.response_format = JSON.parse(assistant.response_format);

  res.status(200).json(assistant);
});

// POST /:assistant_id - Modify assistant
assistantsRouter.post('/:assistant_id', (req: Request, res: Response) => {
  const db = getDb();
  const id = req.params.assistant_id;
  const current = db.prepare('SELECT * FROM assistants WHERE id = ?').get(id) as any;
  
  if (!current) {
    return res.status(404).json({ error: { message: `No assistant found with id '${id}'`, type: 'invalid_request_error' } });
  }

  const updates: string[] = [];
  const params: any[] = [];
  
  const fields = ['model', 'name', 'description', 'instructions', 'temperature', 'top_p'];
  for (const field of fields) {
    if (req.body[field] !== undefined) {
      updates.push(`${field} = ?`);
      params.push(req.body[field]);
    }
  }

  if (req.body.tools !== undefined) {
    updates.push(`tools = ?`);
    params.push(JSON.stringify(req.body.tools));
  }
  
  if (req.body.tool_resources !== undefined) {
    updates.push(`tool_resources = ?`);
    params.push(JSON.stringify(req.body.tool_resources));
  }
  
  if (req.body.metadata !== undefined) {
    updates.push(`metadata = ?`);
    params.push(JSON.stringify(req.body.metadata));
  }

  if (req.body.response_format !== undefined) {
    updates.push(`response_format = ?`);
    params.push(typeof req.body.response_format === 'string' ? req.body.response_format : JSON.stringify(req.body.response_format));
  }

  if (updates.length > 0) {
    params.push(id);
    db.prepare(`UPDATE assistants SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  const updated = db.prepare('SELECT * FROM assistants WHERE id = ?').get(id) as any;
  updated.tools = JSON.parse(updated.tools);
  if (updated.tool_resources) updated.tool_resources = JSON.parse(updated.tool_resources);
  updated.metadata = JSON.parse(updated.metadata);
  if (updated.response_format && updated.response_format.startsWith('{')) updated.response_format = JSON.parse(updated.response_format);

  res.status(200).json(updated);
});

// DELETE /:assistant_id - Delete assistant
assistantsRouter.delete('/:assistant_id', (req: Request, res: Response) => {
  const db = getDb();
  const id = req.params.assistant_id;
  const info = db.prepare('DELETE FROM assistants WHERE id = ?').run(id);

  if (info.changes === 0) {
    return res.status(404).json({ error: { message: `No assistant found with id '${id}'`, type: 'invalid_request_error' } });
  }

  res.status(200).json({
    id,
    object: 'assistant.deleted',
    deleted: true
  });
});
