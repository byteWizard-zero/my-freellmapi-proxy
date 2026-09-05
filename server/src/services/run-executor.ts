import { getDb, getUnifiedApiKey } from '../db/index.js';
import crypto from 'crypto';

export async function executeRun(runId: string): Promise<void> {
  const db = getDb();
  
  try {
    const run = db.prepare('SELECT * FROM runs WHERE id = ?').get(runId) as any;
    if (!run || (run.status !== 'queued' && run.status !== 'requires_action')) {
      return; // Run might be cancelled or already processed
    }

    const now = Math.floor(Date.now() / 1000);
    if (!run.started_at) {
      db.prepare('UPDATE runs SET status = ?, started_at = ? WHERE id = ?').run('in_progress', now, runId);
    } else {
      db.prepare('UPDATE runs SET status = ? WHERE id = ?').run('in_progress', runId);
    }

    const assistant = db.prepare('SELECT * FROM assistants WHERE id = ?').get(run.assistant_id) as any;
    if (!assistant) throw new Error('Assistant not found');

    const model = run.model || assistant.model;
    
    // Construct system instructions
    let systemPrompt = run.instructions || assistant.instructions || '';

    // Get conversation history
    const threadMessages = db.prepare('SELECT * FROM thread_messages WHERE thread_id = ? ORDER BY created_at ASC').all(run.thread_id) as any[];
    
    const messages: any[] = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    for (const msg of threadMessages) {
      const parsedContent = JSON.parse(msg.content);
      const metadata = JSON.parse(msg.metadata || '{}');
      
      let textContent = '';
      if (Array.isArray(parsedContent)) {
        textContent = parsedContent.map((c: any) => c.text?.value || '').join('\n');
      }

      if (msg.role === 'tool') {
        messages.push({
          role: 'tool',
          content: textContent,
          tool_call_id: metadata.tool_call_id
        });
      } else if (msg.role === 'assistant' && metadata.tool_calls) {
        messages.push({
          role: 'assistant',
          content: textContent || null,
          tool_calls: metadata.tool_calls
        });
      } else {
        messages.push({
          role: msg.role,
          content: textContent
        });
      }
    }

    const toolsStr = run.tools || assistant.tools || '[]';
    const parsedTools = JSON.parse(toolsStr);
    const apiTools = parsedTools.length > 0 ? parsedTools.filter((t: any) => t.type === 'function') : undefined;

    const reqBody: any = {
      model,
      messages,
      temperature: run.temperature ?? assistant.temperature,
      top_p: run.top_p ?? assistant.top_p,
    };
    if (apiTools && apiTools.length > 0) reqBody.tools = apiTools;
    if (run.max_prompt_tokens) reqBody.max_prompt_tokens = run.max_prompt_tokens;
    if (run.max_completion_tokens) reqBody.max_tokens = run.max_completion_tokens;
    if (run.response_format) reqBody.response_format = typeof run.response_format === 'string' ? JSON.parse(run.response_format) : run.response_format;

    const apiKey = getUnifiedApiKey();
    const port = process.env.PORT || 3001;
    
    const response = await fetch(`http://localhost:${port}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(reqBody)
    });

    if (!response.ok) {
      const errBody = await response.text();
      throw new Error(`Chat API error: ${response.status} ${errBody}`);
    }

    const data = (await response.json()) as any;
    const choice = data.choices[0];
    const usage = data.usage || {};
    const usageStr = JSON.stringify(usage);

    if (choice.finish_reason === 'tool_calls' || choice.message.tool_calls) {
      // Handle tool calls
      const toolCalls = choice.message.tool_calls;
      
      const stepId = `step_${crypto.randomUUID()}`;
      const stepNow = Math.floor(Date.now() / 1000);
      
      db.prepare(`
        INSERT INTO run_steps (
          id, run_id, assistant_id, thread_id, type, status, step_details, created_at
        ) VALUES (?, ?, ?, ?, 'tool_calls', 'in_progress', ?, ?)
      `).run(
        stepId, runId, run.assistant_id, run.thread_id,
        JSON.stringify({ type: 'tool_calls', tool_calls: toolCalls }), stepNow
      );

      db.prepare(`
        UPDATE runs 
        SET status = 'requires_action', required_action = ?
        WHERE id = ?
      `).run(
        JSON.stringify({ type: 'submit_tool_outputs', submit_tool_outputs: { tool_calls: toolCalls } }),
        runId
      );

      // We need to inject the assistant message with the tool_calls into the thread so it is remembered
      const msgId = `msg_${crypto.randomUUID()}`;
      db.prepare(`
        INSERT INTO thread_messages (id, thread_id, created_at, role, content, metadata, run_id)
        VALUES (?, ?, ?, 'assistant', '[]', ?, ?)
      `).run(
        msgId, run.thread_id, stepNow, 
        JSON.stringify({ tool_calls: toolCalls }),
        runId
      );

    } else {
      // Regular text response
      const stepId = `step_${crypto.randomUUID()}`;
      const completionNow = Math.floor(Date.now() / 1000);
      
      db.prepare(`
        INSERT INTO run_steps (
          id, run_id, assistant_id, thread_id, type, status, step_details, created_at, completed_at, usage
        ) VALUES (?, ?, ?, ?, 'message_creation', 'completed', ?, ?, ?, ?)
      `).run(
        stepId, runId, run.assistant_id, run.thread_id,
        JSON.stringify({ type: 'message_creation', message_creation: { message_id: `msg_${crypto.randomUUID()}` } }), 
        completionNow, completionNow, usageStr
      );

      const msgId = `msg_${crypto.randomUUID()}`;
      const contentStr = JSON.stringify([{ type: 'text', text: { value: choice.message.content || "", annotations: [] } }]);
      
      db.prepare(`
        INSERT INTO thread_messages (id, thread_id, created_at, role, content, run_id)
        VALUES (?, ?, ?, 'assistant', ?, ?)
      `).run(msgId, run.thread_id, completionNow, contentStr, runId);

      db.prepare(`
        UPDATE runs 
        SET status = 'completed', completed_at = ?, usage = ?
        WHERE id = ?
      `).run(completionNow, usageStr, runId);
    }

  } catch (error: any) {
    console.error(`Error executing run ${runId}:`, error);
    const failNow = Math.floor(Date.now() / 1000);
    db.prepare(`
      UPDATE runs 
      SET status = 'failed', failed_at = ?, last_error = ?
      WHERE id = ?
    `).run(
      failNow, 
      JSON.stringify({ code: 'server_error', message: error.message || 'Unknown error' }),
      runId
    );
  }
}
