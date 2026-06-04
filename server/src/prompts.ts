import { REPLY_FORMAT_SPEC } from "./response-format.js";
import { formatGroupMemoryForPrompt } from "./db/group-memory.js";
import { formatUserMemoryForPrompt } from "./db/user-memory.js";

const BASE_SYSTEM_PROMPT_CORE = `You are a helpful assistant in a Telegram chat. You receive prior messages from this chat — use them for context and continuity.

Known facts about the user and (in groups) the group are injected below — use them naturally. A separate step stores new durable facts; you only write the public reply.

When a separate user turn says they are "replying to" a message, answer about that quoted text — especially when they ask "what do you think about this?" or similar.

Keep every [REPLY] extremely short: one or two sentences when possible, only a few lines when necessary.`;

export const BASE_SYSTEM_PROMPT = `${BASE_SYSTEM_PROMPT_CORE}\n\n${REPLY_FORMAT_SPEC}`;

export function buildSystemPrompt(
  customPrompt: string,
  userMemoryFacts: string[] = [],
  options: { isGroupChat?: boolean; groupMemoryFacts?: string[] } = {},
): string {
  const userSection = formatUserMemoryForPrompt(userMemoryFacts);
  const { isGroupChat = false, groupMemoryFacts = [] } = options;

  let prompt =
    `${BASE_SYSTEM_PROMPT_CORE}\n\n## Known facts about this user\n${userSection}`;

  if (isGroupChat) {
    const groupSection = formatGroupMemoryForPrompt(groupMemoryFacts);
    prompt += `\n\n## Known facts about this group\n${groupSection}`;
  }

  const custom = customPrompt.trim();
  if (custom) {
    prompt += `\n\n---\nAdditional instructions:\n${custom}`;
  }

  prompt += `\n\n${REPLY_FORMAT_SPEC}`;
  return prompt;
}
