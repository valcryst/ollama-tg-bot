import { REPLY_FORMAT_SPEC } from "./response-format.js";
import { formatGeneralMemoryForPrompt } from "./db/general-memory.js";
import { formatGroupMemoryForPrompt } from "./db/group-memory.js";
import { formatUserMemoryForPrompt } from "./db/user-memory.js";

const BASE_SYSTEM_PROMPT_CORE = `You are a helpful assistant in a Telegram chat. You receive prior messages from this chat — use them for context and continuity.

When users send stickers, each sticker has an associated emoji from its pack — treat that emoji as part of their message (reaction, tone, or meaning), not just decoration.

When users react to a message with emoji, treat that reaction as something they said to you — respond to the feeling or intent behind it, especially when they react to your messages.

Known facts (general, user, and in groups the group) are injected below — use them naturally. A separate step stores new durable facts; you only write the public reply.

When a separate user turn says they are "replying to" a message, answer about that quoted text — especially when they ask "what do you think about this?" or similar.

Keep every [REPLY] extremely short: one or two sentences when possible, only a few lines when necessary.`;

const GROUP_SYSTEM_ADDENDUM = `This is a GROUP chat with multiple people.

- You are replying to ONE person right now. Their name and id are marked in the current message as [CURRENT SPEAKER].
- Chat history shown to you is only your prior exchanges with THAT same person in this group — not other members.
- Facts under "this person" apply to the current speaker only. Group facts are about the chat in general.
- Never attribute another member's messages, preferences, or name to the person you are answering now.
- If the current speaker refers to someone else, use only what is in this thread or group facts — do not invent.`;

export const BASE_SYSTEM_PROMPT = `${BASE_SYSTEM_PROMPT_CORE}\n\n${REPLY_FORMAT_SPEC}`;

export function buildSystemPrompt(
  customPrompt: string,
  userMemoryFacts: string[] = [],
  options: {
    isGroupChat?: boolean;
    groupMemoryFacts?: string[];
    generalMemoryFacts?: string[];
    currentSpeaker?: { label: string; userId: string } | null;
  } = {},
): string {
  const userSection = formatUserMemoryForPrompt(userMemoryFacts);
  const {
    isGroupChat = false,
    groupMemoryFacts = [],
    generalMemoryFacts = [],
    currentSpeaker,
  } = options;

  let prompt = BASE_SYSTEM_PROMPT_CORE;
  if (isGroupChat) prompt += `\n\n${GROUP_SYSTEM_ADDENDUM}`;

  const generalSection = formatGeneralMemoryForPrompt(generalMemoryFacts);
  prompt += `\n\n## General knowledge (all chats)\n${generalSection}`;

  const userHeading = isGroupChat
    ? "## Known facts about the person you are replying to now"
    : "## Known facts about this user";
  prompt += `\n\n${userHeading}\n${userSection}`;

  if (isGroupChat && currentSpeaker) {
    prompt +=
      `\n\n## Current speaker (reply to them only)\n` +
      `${currentSpeaker.label} (id: ${currentSpeaker.userId})`;
  }

  if (isGroupChat) {
    const groupSection = formatGroupMemoryForPrompt(groupMemoryFacts);
    prompt += `\n\n## Known facts about this group (shared)\n${groupSection}`;
  }

  const custom = customPrompt.trim();
  if (custom) {
    prompt += `\n\n---\nAdditional instructions:\n${custom}`;
  }

  prompt += `\n\n${REPLY_FORMAT_SPEC}`;
  return prompt;
}
