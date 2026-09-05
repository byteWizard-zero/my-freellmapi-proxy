import { Router, Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import { getDb, getUnifiedApiKey } from '../db/index.js';
import { executeRun } from '../services/run-executor.js';

export const threadsRouter = Router();

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

threadsRouter.use((req: Request, res: Response, next: NextFunction) => {
  if (authenticateRequest(req, res)) {
    next();
  }
});

// --- POST /runs (Create Thread and Run Atomically) ---
threadsRouter.post('/runs', (req: Request, res: Response) => {
  const db = getDb();
  const { assistant_id, thread, model, instructions, tools, metadata, temperature, top_p } = req.body;

  if (!assistant_id) {
    return res.status(400).json({ error: { message: 'Missing required parameter: assistant_id', type: 'invalid_request_error', param: 'assistant_id' } });
  }

  const threadId = `thread_${crypto.randomUUID()}`;
  const now = Math.floor(Date.now() / 1000);

  db.prepare(`
    INSERT INTO threads (id, object, created_at, metadata, tool_resources) 
    VALUES (?, 'thread', ?, ?, ?)
  `).run(
    threadId, now,
    thread?.metadata ? JSON.stringify(thread.metadata) : '{}',
    thread?.tool_resources ? JSON.stringify(thread.tool_resources) : null
  );

  if (thread?.messages && Array.isArray(thread.messages)) {
    for (const msg of thread.messages) {
      const msgId = `msg_${crypto.randomUUID()}`;
      const content = typeof msg.content === 'string' 
        ? JSON.stringify([{ type: 'text', text: { value: msg.content, annotations: [] } }])
        : JSON.stringify(msg.content || []);
      
      db.prepare(`
        INSERT INTO thread_messages (id, thread_id, created_at, role, content, attachments, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        msgId, threadId, now, msg.role, content,
        msg.attachments ? JSON.stringify(msg.attachments) : '[]',
        msg.metadata ? JSON.stringify(msg.metadata) : '{}'
      );
    }
  }

  const runId = `run_${crypto.randomUUID()}`;
  db.prepare(`
    INSERT INTO runs (
      id, object, created_at, thread_id, assistant_id, status, expires_at,
      model, instructions, tools, metadata, temperature, top_p,
      max_prompt_tokens, max_completion_tokens, truncation_strategy, tool_choice, parallel_tool_calls, response_format
    ) VALUES (
      ?, 'thread.run', ?, ?, ?, 'queued', ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?
    )
  `).run(
    runId, now, threadId, assistant_id, now + 600,
    model || null, instructions || null,
    tools ? JSON.stringify(tools) : '[]',
    metadata ? JSON.stringify(metadata) : '{}',
    temperature ?? null, top_p ?? null,
    req.body.max_prompt_tokens ?? null, req.body.max_completion_tokens ?? null,
    req.body.truncation_strategy ? JSON.stringify(req.body.truncation_strategy) : null,
    req.body.tool_choice ? (typeof req.body.tool_choice === 'string' ? req.body.tool_choice : JSON.stringify(req.body.tool_choice)) : null,
    req.body.parallel_tool_calls ?? 1,
    req.body.response_format ? (typeof req.body.response_format === 'string' ? req.body.response_format : JSON.stringify(req.body.response_format)) : null
  );

  executeRun(runId).catch(console.error);

  const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as any;
  run.tools = JSON.parse(run.tools);
  run.metadata = JSON.parse(run.metadata);
  if (run.truncation_strategy) run.truncation_strategy = JSON.parse(run.truncation_strategy);
  if (run.tool_choice && run.tool_choice.startsWith('{')) run.tool_choice = JSON.parse(run.tool_choice);
  if (run.response_format && run.response_format.startsWith('{')) run.response_format = JSON.parse(run.response_format);
  if (run.usage) run.usage = JSON.parse(run.usage);
  if (run.required_action) run.required_action = JSON.parse(run.required_action);

  res.status(200).json(run);
});

// --- POST / - Create thread ---
threadsRouter.post('/', (req: Request, res: Response) => {
  const db = getDb();
  const { messages, tool_resources, metadata } = req.body;
  const id = `thread_${crypto.randomUUID()}`;
  const created_at = Math.floor(Date.now() / 1000);

  db.transaction(() => {
    db.prepare(`
      INSERT INTO threads (id, object, created_at, metadata, tool_resources)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      id, 'thread', created_at,
      metadata ? JSON.stringify(metadata) : '{}',
      tool_resources ? JSON.stringify(tool_resources) : null
    );

    if (messages && Array.isArray(messages)) {
      const insertMsg = db.prepare(`
        INSERT INTO thread_messages (id, thread_id, created_at, role, content, attachments, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      for (const msg of messages) {
        const msgId = `msg_${crypto.randomUUID()}`;
        const contentStr = typeof msg.content === 'string' 
          ? JSON.stringify([{ type: 'text', text: { value: msg.content, annotations: [] } }]) 
          : JSON.stringify(msg.content || []);
        insertMsg.run(
          msgId, id, created_at, msg.role, contentStr,
          msg.attachments ? JSON.stringify(msg.attachments) : '[]',
          msg.metadata ? JSON.stringify(msg.metadata) : '{}'
        );
      }
    }
  })();

  const thread = db.prepare('SELECT * FROM threads WHERE id = ?').get(id) as any;
  thread.metadata = JSON.parse(thread.metadata);
  if (thread.tool_resources) thread.tool_resources = JSON.parse(thread.tool_resources);

  res.status(200).json(thread);
});

// --- GET /:thread_id - Retrieve thread ---
threadsRouter.get('/:thread_id', (req: Request, res: Response) => {
  const db = getDb();
  const thread = db.prepare('SELECT * FROM threads WHERE id = ?').get(req.params.thread_id) as any;
  if (!thread) {
    return res.status(404).json({ error: { message: `No thread found with id '${req.params.thread_id}'`, type: 'invalid_request_error' } });
  }
  thread.metadata = JSON.parse(thread.metadata);
  if (thread.tool_resources) thread.tool_resources = JSON.parse(thread.tool_resources);
  res.status(200).json(thread);
});

// --- POST /:thread_id - Modify thread ---
threadsRouter.post('/:thread_id', (req: Request, res: Response) => {
  const db = getDb();
  const id = req.params.thread_id;
  const current = db.prepare('SELECT * FROM threads WHERE id = ?').get(id) as any;
  if (!current) {
    return res.status(404).json({ error: { message: `No thread found with id '${id}'`, type: 'invalid_request_error' } });
  }

  const updates: string[] = [];
  const params: any[] = [];
  
  if (req.body.metadata !== undefined) {
    updates.push('metadata = ?');
    params.push(JSON.stringify(req.body.metadata));
  }
  if (req.body.tool_resources !== undefined) {
    updates.push('tool_resources = ?');
    params.push(JSON.stringify(req.body.tool_resources));
  }

  if (updates.length > 0) {
    params.push(id);
    db.prepare(`UPDATE threads SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  }

  const updated = db.prepare('SELECT * FROM threads WHERE id = ?').get(id) as any;
  updated.metadata = JSON.parse(updated.metadata);
  if (updated.tool_resources) updated.tool_resources = JSON.parse(updated.tool_resources);
  res.status(200).json(updated);
});

// --- DELETE /:thread_id - Delete thread ---
threadsRouter.delete('/:thread_id', (req: Request, res: Response) => {
  const db = getDb();
  const id = req.params.thread_id;
  
  db.transaction(() => {
    db.prepare('DELETE FROM run_steps WHERE thread_id = ?').run(id);
    db.prepare('DELETE FROM runs WHERE thread_id = ?').run(id);
    db.prepare('DELETE FROM thread_messages WHERE thread_id = ?').run(id);
    db.prepare('DELETE FROM threads WHERE id = ?').run(id);
  })();

  res.status(200).json({ id, object: 'thread.deleted', deleted: true });
});

// --- POST /:thread_id/messages - Create message ---
threadsRouter.post('/:thread_id/messages', (req: Request, res: Response) => {
  const db = getDb();
  const threadId = req.params.thread_id;
  if (!db.prepare('SELECT 1 FROM threads WHERE id = ?').get(threadId)) {
    return res.status(404).json({ error: { message: `No thread found with id '${threadId}'`, type: 'invalid_request_error' } });
  }

  const { role, content, attachments, metadata } = req.body;
  if (!role || !content) {
    return res.status(400).json({ error: { message: 'Missing required parameters: role, content', type: 'invalid_request_error' } });
  }

  const msgId = `msg_${crypto.randomUUID()}`;
  const created_at = Math.floor(Date.now() / 1000);
  const contentStr = typeof content === 'string' 
    ? JSON.stringify([{ type: 'text', text: { value: content, annotations: [] } }]) 
    : JSON.stringify(content);

  db.prepare(`
    INSERT INTO thread_messages (id, thread_id, created_at, role, content, attachments, metadata)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    msgId, threadId, created_at, role, contentStr,
    attachments ? JSON.stringify(attachments) : '[]',
    metadata ? JSON.stringify(metadata) : '{}'
  );

  const msg = db.prepare('SELECT * FROM thread_messages WHERE id = ?').get(msgId) as any;
  msg.content = JSON.parse(msg.content);
  msg.attachments = JSON.parse(msg.attachments);
  msg.metadata = JSON.parse(msg.metadata);
  res.status(200).json(msg);
});

// --- GET /:thread_id/messages - List messages ---
threadsRouter.get('/:thread_id/messages', (req: Request, res: Response) => {
  const db = getDb();
  const threadId = req.params.thread_id;
  const limit = parseInt(req.query.limit as string) || 20;
  const order = (req.query.order as string) === 'asc' ? 'ASC' : 'DESC';
  const after = req.query.after as string;
  const before = req.query.before as string;
  const run_id = req.query.run_id as string;

  let query = 'SELECT * FROM thread_messages WHERE thread_id = ?';
  const params: any[] = [threadId];

  if (run_id) {
    query += ' AND run_id = ?';
    params.push(run_id);
  }
  if (after) {
    query += ` AND created_at ${order === 'ASC' ? '>' : '<'} (SELECT created_at FROM thread_messages WHERE id = ?)`;
    params.push(after);
  }
  if (before) {
    query += ` AND created_at ${order === 'ASC' ? '<' : '>'} (SELECT created_at FROM thread_messages WHERE id = ?)`;
    params.push(before);
  }

  query += ` ORDER BY created_at ${order} LIMIT ?`;
  params.push(limit + 1);

  const rows = db.prepare(query).all(...params) as any[];
  const has_more = rows.length > limit;
  const data = rows.slice(0, limit).map(row => {
    row.content = JSON.parse(row.content);
    row.attachments = JSON.parse(row.attachments);
    row.metadata = JSON.parse(row.metadata);
    return row;
  });

  res.status(200).json({
    object: 'list',
    data,
    first_id: data.length > 0 ? data[0].id : null,
    last_id: data.length > 0 ? data[data.length - 1].id : null,
    has_more
  });
});

// --- GET /:thread_id/messages/:message_id - Retrieve message ---
threadsRouter.get('/:thread_id/messages/:message_id', (req: Request, res: Response) => {
  const db = getDb();
  const msg = db.prepare('SELECT * FROM thread_messages WHERE id = ? AND thread_id = ?').get(req.params.message_id, req.params.thread_id) as any;
  if (!msg) {
    return res.status(404).json({ error: { message: `No message found`, type: 'invalid_request_error' } });
  }
  msg.content = JSON.parse(msg.content);
  msg.attachments = JSON.parse(msg.attachments);
  msg.metadata = JSON.parse(msg.metadata);
  res.status(200).json(msg);
});

// --- POST /:thread_id/messages/:message_id - Modify message ---
threadsRouter.post('/:thread_id/messages/:message_id', (req: Request, res: Response) => {
  const db = getDb();
  if (req.body.metadata !== undefined) {
    db.prepare('UPDATE thread_messages SET metadata = ? WHERE id = ? AND thread_id = ?')
      .run(JSON.stringify(req.body.metadata), req.params.message_id, req.params.thread_id);
  }
  const msg = db.prepare('SELECT * FROM thread_messages WHERE id = ?').get(req.params.message_id) as any;
  if (!msg) return res.status(404).json({ error: { message: 'Not found', type: 'invalid_request_error' }});
  msg.content = JSON.parse(msg.content);
  msg.attachments = JSON.parse(msg.attachments);
  msg.metadata = JSON.parse(msg.metadata);
  res.status(200).json(msg);
});

// --- DELETE /:thread_id/messages/:message_id - Delete message ---
threadsRouter.delete('/:thread_id/messages/:message_id', (req: Request, res: Response) => {
  const db = getDb();
  db.prepare('DELETE FROM thread_messages WHERE id = ? AND thread_id = ?').run(req.params.message_id, req.params.thread_id);
  res.status(200).json({ id: req.params.message_id, object: 'thread.message.deleted', deleted: true });
});

// --- POST /:thread_id/runs - Create run ---
threadsRouter.post('/:thread_id/runs', (req: Request, res: Response) => {
  const db = getDb();
  const threadId = req.params.thread_id;
  const { 
    assistant_id, model, instructions, additional_instructions, 
    additional_messages, tools, stream, temperature, top_p, 
    max_prompt_tokens, max_completion_tokens, truncation_strategy, 
    tool_choice, parallel_tool_calls, response_format, metadata 
  } = req.body;

  if (!assistant_id) {
    return res.status(400).json({ error: { message: 'Missing required parameter: assistant_id', type: 'invalid_request_error' } });
  }
  if (!db.prepare('SELECT 1 FROM threads WHERE id = ?').get(threadId)) {
    return res.status(404).json({ error: { message: `No thread found with id '${threadId}'`, type: 'invalid_request_error' } });
  }

  // Handle additional messages if any
  if (additional_messages && Array.isArray(additional_messages)) {
    for (const msg of additional_messages) {
      const msgId = `msg_${crypto.randomUUID()}`;
      const contentStr = typeof msg.content === 'string' 
        ? JSON.stringify([{ type: 'text', text: { value: msg.content, annotations: [] } }]) 
        : JSON.stringify(msg.content || []);
      db.prepare(`
        INSERT INTO thread_messages (id, thread_id, created_at, role, content, attachments, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        msgId, threadId, Math.floor(Date.now() / 1000), msg.role, contentStr,
        msg.attachments ? JSON.stringify(msg.attachments) : '[]',
        msg.metadata ? JSON.stringify(msg.metadata) : '{}'
      );
    }
  }

  const runId = `run_${crypto.randomUUID()}`;
  const created_at = Math.floor(Date.now() / 1000);
  const expires_at = created_at + 600; // 10 minutes

  // Merge instructions if additional_instructions present
  let finalInstructions = instructions;
  if (additional_instructions) {
    finalInstructions = finalInstructions ? `${finalInstructions}\n\n${additional_instructions}` : additional_instructions;
  }

  db.prepare(`
    INSERT INTO runs (
      id, object, created_at, thread_id, assistant_id, status, expires_at,
      model, instructions, tools, metadata, temperature, top_p,
      max_prompt_tokens, max_completion_tokens, truncation_strategy, tool_choice, parallel_tool_calls, response_format
    ) VALUES (
      ?, 'thread.run', ?, ?, ?, 'queued', ?,
      ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?
    )
  `).run(
    runId, created_at, threadId, assistant_id, expires_at,
    model || null, finalInstructions || null,
    tools ? JSON.stringify(tools) : '[]',
    metadata ? JSON.stringify(metadata) : '{}',
    temperature ?? null, top_p ?? null,
    max_prompt_tokens ?? null, max_completion_tokens ?? null,
    truncation_strategy ? JSON.stringify(truncation_strategy) : null,
    tool_choice ? (typeof tool_choice === 'string' ? tool_choice : JSON.stringify(tool_choice)) : null,
    parallel_tool_calls ?? 1,
    response_format ? (typeof response_format === 'string' ? response_format : JSON.stringify(response_format)) : null
  );

  // Trigger background execution
  executeRun(runId).catch(console.error);

  const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as any;
  run.tools = JSON.parse(run.tools);
  run.metadata = JSON.parse(run.metadata);
  if (run.truncation_strategy) run.truncation_strategy = JSON.parse(run.truncation_strategy);
  if (run.tool_choice && run.tool_choice.startsWith('{')) run.tool_choice = JSON.parse(run.tool_choice);
  if (run.response_format && run.response_format.startsWith('{')) run.response_format = JSON.parse(run.response_format);
  if (run.usage) run.usage = JSON.parse(run.usage);
  if (run.required_action) run.required_action = JSON.parse(run.required_action);

  res.status(200).json(run);
});

// --- GET /:thread_id/runs - List runs ---
threadsRouter.get('/:thread_id/runs', (req: Request, res: Response) => {
  const db = getDb();
  const threadId = req.params.thread_id;
  const rows = db.prepare('SELECT * FROM runs WHERE thread_id = ? ORDER BY created_at DESC').all(threadId) as any[];
  const data = rows.map(run => {
    run.tools = JSON.parse(run.tools);
    run.metadata = JSON.parse(run.metadata);
    if (run.truncation_strategy) run.truncation_strategy = JSON.parse(run.truncation_strategy);
    if (run.tool_choice && run.tool_choice.startsWith('{')) run.tool_choice = JSON.parse(run.tool_choice);
    if (run.response_format && run.response_format.startsWith('{')) run.response_format = JSON.parse(run.response_format);
    if (run.usage) run.usage = JSON.parse(run.usage);
    if (run.required_action) run.required_action = JSON.parse(run.required_action);
    return run;
  });
  res.status(200).json({ object: 'list', data, first_id: data[0]?.id || null, last_id: data[data.length-1]?.id || null, has_more: false });
});

// --- GET /:thread_id/runs/:run_id - Retrieve run ---
threadsRouter.get('/:thread_id/runs/:run_id', (req: Request, res: Response) => {
  const db = getDb();
  const run = db.prepare('SELECT * FROM runs WHERE id = ? AND thread_id = ?').get(req.params.run_id, req.params.thread_id) as any;
  if (!run) return res.status(404).json({ error: { message: 'Not found', type: 'invalid_request_error' } });
  
  run.tools = JSON.parse(run.tools);
  run.metadata = JSON.parse(run.metadata);
  if (run.truncation_strategy) run.truncation_strategy = JSON.parse(run.truncation_strategy);
  if (run.tool_choice && run.tool_choice.startsWith('{')) run.tool_choice = JSON.parse(run.tool_choice);
  if (run.response_format && run.response_format.startsWith('{')) run.response_format = JSON.parse(run.response_format);
  if (run.usage) run.usage = JSON.parse(run.usage);
  if (run.required_action) run.required_action = JSON.parse(run.required_action);
  
  res.status(200).json(run);
});

// --- POST /:thread_id/runs/:run_id - Modify run ---
threadsRouter.post('/:thread_id/runs/:run_id', (req: Request, res: Response) => {
  const db = getDb();
  if (req.body.metadata !== undefined) {
    db.prepare('UPDATE runs SET metadata = ? WHERE id = ? AND thread_id = ?')
      .run(JSON.stringify(req.body.metadata), req.params.run_id, req.params.thread_id);
  }
  const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(req.params.run_id) as any;
  if (!run) return res.status(404).json({ error: { message: 'Not found', type: 'invalid_request_error' }});
  
  run.tools = JSON.parse(run.tools);
  run.metadata = JSON.parse(run.metadata);
  if (run.truncation_strategy) run.truncation_strategy = JSON.parse(run.truncation_strategy);
  if (run.tool_choice && run.tool_choice.startsWith('{')) run.tool_choice = JSON.parse(run.tool_choice);
  if (run.response_format && run.response_format.startsWith('{')) run.response_format = JSON.parse(run.response_format);
  if (run.usage) run.usage = JSON.parse(run.usage);
  if (run.required_action) run.required_action = JSON.parse(run.required_action);
  
  res.status(200).json(run);
});

// --- POST /:thread_id/runs/:run_id/submit_tool_outputs ---
threadsRouter.post('/:thread_id/runs/:run_id/submit_tool_outputs', (req: Request, res: Response) => {
  const db = getDb();
  const runId = String(req.params.run_id);
  const threadId = String(req.params.thread_id);
  const { tool_outputs } = req.body;

  const run = db.prepare('SELECT * FROM runs WHERE id = ? AND thread_id = ?').get(runId, threadId) as any;
  if (!run) return res.status(404).json({ error: { message: 'Run not found', type: 'invalid_request_error' } });
  
  if (run.status !== 'requires_action') {
    return res.status(400).json({ error: { message: 'Run is not waiting for tool outputs', type: 'invalid_request_error' } });
  }

  // Record tool outputs as messages in the thread (so they are context for next LLM call)
  const now = Math.floor(Date.now() / 1000);
  for (const output of tool_outputs) {
    const msgId = `msg_${crypto.randomUUID()}`;
    const content = JSON.stringify([{ type: 'text', text: { value: output.output || "", annotations: [] } }]);
    db.prepare(`
      INSERT INTO thread_messages (id, thread_id, created_at, role, content, run_id, metadata)
      VALUES (?, ?, ?, 'tool', ?, ?, ?)
    `).run(msgId, threadId, now, content, runId, JSON.stringify({ tool_call_id: output.tool_call_id }));
  }

  db.prepare('UPDATE runs SET status = ?, required_action = NULL WHERE id = ?').run('queued', runId);
  
  // Re-trigger execution
  executeRun(runId).catch(console.error);

  const updatedRun = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as any;
  updatedRun.tools = JSON.parse(updatedRun.tools);
  updatedRun.metadata = JSON.parse(updatedRun.metadata);
  if (updatedRun.truncation_strategy) updatedRun.truncation_strategy = JSON.parse(updatedRun.truncation_strategy);
  if (updatedRun.tool_choice && updatedRun.tool_choice.startsWith('{')) updatedRun.tool_choice = JSON.parse(updatedRun.tool_choice);
  if (updatedRun.response_format && updatedRun.response_format.startsWith('{')) updatedRun.response_format = JSON.parse(updatedRun.response_format);
  if (updatedRun.usage) updatedRun.usage = JSON.parse(updatedRun.usage);
  
  res.status(200).json(updatedRun);
});

// --- POST /:thread_id/runs/:run_id/cancel ---
threadsRouter.post('/:thread_id/runs/:run_id/cancel', (req: Request, res: Response) => {
  const db = getDb();
  const runId = req.params.run_id;
  db.prepare('UPDATE runs SET status = ?, cancelled_at = ? WHERE id = ?')
    .run('cancelled', Math.floor(Date.now() / 1000), runId);
  
  const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as any;
  if (!run) return res.status(404).json({ error: { message: 'Run not found', type: 'invalid_request_error' } });
  
  run.tools = JSON.parse(run.tools);
  run.metadata = JSON.parse(run.metadata);
  if (run.truncation_strategy) run.truncation_strategy = JSON.parse(run.truncation_strategy);
  if (run.tool_choice && run.tool_choice.startsWith('{')) run.tool_choice = JSON.parse(run.tool_choice);
  if (run.response_format && run.response_format.startsWith('{')) run.response_format = JSON.parse(run.response_format);
  if (run.usage) run.usage = JSON.parse(run.usage);
  
  res.status(200).json(run);
});

// --- GET /:thread_id/runs/:run_id/steps - List run steps ---
threadsRouter.get('/:thread_id/runs/:run_id/steps', (req: Request, res: Response) => {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM run_steps WHERE run_id = ? AND thread_id = ? ORDER BY created_at ASC')
    .all(req.params.run_id, req.params.thread_id) as any[];
  
  const data = rows.map(step => {
    step.step_details = JSON.parse(step.step_details);
    if (step.usage) step.usage = JSON.parse(step.usage);
    return step;
  });
  
  res.status(200).json({ object: 'list', data, first_id: data[0]?.id || null, last_id: data[data.length-1]?.id || null, has_more: false });
});

// --- GET /:thread_id/runs/:run_id/steps/:step_id - Retrieve step ---
threadsRouter.get('/:thread_id/runs/:run_id/steps/:step_id', (req: Request, res: Response) => {
  const db = getDb();
  const step = db.prepare('SELECT * FROM run_steps WHERE id = ? AND run_id = ? AND thread_id = ?')
    .get(req.params.step_id, req.params.run_id, req.params.thread_id) as any;
  if (!step) return res.status(404).json({ error: { message: 'Step not found', type: 'invalid_request_error' } });
  
  step.step_details = JSON.parse(step.step_details);
  if (step.usage) step.usage = JSON.parse(step.usage);
  res.status(200).json(step);
});
