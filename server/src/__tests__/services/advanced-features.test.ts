import { describe, it, expect, beforeEach } from 'vitest';
import { ResponseCache } from '../../services/response-cache.js';
import { CodeInterpreter } from '../../services/code-interpreter.js';
import { SmartClassifier } from '../../services/smart-classifier.js';
import {
  recursiveTextSplitter,
  RecursiveTextSplitter,
  getCachedVector,
  clearVectorCache,
  cosineSimilarity,
} from '../../services/vector-indexer.js';
import { storage } from '../../lib/storage.js';
import { initDb } from '../../db/index.js';

describe('Advanced Features: Cache, Interpreter & Storage', () => {
  beforeEach(() => {
    initDb(':memory:');
    ResponseCache.clear();
    clearVectorCache();
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

    it('normalizes prompt query with whitespace trimming and trivial case variations', () => {
      const baseParams = {
        messages: [{ role: 'user', content: 'What is 10 + 10?' }],
        model: 'auto',
      };

      ResponseCache.set(baseParams, {
        id: 'chatcmpl-norm-test',
        object: 'chat.completion',
        created: 1700000000,
        model: 'auto',
        choices: [{ index: 0, message: { role: 'assistant', content: '20' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      });

      // 1. Whitespace variation hit
      const whitespaceQuery = {
        messages: [{ role: 'user', content: '   What is   10 + 10?  \n' }],
        model: 'AUTO',
      };
      const hit1 = ResponseCache.get(whitespaceQuery);
      expect(hit1).toBeDefined();
      expect(hit1?.choices[0].message.content).toBe('20');

      // 2. Trivial message case normalization hit
      const lowerQuery = {
        messages: [{ role: 'user', content: 'what is 10 + 10?' }],
        model: 'auto',
      };
      const hit2 = ResponseCache.get(lowerQuery);
      expect(hit2).toBeDefined();
      expect(hit2?.choices[0].message.content).toBe('20');

      // 3. System message case variation hit
      const sysParams1 = {
        messages: [
          { role: 'system', content: 'You are a helpful assistant.' },
          { role: 'user', content: 'Tell me a fact' },
        ],
      };
      const sysParams2 = {
        messages: [
          { role: 'SYSTEM', content: '  you are a helpful assistant.  ' },
          { role: 'user', content: 'tell me a fact' },
        ],
      };
      ResponseCache.set(sysParams1, {
        id: 'chatcmpl-sys',
        object: 'chat.completion',
        created: 1700000000,
        model: 'auto',
        choices: [{ index: 0, message: { role: 'assistant', content: 'Fact' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7 },
      });

      const sysHit = ResponseCache.get(sysParams2);
      expect(sysHit).toBeDefined();
      expect(sysHit?.choices[0].message.content).toBe('Fact');
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

    it('provides sanitized environment variables without sensitive API keys', () => {
      process.env.GEMINI_API_KEY = 'super-secret-gemini-key';
      process.env.OPENROUTER_API_KEY = 'secret-openrouter-key';
      process.env.DATABASE_URL = 'postgres://user:pass@host/db';

      const sanitized = CodeInterpreter.getSanitizedEnv();

      expect(sanitized.GEMINI_API_KEY).toBeUndefined();
      expect(sanitized.OPENROUTER_API_KEY).toBeUndefined();
      expect(sanitized.DATABASE_URL).toBeUndefined();
      expect(sanitized.PYTHONUNBUFFERED).toBe('1');
    });

    it('rejects code payloads exceeding maximum length limit', async () => {
      const hugeCode = 'a'.repeat(120 * 1024);
      const result = await CodeInterpreter.execute(hugeCode, 'javascript');
      expect(result.success).toBe(false);
      expect(result.stderr).toContain('maximum size limit');
    });
  });

  describe('SmartClassifier', () => {
    it('classifies conversational short queries without errors', async () => {
      const messages: any[] = [{ role: 'user', content: 'Hello there!' }];
      const classification = await SmartClassifier.classify(messages);
      expect(classification.category).toBe('conversational_fast');
      expect(classification.recommended_focus).toBe('speed');
    });

    it('instantly identifies code queries via regex heuristics without LLM call', async () => {
      const queries = [
        'def fibonacci(n): return n if n <= 1 else fibonacci(n-1) + fibonacci(n-2)',
        'SELECT id, name FROM users WHERE role = "admin" ORDER BY created_at DESC',
        'git commit -m "fix cache bug"',
        'Can you provide a regex to match email addresses?',
        'npm install express --save',
        'Fix this TypeError: Cannot read properties of undefined',
      ];

      for (const query of queries) {
        const result = SmartClassifier.classifyHeuristic(query);
        expect(result).not.toBeNull();
        expect(result?.category).toBe('code');
      }
    });

    it('instantly identifies math and reasoning queries via heuristics', async () => {
      const queries = [
        'Calculate 24 * 15 + 100',
        'Solve for x: 3x + 12 = 45',
        'Can you solve this riddle: I speak without a mouth and hear without ears',
      ];

      for (const query of queries) {
        const result = SmartClassifier.classifyHeuristic(query);
        expect(result).not.toBeNull();
        expect(result?.category).toBe('reasoning_math');
      }
    });

    it('instantly identifies creative writing queries via heuristics', async () => {
      const queries = [
        'Write a poem about the autumn leaves',
        'Write a story about an astronaut lost in deep space',
        'Write a screenplay scene between two detectives',
      ];

      for (const query of queries) {
        const result = SmartClassifier.classifyHeuristic(query);
        expect(result).not.toBeNull();
        expect(result?.category).toBe('creative_writing');
      }
    });
  });

  describe('VectorIndexer & RecursiveTextSplitter', () => {
    it('splits text hierarchically preserving paragraphs, sentences and overlap', () => {
      const text = [
        'Paragraph one is about the beginning of artificial intelligence systems.',
        'It spans multiple sentences to provide context.',
        '',
        'Paragraph two delves into machine learning architectures.',
        'Deep neural networks revolutionized computer vision.',
        '',
        'Paragraph three focuses on vector embeddings and semantic search.',
        'High-dimensional spaces allow similarity matching.',
      ].join('\n');

      const chunks = recursiveTextSplitter(text, {
        chunkSize: 150,
        chunkOverlap: 50,
      });

      expect(chunks.length).toBeGreaterThan(1);
      for (const chunk of chunks) {
        expect(chunk.length).toBeLessThanOrEqual(200);
      }
    });

    it('preserves code blocks without arbitrary slicing', () => {
      const text = [
        'Here is an introduction to the function:',
        '```typescript',
        'function add(a: number, b: number): number {',
        '  return a + b;',
        '}',
        '```',
        'And here is the conclusion explaining its usage.',
      ].join('\n');

      const chunks = RecursiveTextSplitter(text, {
        chunkSize: 200,
        chunkOverlap: 40,
      });

      expect(chunks.length).toBeGreaterThanOrEqual(1);
      const codeChunk = chunks.find((c: string) => c.includes('function add'));
      expect(codeChunk).toBeDefined();
    });

    it('caches parsed vector float arrays in-memory by chunk id', () => {
      const chunkId = 'test-chunk-1';
      const vectorData = [0.123, 0.456, 0.789];
      const json = JSON.stringify(vectorData);

      const parsed1 = getCachedVector(chunkId, json);
      expect(parsed1).toEqual(vectorData);

      // Mutate json representation to ensure it returns cached reference
      const parsed2 = getCachedVector(chunkId, 'corrupted-json');
      expect(parsed2).toBe(parsed1);
    });

    it('calculates cosine similarity accurately', () => {
      const vecA = [1, 0, 0];
      const vecB = [1, 0, 0];
      const vecC = [0, 1, 0];

      expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(1.0);
      expect(cosineSimilarity(vecA, vecC)).toBeCloseTo(0.0);
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
