import { chatComplete } from "../ollama/client.js";
import type { ChatMessage } from "../ollama/client.js";
import { isTavilyConfigured } from "../tavily/client.js";

const SEARCH_CHECK_NUM_PREDICT = 192;

const SEARCH_ANALYZER_SYSTEM = `You decide whether a Telegram bot should run a web search (Tavily) before answering.

Output ONLY:

[SEARCH]
no
[/SEARCH]

or

[SEARCH]
yes
[/SEARCH]
[QUERY]
concise search query
[/QUERY]

Say yes when the user needs information that is likely:
- Current (news, prices, weather, releases, "today", recent events)
- Specific factual lookup (who is X now, when did Y happen, statistics, laws)
- About a product, company, person, or place you would not reliably know from training alone

Say no when:
- Casual chat, opinions, creativity, jokes, roleplay
- Explaining general concepts that do not need up-to-date data
- Discussing the attached image/sticker only
- The answer is clearly in the message or quoted reply alone
- Memory/personal context questions with no need for the open web

When yes, [QUERY] must be a short search-engine query (few keywords), in the user's language when obvious.`;

const SEARCH_BLOCK = /\[SEARCH\]\s*([\s\S]*?)\s*\[\/SEARCH\]/i;
const QUERY_BLOCK = /\[QUERY\]\s*([\s\S]*?)\s*\[\/QUERY\]/i;

export interface SearchDecision {
  needsSearch: boolean;
  query: string | null;
}

function parseSearchDecision(raw: string): SearchDecision {
  const searchMatch = raw.match(SEARCH_BLOCK);
  let searchValue = (searchMatch?.[1] ?? "").trim().toLowerCase();

  if (!searchMatch) {
    if (/\[SEARCH\]\s*yes\b/i.test(raw) || /\bsearch:\s*yes\b/i.test(raw)) {
      searchValue = "yes";
    }
  }

  if (!searchValue) searchValue = raw.trim().toLowerCase();

  const needsSearch =
    /^y(es)?\b/.test(searchValue) ||
    searchValue === "y" ||
    (/^search\b/.test(searchValue) && !/^no\b/.test(searchValue));

  if (!needsSearch) return { needsSearch: false, query: null };

  const queryMatch = raw.match(QUERY_BLOCK);
  let query = queryMatch?.[1]?.trim() ?? "";
  if (!query) {
    const lineAfterYes = raw.match(/\[SEARCH\]\s*yes[^\n]*\n+([^\n\[]+)/i);
    query = lineAfterYes?.[1]?.trim() ?? "";
  }
  if (!query) return { needsSearch: false, query: null };

  return { needsSearch: true, query };
}

export interface SearchAnalyzeInput {
  userMessage: string;
  replyContext?: string | null;
}

/**
 * Ask the model whether Tavily web search should run before the main reply.
 */
export async function analyzeSearchNeed(
  input: SearchAnalyzeInput,
): Promise<SearchDecision> {
  if (!isTavilyConfigured()) {
    return { needsSearch: false, query: null };
  }

  const userText = input.userMessage.trim();
  if (!userText) return { needsSearch: false, query: null };

  let content = `User message:\n${userText}`;
  if (input.replyContext?.trim()) {
    content += `\n\nQuoted reply context:\n${input.replyContext.trim()}`;
  }

  const messages: ChatMessage[] = [
    { role: "system", content: SEARCH_ANALYZER_SYSTEM },
    { role: "user", content },
  ];

  try {
    const raw = await chatComplete(messages, {
      numPredict: SEARCH_CHECK_NUM_PREDICT,
    });
    const decision = parseSearchDecision(raw);
    if (decision.needsSearch && decision.query) {
      console.log(`Search analyzer (model): "${decision.query}"`);
      return decision;
    }

    console.log(
      `Search analyzer (model): no — ${raw.replace(/\s+/g, " ").slice(0, 80)}`,
    );
    return { needsSearch: false, query: null };
  } catch (err) {
    console.error("Search analyzer failed:", err);
    return { needsSearch: false, query: null };
  }
}
