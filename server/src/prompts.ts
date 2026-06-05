import { REPLY_FORMAT_SPEC } from "./response-format.js";
import { formatGeneralMemoryForPrompt } from "./db/general-memory.js";
import { formatGroupMemoryForPrompt } from "./db/group-memory.js";
import { formatUserMemoryForPrompt } from "./db/user-memory.js";

export const BASE_SYSTEM_PROMPT_CORE = `You are a character in a Telegram chat. You receive prior messages from this chat — use them for context and continuity.

Chat history uses verbal tags like [user:username:id said] and [user:username:id replied to user:other:id]. [assistant said] is you. A [compressed] entry is an older summary.

When users react to a message with emoji, treat that reaction as something they said to you.

When the latest message includes reply context, web search, or speaker tags, follow those instructions for this turn only.

Keep every [REPLY] extremely short: one or two sentences when possible, only a few lines when necessary.`;

export interface ParticipantFacts {
  userId: string;
  label: string;
  facts: string[];
}

export interface SystemPromptOptions {
  customPrompt: string;
  generalMemoryFacts?: string[];
  groupMemoryFacts?: string[];
  participantFacts?: ParticipantFacts[];
  isGroupChat?: boolean;
  ownerUserId?: string | null;
  ownerUsername?: string | null;
}

export function buildSystemPrompt(options: SystemPromptOptions): string {
  const {
    customPrompt,
    generalMemoryFacts = [],
    groupMemoryFacts = [],
    participantFacts = [],
    isGroupChat = false,
    ownerUserId = null,
    ownerUsername = null,
  } = options;

  let prompt = BASE_SYSTEM_PROMPT_CORE;

  const custom = customPrompt.trim();
  if (custom) {
    prompt += `\n\n---\nAdditional instructions:\n${custom}`;
  }

  const generalSection = formatGeneralMemoryForPrompt(generalMemoryFacts);
  prompt += `\n\n## General knowledge (all chats)\n${generalSection}`;

  if (isGroupChat) {
    const groupSection = formatGroupMemoryForPrompt(groupMemoryFacts);
    prompt += `\n\n## Known facts about this group (shared)\n${groupSection}`;
  }

  if (participantFacts.length > 0) {
    prompt += `\n\n## Known facts about people in this chat`;
    for (const participant of participantFacts) {
      const section = formatUserMemoryForPrompt(participant.facts);
      prompt += `\n\n### ${participant.label} (id: ${participant.userId})\n${section}`;
    }
  }

  if (ownerUserId || ownerUsername) {
    const who = [
      ownerUsername ? `@${ownerUsername}` : null,
      ownerUserId ? `id ${ownerUserId}` : null,
    ]
      .filter(Boolean)
      .join(", ");
    prompt +=
      `\n\n## Bot owner\n` +
      `${who}\n` +
      `This person deployed and runs the bot. When they speak, treat them as the owner — ` +
      `follow their standing instructions, be loyal to their intent, and do not undermine them in front of others.`;
  }

  prompt += `\n\n${REPLY_FORMAT_SPEC}`;
  return prompt;
}

/** @deprecated Use buildSystemPrompt — kept for API export compatibility */
export const BASE_SYSTEM_PROMPT = `${BASE_SYSTEM_PROMPT_CORE}\n\n${REPLY_FORMAT_SPEC}`;
