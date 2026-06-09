import { sanitizeModelOutput } from "./ollama/sanitize.js";

/**
 * Structured assistant output. Only [REPLY] text is sent to Telegram.
 * Stickers are chosen in a separate model pass; memory blocks come from a dedicated extract pass.
 */
export function buildReplyFormatSpec(formatHint: string): string {
  return `Reply ONLY using this block (no text outside it):

[REPLY]
${formatHint}
[/REPLY]

Rules: always include [REPLY]. Do not output [MEMORY], [GROUP_MEMORY], or [GENERAL_MEMORY] in your reply — memory is handled separately.
Formatting: HTML tags are optional — reply in plain text unless a tag genuinely adds emphasis. Never send empty tags (e.g. <b></b>).`;
}

/** Used by the dedicated memory extraction pass. */
export const MEMORY_EXTRACT_FORMAT_SPEC = `Output ONLY [MEMORY], [GROUP_MEMORY], and [GENERAL_MEMORY] blocks as specified.`;

export interface ParsedAssistantResponse {
  memoryFacts: string[];
  groupMemoryFacts: string[];
  generalMemoryFacts: string[];
  reply: string;
}

const BLOCK_NAME = "[A-Za-z_][A-Za-z0-9_]*";
const CLOSED_BLOCK = new RegExp(
  `\\[(${BLOCK_NAME})\\]\\s*[\\s\\S]*?\\s*\\[\\/\\1\\]`,
  "gi",
);
const UNCLOSED_BLOCK = new RegExp(
  `\\[(${BLOCK_NAME})\\][\\s\\S]*$`,
);
const STRAY_BLOCK_TAG = new RegExp(`\\[\\/?(${BLOCK_NAME})\\]`, "g");

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Remove any [TAG]…[/TAG] blocks and stray [TAG] tags from user-facing text. */
export function stripStructuredMarkup(text: string): string {
  let result = text;
  let prev = "";
  while (result !== prev) {
    prev = result;
    result = result
      .replace(CLOSED_BLOCK, "")
      .replace(UNCLOSED_BLOCK, "")
      .replace(STRAY_BLOCK_TAG, "");
  }
  return result.trim();
}

function extractFirstBlock(text: string, tag: string): string | null {
  const closed = new RegExp(
    `\\[${escapeRegExp(tag)}\\]\\s*([\\s\\S]*?)\\s*\\[\\/${escapeRegExp(tag)}\\]`,
    "i",
  );
  const match = closed.exec(text);
  if (match?.[1]) return match[1].trim();

  const partial = new RegExp(
    `\\[${escapeRegExp(tag)}\\]\\s*([\\s\\S]+)`,
    "i",
  );
  const partialMatch = partial.exec(text);
  if (!partialMatch?.[1]) return null;

  return stripStructuredMarkup(
    partialMatch[1].replace(
      new RegExp(`\\[\\/?${escapeRegExp(tag)}\\]`, "gi"),
      "",
    ),
  );
}

function parseMemoryLines(block: string): string[] {
  const trimmed = block.trim();
  if (!trimmed || /^none$/i.test(trimmed)) return [];

  return trimmed
    .split("\n")
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter((line) => line.length > 0 && !/^none$/i.test(line));
}

export function parseStructuredResponse(raw: string): ParsedAssistantResponse {
  const memoryFacts = parseMemoryLines(extractFirstBlock(raw, "MEMORY") ?? "");
  const groupMemoryFacts = parseMemoryLines(
    extractFirstBlock(raw, "GROUP_MEMORY") ?? "",
  );
  const generalMemoryFacts = parseMemoryLines(
    extractFirstBlock(raw, "GENERAL_MEMORY") ?? "",
  );

  let reply = extractFirstBlock(raw, "REPLY") ?? "";
  if (!reply) {
    const closed = raw.match(/\[REPLY\]\s*([\s\S]*?)\s*\[\/REPLY\]/i);
    if (closed?.[1]) reply = closed[1].trim();
  }
  if (!reply) {
    const partial = raw.match(/\[REPLY\]\s*([\s\S]+)/i);
    reply = partial?.[1] ? stripStructuredMarkup(partial[1]) : "";
  }

  reply = stripStructuredMarkup(reply);

  return {
    memoryFacts,
    groupMemoryFacts,
    generalMemoryFacts,
    reply,
  };
}

function stripEmbeddedThinkingTrace(text: string): string {
  return text
    .replace(/`?<think>[\s\S]*?<\/think>`?/gi, "")
    .replace(/`?<think>[\s\S]*$/gi, "")
    .trim();
}

/** User-facing reply text from Ollama message.content (never the thinking field). */
export function extractTelegramReply(
  content: string,
  options?: { thinkingMode?: boolean },
): string {
  const cleaned = stripEmbeddedThinkingTrace(content);
  const { reply } = parseStructuredResponse(cleaned);
  if (reply.trim()) return reply.trim();

  if (options?.thinkingMode) {
    return sanitizeModelOutput(cleaned);
  }

  const legacy = stripStructuredMarkup(cleaned);
  if (legacy) return legacy;
  return sanitizeModelOutput(cleaned);
}
