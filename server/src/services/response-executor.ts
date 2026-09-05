import crypto from 'crypto';
import { getUnifiedApiKey } from '../db/index.js';

export async function executeResponse(params: any): Promise<any> {
  const port = process.env.PORT || 3001;
  const apiKey = getUnifiedApiKey();

  const chatParams = {
    model: params.model,
    messages: params.messages,
    ...(params.tools && { tools: params.tools }),
    ...(params.tool_choice && { tool_choice: params.tool_choice }),
    ...(params.temperature !== undefined && { temperature: params.temperature }),
    ...(params.top_p !== undefined && { top_p: params.top_p }),
    ...(params.max_tokens !== undefined && { max_tokens: params.max_tokens })
  };

  const res = await fetch(`http://localhost:${port}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(chatParams)
  });

  const data = (await res.json()) as any;

  if (!res.ok) {
    throw new Error(data.error?.message || 'Chat completions request failed');
  }

  const output: any[] = [];

  const choice = data.choices && data.choices[0];
  if (choice && choice.message) {
    const msg = choice.message;
    if (msg.content) {
      output.push({
        type: 'message',
        id: `msg-${crypto.randomUUID()}`,
        status: 'completed',
        role: 'assistant',
        content: [{
          type: 'output_text',
          text: msg.content,
          annotations: []
        }]
      });
    }

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const call of msg.tool_calls) {
        output.push({
          type: 'function_call',
          id: `call-${crypto.randomUUID()}`,
          call_id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
          status: 'completed'
        });
      }
    }
  }

  return {
    output,
    usage: data.usage
  };
}
