import type { Context } from "grammy";
import type { ChatMessage } from "../ollama/client.js";
import {
  appendAssistantMessage,
  appendMessage,
  conversationKey,
  getHistory,
  historyToChatMessages,
} from "../db/history.js";
import { getUserFacts } from "../db/user-memory.js";
import { scheduleHistoryCompression } from "../context-compress.js";
import { logEvent } from "../event-log.js";
import { buildSystemPrompt, type ParticipantFacts } from "../prompts.js";
import {
  extractParticipantUserIds,
  userRoleTag,
} from "./history-format.js";
import { currentSpeakerFromUser, type CurrentSpeaker } from "./speaker.js";

export type { CurrentSpeaker } from "./speaker.js";

export function resolveConversationKey(ctx: Context): string | null {
  const chatId = ctx.chat?.id;
  if (chatId == null) return null;
  const threadId = ctx.message?.message_thread_id;
  return conversationKey(chatId, { threadId });
}

export interface LatestTurnOptions {
  body: string;
  speakerTag?: string | null;
  replyContext?: string | null;
  webSearchContext?: string | null;
  currentSpeaker?: CurrentSpeaker | null;
  currentSpeakerIsOwner?: boolean;
  isGroupChat?: boolean;
}

function buildLatestTurnMessage(options: LatestTurnOptions): string {
  const parts: string[] = [];

  if (options.isGroupChat && options.currentSpeaker) {
    const ownerLine = options.currentSpeakerIsOwner
      ? "They are the bot owner — prioritize their intent.\n"
      : "";
    parts.push(
      `[CURRENT SPEAKER — reply to this person only]\n` +
        `Name: ${options.currentSpeaker.label}\n` +
        `Tag: ${options.speakerTag ?? options.currentSpeaker.userId}\n` +
        ownerLine,
    );
  }

  if (options.replyContext?.trim()) {
    parts.push(
      `[REPLY CONTEXT]\n${options.replyContext.trim()}`,
    );
  }

  if (options.webSearchContext?.trim()) {
    parts.push(
      `[WEB SEARCH — answer from this for your reply]\n${options.webSearchContext.trim()}`,
    );
  }

  parts.push(options.body.trim());
  return parts.filter(Boolean).join("\n\n");
}

function loadParticipantFacts(
  chatKey: string,
  currentUserId: string | null,
): ParticipantFacts[] {
  const history = getHistory(chatKey);
  const roles = history.map((m) => m.role);
  const participantIds = extractParticipantUserIds(
    roles,
    currentUserId ? [currentUserId] : [],
  );

  return participantIds.map((userId) => ({
    userId,
    label: `User ${userId}`,
    facts: getUserFacts(userId),
  }));
}

export function buildChatMessages(
  customSystemPrompt: string,
  chatKey: string,
  latestTurn: LatestTurnOptions,
  options: {
    isGroupChat?: boolean;
    groupMemoryFacts?: string[];
    generalMemoryFacts?: string[];
    currentUserId?: string | null;
    ownerUserId?: string | null;
    ownerUsername?: string | null;
  } = {},
): ChatMessage[] {
  const {
    isGroupChat = false,
    groupMemoryFacts = [],
    generalMemoryFacts = [],
    currentUserId = null,
    ownerUserId = null,
    ownerUsername = null,
  } = options;

  const participantFacts = loadParticipantFacts(chatKey, currentUserId);
  for (const p of participantFacts) {
    const fromHistory = getHistory(chatKey).find(
      (m) => m.role.endsWith(`:${p.userId}`),
    );
    if (fromHistory) {
      const tag = fromHistory.role;
      p.label = tag.startsWith("user:") ? tag : p.label;
    }
    if (
      latestTurn.currentSpeaker &&
      latestTurn.currentSpeaker.userId === p.userId
    ) {
      p.label = latestTurn.currentSpeaker.label;
    }
  }

  const system = buildSystemPrompt({
    customPrompt: customSystemPrompt,
    generalMemoryFacts,
    groupMemoryFacts,
    participantFacts,
    isGroupChat,
    ownerUserId,
    ownerUsername,
  });

  const history = historyToChatMessages(getHistory(chatKey));
  const latest = buildLatestTurnMessage({
    ...latestTurn,
    isGroupChat,
    speakerTag: latestTurn.speakerTag ?? null,
  });

  return [
    { role: "system", content: system },
    ...history,
    { role: "user", content: latest },
  ];
}

export function resolveUserId(ctx: Context): string | null {
  const id = ctx.from?.id;
  return id != null ? String(id) : null;
}

export function resolveGroupChatId(ctx: Context): string | null {
  const chat = ctx.chat;
  if (!chat || (chat.type !== "group" && chat.type !== "supergroup")) {
    return null;
  }
  return String(chat.id);
}

export function isGroupChat(ctx: Context): boolean {
  return resolveGroupChatId(ctx) != null;
}

export function recordExchange(
  chatKey: string,
  userRole: string | null,
  userContent: string | null,
  assistantText: string,
  options?: { skipUser?: boolean },
): void {
  if (!options?.skipUser && userRole && userContent?.trim()) {
    appendMessage(chatKey, userRole, userContent);
  }
  appendAssistantMessage(chatKey, assistantText);
  scheduleHistoryCompression(chatKey);
  logEvent("history_exchange_stored", {
    convKey: chatKey,
    skipUser: Boolean(options?.skipUser),
    hasUserRow: !options?.skipUser && Boolean(userRole && userContent?.trim()),
  });
}

export { currentSpeakerFromUser };
