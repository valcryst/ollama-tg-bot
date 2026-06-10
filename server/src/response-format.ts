import { stripEchoedHistoryMarkup } from "./bot/history-format.js";

/** Tag names used in model output protocol (must match prompts and side-pass specs). */
export const REPLY_TAG = "REPLY";
export const MEMORY_TAG = "MEMORY";
export const GROUP_MEMORY_TAG = "GROUP_MEMORY";
export const GENERAL_MEMORY_TAG = "GENERAL_MEMORY";

/**
 * Structured assistant output. Only [REPLY] text is sent to Telegram.
 * Stickers are chosen in a separate model pass; memory blocks come from a dedicated extract pass.
 */
export function buildReplyFormatSpec(formatHint: string): string {
  return `Reply ONLY using this block (no text outside it):

[${REPLY_TAG}]
${formatHint}
[/${REPLY_TAG}]

Rules: always include [${REPLY_TAG}]. Do not output [${MEMORY_TAG}], [${GROUP_MEMORY_TAG}], or [${GENERAL_MEMORY_TAG}] in your reply — memory is handled separately.
Never include internal chat-history tags in [${REPLY_TAG}] (e.g. [assistant said], [user:… said], [sticker: …], [compressed]) — those are metadata, not spoken text.
Formatting: HTML tags are optional — reply in plain text unless a tag genuinely adds emphasis. Never send empty tags (e.g. <b></b>).`;
}

/** Used by the dedicated memory extraction pass. */
export const MEMORY_EXTRACT_FORMAT_SPEC = `Output ONLY [${MEMORY_TAG}], [${GROUP_MEMORY_TAG}], and [${GENERAL_MEMORY_TAG}] blocks as specified.`;

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

/** Extract a closed [TAG]…[/TAG] block only (no partial/unclosed match). */
export function extractClosedBlock(text: string, tag: string): string | null {
  const closed = new RegExp(
    `\\[${escapeRegExp(tag)}\\]\\s*([\\s\\S]*?)\\s*\\[\\/${escapeRegExp(tag)}\\]`,
    "i",
  );
  const match = closed.exec(text);
  return match?.[1]?.trim() ?? null;
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
  const memoryFacts = parseMemoryLines(
    extractClosedBlock(raw, MEMORY_TAG) ?? "",
  );
  const groupMemoryFacts = parseMemoryLines(
    extractClosedBlock(raw, GROUP_MEMORY_TAG) ?? "",
  );
  const generalMemoryFacts = parseMemoryLines(
    extractClosedBlock(raw, GENERAL_MEMORY_TAG) ?? "",
  );

  const reply = extractClosedBlock(raw, REPLY_TAG) ?? "";
  const cleanedReply = stripEchoedHistoryMarkup(stripStructuredMarkup(reply));

  return {
    memoryFacts,
    groupMemoryFacts,
    generalMemoryFacts,
    reply: cleanedReply,
  };
}

/** User-facing reply: only a closed [REPLY]…[/REPLY] block (never the reasoning field). */
export function extractTelegramReply(content: string): string {
  return parseStructuredResponse(content).reply.trim();
}
