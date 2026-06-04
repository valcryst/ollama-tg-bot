/**
 * Structured assistant output. Only [REPLY] is sent to Telegram.
 * Memory blocks are parsed from the full model output or a dedicated extract pass.
 */
export const REPLY_FORMAT_SPEC = `Reply ONLY using this block (no text outside it):

[REPLY]
1–2 short sentences, Telegram HTML (<b> <i> <code> only).
[/REPLY]

Rules: always include [REPLY]. Do not output [MEMORY], [GROUP_MEMORY], or [GENERAL_MEMORY] in your reply — memory is handled separately.`;

/** Used by the dedicated memory extraction pass. */
export const MEMORY_EXTRACT_FORMAT_SPEC = `Output ONLY [MEMORY], [GROUP_MEMORY], and [GENERAL_MEMORY] blocks as specified.`;

export interface ParsedAssistantResponse {
  memoryFacts: string[];
  groupMemoryFacts: string[];
  generalMemoryFacts: string[];
  reply: string;
}

const MEMORY_BLOCK = /\[MEMORY\]\s*([\s\S]*?)\s*\[\/MEMORY\]/i;
const GROUP_MEMORY_BLOCK = /\[GROUP_MEMORY\]\s*([\s\S]*?)\s*\[\/GROUP_MEMORY\]/i;
const GENERAL_MEMORY_BLOCK =
  /\[GENERAL_MEMORY\]\s*([\s\S]*?)\s*\[\/GENERAL_MEMORY\]/i;
const REPLY_BLOCK = /\[REPLY\]\s*([\s\S]*?)\s*\[\/REPLY\]/i;

function parseMemoryLines(block: string): string[] {
  const trimmed = block.trim();
  if (!trimmed || /^none$/i.test(trimmed)) return [];

  return trimmed
    .split("\n")
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter((line) => line.length > 0 && !/^none$/i.test(line));
}

export function parseStructuredResponse(raw: string): ParsedAssistantResponse {
  const memoryMatch = raw.match(MEMORY_BLOCK);
  const groupMemoryMatch = raw.match(GROUP_MEMORY_BLOCK);
  const generalMemoryMatch = raw.match(GENERAL_MEMORY_BLOCK);
  const replyMatch = raw.match(REPLY_BLOCK);

  const memoryFacts = memoryMatch ? parseMemoryLines(memoryMatch[1]) : [];
  const groupMemoryFacts = groupMemoryMatch
    ? parseMemoryLines(groupMemoryMatch[1])
    : [];
  const generalMemoryFacts = generalMemoryMatch
    ? parseMemoryLines(generalMemoryMatch[1])
    : [];

  let reply = replyMatch?.[1]?.trim() ?? "";
  if (!reply) {
    const partial = raw.match(/\[REPLY\]\s*([\s\S]+)/i);
    reply = partial?.[1]?.replace(/\[\/?REPLY\]/gi, "").trim() ?? "";
  }
  if (!reply) {
    reply = raw
      .replace(MEMORY_BLOCK, "")
      .replace(GROUP_MEMORY_BLOCK, "")
      .replace(GENERAL_MEMORY_BLOCK, "")
      .replace(/\[\/?REPLY\]/gi, "")
      .trim();
  }
  if (!reply) reply = raw.trim();

  return { memoryFacts, groupMemoryFacts, generalMemoryFacts, reply };
}
