import { buildReplyFormatSpec } from "./response-format.js";
import type { Settings } from "./db/database.js";
import { formatGeneralMemoryForPrompt } from "./db/general-memory.js";
import { formatGroupMemoryForPrompt } from "./db/group-memory.js";
import {
  formatKnownUserLabel,
  type KnownUserRecord,
} from "./db/known-users.js";
import { formatUserMemoryForPrompt } from "./db/user-memory.js";
import { getReplyLengthGuidance } from "./settings-limits.js";
import { userRoleTagFromKnown } from "./bot/history-format.js";

export const BASE_SYSTEM_PROMPT_CORE = `You are a character in a Telegram chat. You receive prior messages from this chat — use them for context and continuity.

Chat history uses verbal tags like [user:username:id said] and [user:username:id replied to user:other:id]. [assistant said] is you. A [compressed] entry is an older summary.

When users react to a message with emoji, treat that reaction as something they said to you.

When the latest message includes [MENTIONED USERS], reply context, web search, or speaker tags, follow those instructions for this turn only.

When [MENTIONED USERS] is present and the speaker asks who someone is, answer using that identity and any listed facts — do not refuse or claim you lack a directory.`;

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
  knownChatUsers?: KnownUserRecord[];
  isGroupChat?: boolean;
  ownerUserId?: string | null;
  ownerUsername?: string | null;
}

export function buildBaseSystemPrompt(settings: Settings): string {
  const { systemHint, formatHint } = getReplyLengthGuidance(settings);
  return `${BASE_SYSTEM_PROMPT_CORE}\n\n${systemHint}\n\n${buildReplyFormatSpec(formatHint)}`;
}

export interface ExplainPromptOptions {
  settings: Settings;
  activePersonalityName: string | null;
  activePersonalityPrompt: string | null;
  generalMemoryFacts: string[];
  groupMemoryFacts: string[];
  userMemoryFacts: string[];
  isGroupChat: boolean;
}

export function buildExplainSystemPrompt(options: ExplainPromptOptions): string {
  const {
    settings,
    activePersonalityName,
    activePersonalityPrompt,
    generalMemoryFacts,
    groupMemoryFacts,
    userMemoryFacts,
    isGroupChat,
  } = options;

  const { formatHint } = getReplyLengthGuidance(settings);
  const baseSystemPrompt = buildBaseSystemPrompt(settings);

  let activeSection: string;
  if (activePersonalityName && activePersonalityPrompt?.trim()) {
    activeSection =
      `Name: ${activePersonalityName}\n` +
      `Custom instructions:\n${activePersonalityPrompt.trim()}`;
  } else if (activePersonalityName) {
    activeSection =
      `Name: ${activePersonalityName}\n` +
      `(no custom instructions — base prompt only)`;
  } else {
    activeSection = "None — only the base system prompt is applied.";
  }

  const groupSection = isGroupChat
    ? formatGroupMemoryForPrompt(groupMemoryFacts)
    : "Not applicable (private chat).";

  return (
    `You are a meta assistant for a Telegram Ollama bot. The user asks why the bot would behave or reply a certain way.\n\n` +
    `Rules:\n` +
    `- Do NOT roleplay. Do NOT speak as the bot's character.\n` +
    `- Give a direct, honest explanation grounded in the configuration below.\n` +
    `- Cite specific sources: active personality, base prompt, general/group/user memories, or recent chat history.\n` +
    `- Quote or paraphrase the exact instruction or memory when it explains the behavior.\n` +
    `- If nothing in the configuration explains it, say so plainly.\n\n` +
    `## What drives normal (in-character) replies\n\n` +
    `### Active personality\n${activeSection}\n\n` +
    `### Base system prompt (always applied)\n${baseSystemPrompt}\n\n` +
    `### General memories (all chats)\n${formatGeneralMemoryForPrompt(generalMemoryFacts)}\n\n` +
    `### Group memories\n${groupSection}\n\n` +
    `### Memories about the asking user\n${formatUserMemoryForPrompt(userMemoryFacts)}\n\n` +
    buildReplyFormatSpec(formatHint)
  );
}

export function buildSystemPrompt(options: SystemPromptOptions): string {
  const {
    settings,
    customPrompt,
    generalMemoryFacts = [],
    groupMemoryFacts = [],
    participantFacts = [],
    knownChatUsers = [],
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

  if (knownChatUsers.length > 0) {
    prompt +=
      `\n\n## Known Telegram users in this chat\n` +
      `When a message mentions their @username or name, it refers to this person:\n`;
    for (const known of knownChatUsers) {
      prompt += `\n- ${formatKnownUserLabel(known)} — tag ${userRoleTagFromKnown(known)}`;
    }
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
