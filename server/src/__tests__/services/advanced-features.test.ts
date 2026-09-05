import { describe, it, expect, beforeEach } from 'vitest';
import { ResponseCache } from '../../services/response-cache.js';
import { CodeInterpreter } from '../../services/code-interpreter.js';
import { SmartClassifier } from '../../services/smart-classifier.js';
import { storage } from '../../lib/storage.js';
import { initDb } from '../../db/index.js';

describe('Advanced Features: Cache, Interpreter & Storage', () => {
  beforeEach(() => {
    initDb(':memory:');
    ResponseCache.clear();
  });

  describe('ResponseCache', () => {
    it('stores and retrieves cached responses', () => {
      const params = {
        messages: [{ role: 'user', content: 'What is 10 + 10?' }],
        model: 'auto',
      };

      expect(ResponseCache.get(params)).toBeNull();

      const mockResponse: any = {
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 1700000000,
        model: 'test-model',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: '20' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      };

      ResponseCache.set(params, mockResponse);

      const cached = ResponseCache.get(params);
      expect(cached).toBeDefined();
      expect(cached?.choices[0].message.content).toBe('20');
      expect(cached?.id).toContain('chatcmpl-cached-');
    });

    it('returns null on cache miss with different prompt', () => {
      const params1 = { messages: [{ role: 'user', content: 'Hello' }] };
      const params2 = { messages: [{ role: 'user', content: 'Goodbye' }] };

      ResponseCache.set(params1, {
        id: 'chatcmpl-1',
        object: 'chat.completion',
        created: 1700000000,
        model: 'm',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Hi' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });

      expect(ResponseCache.get(params2)).toBeNull();
    });
  });

  describe('CodeInterpreter', () => {
    it('executes javascript code safely in sandbox', async () => {
      const code = `
        const a = 15;
        const b = 25;
        console.log("SUM=" + (a + b));
      `;
      const result = await CodeInterpreter.execute(code, 'javascript');
      expect(result.success).toBe(true);
      expect(result.stdout).toContain('SUM=40');
      expect(result.executionTimeMs).toBeGreaterThanOrEqual(0);
    });

    it('captures errors gracefully without crashing', async () => {
      const code = `throw new Error("Intentional sandbox test error");`;
      const result = await CodeInterpreter.execute(code, 'javascript');
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('Intentional sandbox test error');
    });
  });

  describe('SmartClassifier', () => {
    it('classifies conversational short queries without errors', async () => {
      const messages: any[] = [{ role: 'user', content: 'Hello there!' }];
      const classification = await SmartClassifier.classify(messages);
      expect(classification.category).toBe('conversational_fast');
      expect(classification.recommended_focus).toBe('speed');
    });
  });

  describe('StorageService', () => {
    it('saves and reads files from storage driver', async () => {
      const content = Buffer.from('Testing unified storage driver for FreeLLMAPI');
      const filename = `test-file-${Date.now()}.txt`;

      const saved = await storage.saveFile(filename, content);
      expect(saved.bytes).toBe(content.length);

      const readBack = await storage.readFile(saved.storagePath);
      expect(readBack.toString()).toBe('Testing unified storage driver for FreeLLMAPI');

      const deleted = await storage.deleteFile(saved.storagePath);
      expect(deleted).toBe(true);
    });
  });
});
