import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WebSearchService } from '../../services/websearch.js';
import type { ChatMessage } from '@freellmapi/shared/types.js';

describe('WebSearchService', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('extractQuery', () => {
    it('extracts query from simple user string message', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'What is the capital of France?' },
      ];
      expect(WebSearchService.extractQuery(messages)).toBe('What is the capital of France?');
    });

    it('extracts query from last user message in multi-turn conversation', () => {
      const messages: ChatMessage[] = [
        { role: 'user', content: 'Hello' },
        { role: 'assistant', content: 'Hi there! How can I help?' },
        { role: 'user', content: 'What is the stock price of Apple today?' },
      ];
      expect(WebSearchService.extractQuery(messages)).toBe('What is the stock price of Apple today?');
    });

    it('extracts query from array content parts', () => {
      const messages: ChatMessage[] = [
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Search for' },
            { type: 'text', text: 'latest SpaceX launch news' },
          ],
        },
      ];
      expect(WebSearchService.extractQuery(messages)).toBe('Search for latest SpaceX launch news');
    });

    it('returns empty string if no user message is present', () => {
      const messages: ChatMessage[] = [
        { role: 'system', content: 'You are a helpful assistant.' },
      ];
      expect(WebSearchService.extractQuery(messages)).toBe('');
    });
  });

  describe('formatResultsToMarkdown', () => {
    it('formats search results into markdown grounded context', () => {
      const results = [
        { title: 'SpaceX News', url: 'https://spacex.com/news', snippet: 'Starship flight 4 succeeded.' },
        { title: 'NASA Updates', url: 'https://nasa.gov/news', snippet: 'Artemis mission timeline.' },
      ];
      const markdown = WebSearchService.formatResultsToMarkdown('SpaceX', results);
      expect(markdown).toContain('[System Web Search Grounding]');
      expect(markdown).toContain('SpaceX News');
      expect(markdown).toContain('https://spacex.com/news');
      expect(markdown).toContain('Starship flight 4 succeeded.');
    });

    it('handles empty search results gracefully', () => {
      const markdown = WebSearchService.formatResultsToMarkdown('Nonexistent Query 12345', []);
      expect(markdown).toContain('No live web search results were found');
    });
  });

  describe('search', () => {
    it('calls Tavily search when TAVILY_API_KEY is configured', async () => {
      process.env.TAVILY_API_KEY = 'test-key-123';

      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          results: [
            { title: 'Tavily Result 1', url: 'https://example.com/1', content: 'Snippet 1' },
          ],
        }),
      });

      global.fetch = mockFetch as any;

      const results = await WebSearchService.search('test query', { maxResults: 1 });

      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.tavily.com/search',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('test-key-123'),
        }),
      );
      expect(results).toHaveLength(1);
      expect(results[0].title).toBe('Tavily Result 1');
    });

    it('falls back to DuckDuckGo if Tavily API throws an error', async () => {
      process.env.TAVILY_API_KEY = 'invalid-key';

      const mockFetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('tavily.com')) {
          throw new Error('Tavily Auth Error');
        }
        return {
          ok: true,
          text: async () => '',
          json: async () => ({
            AbstractText: 'DuckDuckGo Instant Answer',
            AbstractURL: 'https://duckduckgo.com/example',
            Heading: 'DDG Result',
          }),
        };
      });

      global.fetch = mockFetch as any;


      const results = await WebSearchService.search('query with fallback', { maxResults: 1 });

      expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].snippet).toContain('DuckDuckGo Instant Answer');


    });
  });
});
