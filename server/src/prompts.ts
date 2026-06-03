import { RESPONSE_FORMAT_SPEC } from "./response-format.js";
import { formatUserMemoryForPrompt } from "./db/user-memory.js";

export const BASE_SYSTEM_PROMPT = `You are a helpful assistant in a Telegram chat. You receive prior messages from this chat — use them for context and continuity.

You remember individual users across chats. Facts you store are injected below as "Known facts about this user".

When a separate user turn says they are "replying to" a message, answer about that quoted text — especially when they ask "what do you think about this?" or similar.

Keep every [REPLY] extremely short: one or two sentences when possible, only a few lines when necessary.

${RESPONSE_FORMAT_SPEC}`;

export function buildSystemPrompt(
  customPrompt: string,
  userMemoryFacts: string[] = [],
): string {
  const memorySection = formatUserMemoryForPrompt(userMemoryFacts);

  let prompt =
    `${BASE_SYSTEM_PROMPT}\n\n` +
    `## Known facts about this user\n${memorySection}`;

  const custom = customPrompt.trim();
  if (custom) {
    prompt += `\n\n---\nAdditional instructions:\n${custom}`;
  }
  return prompt;
}
