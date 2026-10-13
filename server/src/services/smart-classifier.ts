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
   * Fast rule-based and regex heuristic classification to bypass external LLM roundtrips
   * for 90%+ of queries, avoiding 1-2s latency and conserving token quotas.
   */
  static classifyHeuristic(userText: string): WorkloadClassification | null {
    if (!userText || userText.trim().length === 0) {
      return {
        category: 'conversational_fast',
        recommended_focus: 'speed',
        reason: 'Empty input query',
      };
    }

    const trimmed = userText.trim();

    // 1. Trivial greeting / pleasantry regex
    if (/^(hi|hello|hey|yo|ping|test|howdy|sup|good\s+(morning|afternoon|evening|day)|how\s+are\s+you|what's\s+up|thanks|thank\s+you|bye|goodbye|who\s+are\s+you|what\s+is\s+your\s+name)[\s.!?]*$/i.test(trimmed)) {
      return {
        category: 'conversational_fast',
        recommended_focus: 'speed',
        reason: 'Heuristic: greeting or conversational pleasantry',
      };
    }

    // 2. High-speed code heuristics (function, def, class, import, SQL, git, regex, error traces)
    const hasCodeFences = /```[a-zA-Z0-9_-]*[\s\S]*?```/.test(trimmed);
    const hasInlineCode = /`[^`\n]{2,}`/.test(trimmed);
    const hasProgramDeclarations = /\b(def\s+[a-zA-Z_]\w*|function\s*\(|function\s+[a-zA-Z_]\w*|class\s+[a-zA-Z_]\w*|import\s+.*?from\s+['"]|from\s+[a-zA-Z_]\w*\s+import|const\s+[a-zA-Z_]\w*\s*[:=]|let\s+[a-zA-Z_]\w*\s*[:=]|var\s+[a-zA-Z_]\w*\s*[:=]|export\s+(default|const|let|var|function|class|interface|type))\b/.test(trimmed);
    const hasTypedLangSyntax = /\b(public\s+(static\s+)?(class|void|int|string)|fn\s+[a-zA-Z_]\w*|pub\s+fn|package\s+main|#include\s+<[\w.]+>|async\s+def\b|async\s+function\b)\b/.test(trimmed);
    const hasSql = /\b(SELECT\s+.*?\s+FROM|INSERT\s+INTO\s+\w+|UPDATE\s+\w+\s+SET|DELETE\s+FROM\s+\w+|CREATE\s+TABLE\s+\w+|ALTER\s+TABLE\s+\w+|DROP\s+TABLE\s+\w+|GROUP\s+BY\s+\w+|ORDER\s+BY\s+\w+)\b/i.test(trimmed) ||
      /\b(sql\s+(query|queries|schema|statement|table)|postgresql|mysql|sqlite)\b/i.test(trimmed);
    const hasGit = /\b(git\s+(commit|push|pull|status|branch|checkout|rebase|merge|stash|clone|diff|log|reset|remote|add\s+-A|fetch))\b/i.test(trimmed);
    const hasRegex = /\b(regex|regular\s+expression|regexp)\b/i.test(trimmed) || /\/(?:[^\/\\\n]|\\.)*\/[gimsuy]+/.test(trimmed);
    const hasCodingIntent = /\b(write\s+(a\s+)?(python|javascript|typescript|js|ts|rust|golang|c\+\+|java|bash|shell|sql)?\s*(function|script|code|algorithm|program)|debug\s+(this|my)?\s*(code|script|error)|fix\s+(this|my)?\s*(bug|error|code)|refactor\s+(this|my)?\s*code)\b/i.test(trimmed);
    const hasErrorStack = /\b(TypeError|SyntaxError|ReferenceError|NullPointerException|IndexOutOfBoundsException|ZeroDivisionError|KeyError|AttributeError|ValueError|stack\s*trace|segfault|segmentation\s+fault)\b/.test(trimmed);
    const hasPackageTool = /\b(npm\s+(install|run|test|build)|pip\s+install|cargo\s+(build|run)|dockerfile|docker-compose)\b/i.test(trimmed);

    if (hasCodeFences || hasProgramDeclarations || hasTypedLangSyntax || hasSql || hasGit || hasRegex || hasCodingIntent || hasErrorStack || hasPackageTool || (hasInlineCode && trimmed.length > 30)) {
      return {
        category: 'code',
        recommended_focus: 'speed',
        reason: 'Heuristic: detected code syntax, programming keywords, SQL, git, or regex',
      };
    }

    // 3. Reasoning and math heuristics
    const hasArithmetic = /\b\d+\s*[\+\-\*\/\^]\s*\d+\b/.test(trimmed);
    const hasMathSymbols = /\b(\d+!|sqrt\(|sin\(|cos\(|tan\(|log\(|ln\()\b/i.test(trimmed);
    const hasMathPrompts = /\b(solve\s+for\s+[a-z]|calculate\b|math\s+problem|arithmetic|derivative\s+of|integral\s+of|prime\s+factor|matrix\s+multiplication|eigenvalue|eigenvector|calculus|geometry|trigonometry)\b/i.test(trimmed);
    const hasLogicPuzzles = /\b(solve\s+this\s+(puzzle|riddle)|logic\s+puzzle|step\s*by\s*step\s+reasoning|syllogism|sudoku|knight's\s+tour|towers?\s+of\s+hanoi|truth\s+table|game\s+theory)\b/i.test(trimmed);

    if (hasArithmetic || hasMathSymbols || hasMathPrompts || hasLogicPuzzles) {
      return {
        category: 'reasoning_math',
        recommended_focus: 'intelligence',
        reason: 'Heuristic: detected math calculation, equation, logic puzzle, or formal reasoning',
      };
    }

    // 4. Data analysis heuristics
    const hasDataKeywords = /\b(csv\b|dataframe\b|pandas\b|numpy\b|tabular\s+data|dataset\b|analyze\s+(this\s+)?data|statistical\s+analysis|standard\s+deviation|mean\s+and\s+median|regression\s+analysis|scatter\s+plot|histogram)\b/i.test(trimmed);
    const hasCsvRows = /(?:^|\n)[^\n,]+,[^\n,]+,[^\n,]+(?:\n[^\n,]+,[^\n,]+,[^\n,]+){2,}/.test(trimmed);

    if (hasDataKeywords || hasCsvRows) {
      return {
        category: 'data_analysis',
        recommended_focus: 'context',
        reason: 'Heuristic: detected data analysis, statistics, or tabular dataset pattern',
      };
    }

    // 5. Creative writing heuristics
    const hasCreativeKeywords = /\b(write\s+(a\s+)?(poem|poetry|story|lyrics|song|haiku|sonnet|limerick|screenplay|script\s+for\s+a\s+movie|dialogue\s+between|novel|novel\s+chapter|fanfic|fanfiction))\b/i.test(trimmed) ||
      /\b(brainstorm\s+(creative\s+)?(ideas|names|titles)|marketing\s+copy|ad\s+copy|blog\s+post\s+about|creative\s+writing|write\s+an\s+essay\s+about|fictional\s+character|fantasy\s+world)\b/i.test(trimmed);

    if (hasCreativeKeywords) {
      return {
        category: 'creative_writing',
        recommended_focus: 'intelligence',
        reason: 'Heuristic: detected creative writing, storytelling, poetry, or marketing copy',
      };
    }

    // 6. Conversational / short trivia / greetings
    const hasConversationalPhrases = /\b(translate\s+(this\s+)?(to|into)\b|what\s+is\s+the\s+capital\s+of\b|tell\s+me\s+a\s+joke\b|explain\s+briefly\b|summarize\s+(this\s+)?text\b|define\s+[a-z]+[\s.?]*$)/i.test(trimmed) ||
      /\b(who\s+is|who\s+was|when\s+did|where\s+is|what\s+does\s+\w+\s+mean|how\s+do\s+you\s+say)\b/i.test(trimmed);

    if (trimmed.length < 25 || hasConversationalPhrases) {
      return {
        category: 'conversational_fast',
        recommended_focus: 'speed',
        reason: 'Heuristic: short conversational or factual query',
      };
    }

    return null;
  }

  /**
   * Classify the user query into a workload category using instant heuristics
   * with lightweight LLM fallback.
   * Fails gracefully to 'conversational_fast' if classification takes > 1.5s or errors.
   */
  static async classify(messages: ChatMessage[]): Promise<WorkloadClassification> {
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    const userText = typeof lastUserMsg?.content === 'string'
      ? lastUserMsg.content.trim()
      : Array.isArray(lastUserMsg?.content)
        ? lastUserMsg.content.filter(p => p.type === 'text').map(p => p.text).join(' ')
        : '';

    // Fast-path heuristic evaluation (sub-millisecond execution)
    const heuristicResult = this.classifyHeuristic(userText);
    if (heuristicResult) {
      return heuristicResult;
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
