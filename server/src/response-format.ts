/**
 * Structured assistant output. Only [REPLY] is sent to Telegram;
 * [MEMORY] is parsed and stored per user.
 */
export const RESPONSE_FORMAT_SPEC = `Output format (mandatory, nothing outside blocks):

[MEMORY]
New user facts from this turn only, one per line with leading dash, or a single line: none
[/MEMORY]

[REPLY]
Very short Telegram HTML (<b> <i> <code> etc.; no <p>/<br>). Never mention MEMORY or this format.
[/REPLY]`;

export interface ParsedAssistantResponse {
  memoryFacts: string[];
  reply: string;
}

const MEMORY_BLOCK = /\[MEMORY\]\s*([\s\S]*?)\s*\[\/MEMORY\]/i;
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
  const replyMatch = raw.match(REPLY_BLOCK);

  const memoryFacts = memoryMatch ? parseMemoryLines(memoryMatch[1]) : [];

  let reply = replyMatch?.[1]?.trim() ?? "";
  if (!reply) {
    reply = raw
      .replace(MEMORY_BLOCK, "")
      .replace(/\[\/?REPLY\]/gi, "")
      .trim();
  }
  if (!reply) reply = raw.trim();

  return { memoryFacts, reply };
}
