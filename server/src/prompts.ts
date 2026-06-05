import { buildReplyFormatSpec } from "./response-format.js";
import type { Settings } from "./db/database.js";
import { formatGeneralMemoryForPrompt } from "./db/general-memory.js";
import { formatGroupMemoryForPrompt } from "./db/group-memory.js";
import { formatUserMemoryForPrompt } from "./db/user-memory.js";
import { getReplyLengthGuidance } from "./settings-limits.js";

export const BASE_SYSTEM_PROMPT_CORE = `You are a character in a Telegram chat. You receive prior messages from this chat — use them for context and continuity.

Chat history uses verbal tags like [user:username:id said] and [user:username:id replied to user:other:id]. [assistant said] is you. A [compressed] entry is an older summary.

When users react to a message with emoji, treat that reaction as something they said to you.

When the latest message includes reply context, web search, or speaker tags, follow those instructions for this turn only.`;

export interface ParticipantFacts {
  userId: string;
  label: string;
  facts: string[];
}

export interface SystemPromptOptions {
  settings: Settings;
  customPrompt: string;
  generalMemoryFacts?: string[];
  groupMemoryFacts?: string[];
  participantFacts?: ParticipantFacts[];
  isGroupChat?: boolean;
  ownerUserId?: string | null;
  ownerUsername?: string | null;
}

export function buildBaseSystemPrompt(settings: Settings): string {
  const { systemHint, formatHint } = getReplyLengthGuidance(settings);
  return `${BASE_SYSTEM_PROMPT_CORE}\n\n${systemHint}\n\n${buildReplyFormatSpec(formatHint)}`;
}

export function buildSystemPrompt(options: SystemPromptOptions): string {
  const {
    settings,
    customPrompt,
    generalMemoryFacts = [],
    groupMemoryFacts = [],
    participantFacts = [],
    isGroupChat = false,
    ownerUserId = null,
    ownerUsername = null,
  } = options;

  const { systemHint, formatHint } = getReplyLengthGuidance(settings);
  let prompt = `${BASE_SYSTEM_PROMPT_CORE}\n\n${systemHint}`;

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

  prompt += `\n\n${buildReplyFormatSpec(formatHint)}`;
  return prompt;
}
