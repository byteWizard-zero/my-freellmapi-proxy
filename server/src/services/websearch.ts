import type { WebSearchResult, ChatMessage } from '@freellmapi/shared/types.js';

export interface WebSearchOptions {
  maxResults?: number;
  timeoutMs?: number;
}

export class WebSearchService {
  /**
   * Extract search query from conversation history (focusing on latest user message).
   */
  static extractQuery(messages: ChatMessage[]): string {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.role === 'user') {
        if (typeof msg.content === 'string') {
          return msg.content.trim();
        } else if (Array.isArray(msg.content)) {
          const textParts = msg.content
            .filter((p: any) => p.type === 'text' && typeof p.text === 'string')
            .map((p: any) => p.text);
          if (textParts.length > 0) return textParts.join(' ').trim();
        }
      }
    }
    return '';
  }

  /**
   * Search web via Tavily API (if configured) or DuckDuckGo fallback.
   */
  static async search(query: string, options: WebSearchOptions = {}): Promise<WebSearchResult[]> {
    if (!query) return [];

    const maxResults = options.maxResults ?? 5;
    const timeoutMs = options.timeoutMs ?? 7000;

    const tavilyKey = process.env.TAVILY_API_KEY;
    if (tavilyKey && tavilyKey.trim().length > 0) {
      try {
        const results = await this.searchTavily(query, tavilyKey, maxResults, timeoutMs);
        if (results.length > 0) return results;
      } catch (err: any) {
        console.warn(`[WebSearch] Tavily search failed (${err.message}), falling back to DuckDuckGo...`);
      }
    }

    try {
      return await this.searchDuckDuckGo(query, maxResults, timeoutMs);
    } catch (err: any) {
      console.error(`[WebSearch] DuckDuckGo search failed (${err.message}). Returning empty results.`);
      return [];
    }
  }

  /**
   * Search Tavily API
   */
  private static async searchTavily(
    query: string,
    apiKey: string,
    maxResults: number,
    timeoutMs: number,
  ): Promise<WebSearchResult[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_key: apiKey,
          query,
          max_results: maxResults,
          search_depth: 'basic',
          include_answer: false,
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const data = (await res.json()) as any;
      if (!Array.isArray(data.results)) return [];

      return data.results.slice(0, maxResults).map((r: any) => ({
        title: String(r.title || 'Untitled'),
        url: String(r.url || '#'),
        snippet: String(r.content || r.snippet || ''),
      }));
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Search DuckDuckGo (zero-config fallback)
   */
  private static async searchDuckDuckGo(
    query: string,
    maxResults: number,
    timeoutMs: number,
  ): Promise<WebSearchResult[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      // 1. Try DuckDuckGo HTML search endpoint
      const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        signal: controller.signal,
      });

      if (res.ok) {
        const html = await res.text();
        const results = this.parseDuckDuckGoHtml(html, maxResults);
        if (results.length > 0) return results;
      }
    } catch {
      // Fallthrough to Instant API
    } finally {
      clearTimeout(timeout);
    }

    // 2. Fallback to DuckDuckGo Instant Answer API
    const controller2 = new AbortController();
    const timeout2 = setTimeout(() => controller2.abort(), timeoutMs);
    try {
      const instantUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
      const res = await fetch(instantUrl, { signal: controller2.signal });
      if (res.ok) {
        const data = (await res.json()) as any;
        const results: WebSearchResult[] = [];

        if (data.AbstractText && data.AbstractURL) {
          results.push({
            title: data.Heading || query,
            url: data.AbstractURL,
            snippet: data.AbstractText,
          });
        }

        if (Array.isArray(data.RelatedTopics)) {
          for (const topic of data.RelatedTopics) {
            if (topic.Text && topic.FirstURL && results.length < maxResults) {
              results.push({
                title: topic.Text.split(' - ')[0] || topic.Text,
                url: topic.FirstURL,
                snippet: topic.Text,
              });
            }
          }
        }

        return results;
      }
    } catch {
      // ignore
    } finally {
      clearTimeout(timeout2);
    }

    return [];
  }

  /**
   * Simple HTML regex parser for DuckDuckGo HTML results page
   */
  private static parseDuckDuckGoHtml(html: string, maxResults: number): WebSearchResult[] {
    const results: WebSearchResult[] = [];
    // Match result blocks in HTML output
    const regex = /<a [^>]*class="result__url"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a [^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    
    // Alternative parsing strategy: look for result__title and result__snippet
    const titleRegex = /<a [^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
    const snippetRegex = /<a [^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;

    const titles: Array<{ url: string; title: string }> = [];
    let match: RegExpExecArray | null;

    while ((match = titleRegex.exec(html)) !== null && titles.length < maxResults * 2) {
      let rawUrl = match[1];
      // Unpack DDG redirect url if needed
      const udMatch = rawUrl.match(/uddg=([^&]+)/);
      if (udMatch) {
        try {
          rawUrl = decodeURIComponent(udMatch[1]);
        } catch {
          // ignore
        }
      }
      const titleText = match[2].replace(/<[^>]+>/g, '').trim();
      if (titleText && rawUrl.startsWith('http')) {
        titles.push({ url: rawUrl, title: titleText });
      }
    }

    const snippets: string[] = [];
    while ((match = snippetRegex.exec(html)) !== null && snippets.length < maxResults * 2) {
      const snipText = match[1].replace(/<[^>]+>/g, '').trim();
      snippets.push(snipText);
    }

    for (let i = 0; i < Math.min(titles.length, maxResults); i++) {
      results.push({
        title: titles[i].title,
        url: titles[i].url,
        snippet: snippets[i] || titles[i].title,
      });
    }

    return results;
  }

  /**
   * Format search results into markdown context block for prompt injection.
   */
  static formatResultsToMarkdown(query: string, results: WebSearchResult[]): string {
    if (!results || results.length === 0) {
      return `[System Web Search Grounding]
No live web search results were found for query: "${query}". Please answer using existing knowledge and mention that web search returned no results.`;
    }

    const items = results.map((r, idx) => {
      return `${idx + 1}. **${r.title}**\n   URL: ${r.url}\n   Snippet: ${r.snippet}`;
    }).join('\n\n');

    return `[System Web Search Grounding]
The user requested real-time web search. The following fresh web results were retrieved for query: "${query}"

${items}

Instructions for Assistant:
- Incorporate up-to-date details from the search results above.
- Cite sources using markdown links [Source Title](URL) when referencing specific facts.
- Provide a helpful, direct, and well-structured answer.`;
  }
}
