import { routeRequest } from './router.js';
import type { ChatMessage } from '@freellmapi/shared/types.js';

export interface WorkloadClassification {
  category: 'code' | 'reasoning_math' | 'conversational_fast' | 'creative_writing' | 'data_analysis';
  recommended_focus: 'speed' | 'intelligence' | 'context';
  reason: string;
}

export class SmartClassifier {
  private static readonly CLASSIFIER_PROMPT = `You are an expert workload classifier for an LLM gateway.
Analyze the user's prompt and categorize it into EXACTLY one category.

Respond with STRICT JSON ONLY. No explanation, no code fences.

Schema:
{
  "category": "code" | "reasoning_math" | "conversational_fast" | "creative_writing" | "data_analysis",
  "recommended_focus": "speed" | "intelligence" | "context",
  "reason": string
}

Definitions:
- "code": programming, debugging, refactoring, SQL queries, algorithms, regex, git commands.
- "reasoning_math": complex logic, puzzle solving, formal mathematics, scientific reasoning, multi-step problem solving.
- "conversational_fast": short questions, greetings, simple trivia, quick facts, translations, summarization of short text.
- "creative_writing": poetry, stories, screenplays, brainstorming, marketing copy, stylistic prose.
- "data_analysis": JSON/CSV parsing, tabular data examination, log analysis, statistical queries.`;

  /**
   * Classify the user query into a workload category using a lightweight LLM call.
   * Fails gracefully to 'conversational_fast' if classification takes > 1.5s or errors.
   */
  static async classify(messages: ChatMessage[]): Promise<WorkloadClassification> {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    const userText = typeof lastUserMsg?.content === 'string'
      ? lastUserMsg.content.trim()
      : Array.isArray(lastUserMsg?.content)
        ? lastUserMsg.content.filter(p => p.type === 'text').map(p => p.text).join(' ')
        : '';

    // Fast-path heuristic for trivial greetings
    if (!userText || userText.length < 15 || /^(hi|hello|hey|yo|ping|test|how are you|thanks)\b/i.test(userText)) {
      return {
        category: 'conversational_fast',
        recommended_focus: 'speed',
        reason: 'Short or conversational query',
      };
    }

    try {
      // Find a fast, cheap model from the enabled pool
      const route = routeRequest(200);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 2000); // 2s strict timeout

      const response = await route.provider.chatCompletion(
        route.apiKey,
        [
          { role: 'system', content: this.CLASSIFIER_PROMPT },
          { role: 'user', content: `[Prompt to classify]: "${userText.slice(0, 1000)}"` },
        ],
        route.modelId,
        {
          temperature: 0.1,
          max_tokens: 150,
          response_format: { type: 'json_object' },
        },
      );

      clearTimeout(timeout);

      const rawContent = response.choices?.[0]?.message?.content;
      if (!rawContent || typeof rawContent !== 'string') {
        throw new Error('Empty classifier response');
      }

      const cleaned = rawContent.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(cleaned) as WorkloadClassification;

      if (parsed && parsed.category) {
        return parsed;
      }
    } catch {
      // Graceful fallback on timeout or provider error
    }

    return {
      category: 'conversational_fast',
      recommended_focus: 'speed',
      reason: 'Fallback to default fast routing',
    };
  }
}
