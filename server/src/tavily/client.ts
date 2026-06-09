import { config } from "../config.js";

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
}

export interface TavilySource {
  title: string;
  url: string;
}

interface TavilySearchResponse {
  query?: string;
  answer?: string;
  results?: Array<{
    title?: string;
    url?: string;
    content?: string;
  }>;
}

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";
const SEARCH_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RESULTS = 5;

export function isTavilyConfigured(): boolean {
  return config.tavilyApiKey.length > 0;
}

export async function tavilySearch(
  query: string,
  options?: { maxResults?: number },
): Promise<{ results: TavilyResult[]; answer: string | null }> {
  const apiKey = config.tavilyApiKey;
  if (!apiKey) {
    throw new Error("TAVILY_API_KEY is not configured");
  }

  const maxResults = options?.maxResults ?? DEFAULT_MAX_RESULTS;

  const res = await fetch(TAVILY_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
    body: JSON.stringify({
      query: query.trim(),
      search_depth: "basic",
      max_results: maxResults,
      include_answer: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Tavily returned ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as TavilySearchResponse;
  const results: TavilyResult[] = [];

  for (const row of data.results ?? []) {
    const title = row.title?.trim() ?? "";
    const url = row.url?.trim() ?? "";
    const content = row.content?.trim() ?? "";
    if (!title && !url && !content) continue;
    results.push({
      title: title || url || "Result",
      url,
      content,
    });
  }

  const answer = data.answer?.trim() || null;
  return { results, answer };
}

export function formatTavilyContext(
  query: string,
  payload: { results: TavilyResult[]; answer: string | null },
): string {
  const parts: string[] = [`Web search for "${query}" (Tavily):`];

  if (payload.answer) {
    parts.push(`\nSummary:\n${payload.answer}`);
  }

  if (payload.results.length > 0) {
    const lines = payload.results.map((r, i) => {
      const snippet = r.content ? `\n${r.content}` : "";
      const link = r.url ? `\nSource: ${r.url}` : "";
      return `${i + 1}. ${r.title}${link}${snippet}`;
    });
    parts.push(`\nSources:\n${lines.join("\n\n")}`);
  }

  if (!payload.answer && payload.results.length === 0) {
    return (
      `Web search was run for "${query}" but Tavily returned no results.\n` +
      `Answer from general knowledge and say if you are unsure about current facts.`
    );
  }

  parts.push(
    "\nUse the summary and sources above in your reply. " +
      "Do not tell the user to search themselves or that you cannot access the web. " +
      "Do not add a sources list yourself; the bot will append it automatically.",
  );

  return parts.join("\n");
}

export function tavilySources(
  payload: { results: TavilyResult[] },
): TavilySource[] {
  const sources: TavilySource[] = [];
  const seen = new Set<string>();

  for (const result of payload.results) {
    const url = result.url.trim();
    if (!url || seen.has(url)) continue;
    seen.add(url);
    sources.push({
      title: result.title.trim() || url,
      url,
    });
  }

  return sources;
}

export function formatTavilyFailure(query: string, err: unknown): string {
  const detail = err instanceof Error ? err.message : String(err);
  return (
    `Web search was attempted for "${query}" but failed: ${detail}\n\n` +
    `Tell the user live lookup failed. Do not pretend you searched successfully.`
  );
}

/** Lightweight check that the API key works (uses one search credit). */
export async function checkTavilyHealth(): Promise<boolean> {
  if (!isTavilyConfigured()) return false;
  await tavilySearch("test", { maxResults: 1 });
  return true;
}
