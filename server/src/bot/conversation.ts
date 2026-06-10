import type { Context } from "grammy";
import type { ChatMessage } from "../model-api/client.js";
import {
  appendAssistantMessage,
  appendMessage,
  conversationKey,
  getHistory,
  historyToChatMessages,
} from "../db/history.js";
import {
  formatKnownUserLabel,
  getKnownUserById,
  getKnownUsersByIds,
} from "../db/known-users.js";
import { getUserFacts } from "../db/user-memory.js";
import { scheduleHistoryCompression } from "../context-compress.js";
import { logEvent } from "../event-log.js";
import type { Settings } from "../db/database.js";
import { buildSystemPrompt, type ParticipantFacts } from "../prompts.js";
import type { MoodValues } from "../mood.js";
import {
  extractParticipantUserIds,
  userRoleTag,
} from "./history-format.js";
import { isReplyThreadContext } from "./replies.js";
import { currentSpeakerFromUser, type CurrentSpeaker } from "./speaker.js";

export type { CurrentSpeaker } from "./speaker.js";

export function resolveConversationKey(ctx: Context): string | null {
  const chatId = ctx.chat?.id;
  if (chatId == null) return null;
  // Groups share one history per chat — not per forum topic.
  return conversationKey(chatId);
}

export interface LatestTurnOptions {
  body: string;
  speakerTag?: string | null;
  mentionedUsersContext?: string | null;
  replyContext?: string | null;
  linkFetchContext?: string | null;
  webSearchContext?: string | null;
  currentSpeaker?: CurrentSpeaker | null;
  currentSpeakerIsOwner?: boolean;
  isGroupChat?: boolean;
}

function buildLatestTurnMessage(options: LatestTurnOptions): string {
  const parts: string[] = [];

  const hasReplyThread = isReplyThreadContext(options.replyContext);

  if (options.isGroupChat && options.currentSpeaker) {
    if (hasReplyThread) {
      if (options.currentSpeakerIsOwner) {
        parts.push(
          "[CURRENT SPEAKER — bot owner — prioritize their intent]",
        );
      }
    } else {
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
  }

  if (options.mentionedUsersContext?.trim()) {
    parts.push(options.mentionedUsersContext.trim());
  }

  if (options.replyContext?.trim()) {
    parts.push(
      `[REPLY CONTEXT]\n${options.replyContext.trim()}`,
    );
  }

  if (options.linkFetchContext?.trim()) {
    parts.push(
      `[LINK CONTENT — answer from this for your reply]\n${options.linkFetchContext.trim()}`,
    );
  }

  if (options.webSearchContext?.trim()) {
    parts.push(
      `[WEB SEARCH — answer from this for your reply]\n${options.webSearchContext.trim()}`,
    );
  }

  if (!hasReplyThread) {
    parts.push(options.body.trim());
  }

  return parts.filter(Boolean).join("\n\n");
}

function loadKnownChatUsers(
  chatKey: string,
  currentUserId: string | null,
): ReturnType<typeof getKnownUsersByIds> {
  const history = getHistory(chatKey);
  const roles = history.map((m) => m.role);
  const participantIds = extractParticipantUserIds(
    roles,
    currentUserId ? [currentUserId] : [],
  );
  return getKnownUsersByIds(participantIds);
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

export interface BuiltChatPayload {
  messages: ChatMessage[];
  systemContent: string;
  historyMessages: ChatMessage[];
  latestContent: string;
  /** Rows loaded from DB (already capped by historyMaxMessages). */
  storedHistoryCount: number;
}

export function buildChatMessages(
  customSystemPrompt: string,
  chatKey: string,
  latestTurn: LatestTurnOptions,
  options: {
    settings: Settings;
    isGroupChat?: boolean;
    groupMemoryFacts?: string[];
    generalMemoryFacts?: string[];
    currentUserId?: string | null;
    ownerUserId?: string | null;
    ownerUsername?: string | null;
    mood?: MoodValues | null;
  },
): BuiltChatPayload {
  const {
    settings,
    isGroupChat = false,
    groupMemoryFacts = [],
    generalMemoryFacts = [],
    currentUserId = null,
    ownerUserId = null,
    ownerUsername = null,
    mood = null,
  } = options;

  const participantFacts = loadParticipantFacts(chatKey, currentUserId);
  const knownChatUsers = loadKnownChatUsers(chatKey, currentUserId);
  for (const p of participantFacts) {
    const known = getKnownUserById(p.userId);
    if (known) {
      p.label = formatKnownUserLabel(known);
      continue;
    }
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
    settings,
    customPrompt: customSystemPrompt,
    generalMemoryFacts,
    groupMemoryFacts,
    participantFacts,
    knownChatUsers: isGroupChat ? knownChatUsers : [],
    isGroupChat,
    ownerUserId,
    ownerUsername,
    mood,
  });

  const storedHistory = getHistory(chatKey);
  const history = historyToChatMessages(storedHistory);
  const latest = buildLatestTurnMessage({
    ...latestTurn,
    isGroupChat,
    speakerTag: latestTurn.speakerTag ?? null,
  });

  const historyMessages = history;
  const latestMessage: ChatMessage = { role: "user", content: latest };

  return {
    systemContent: system,
    historyMessages,
    latestContent: latest,
    storedHistoryCount: storedHistory.length,
    messages: [
      { role: "system", content: system },
      ...historyMessages,
      latestMessage,
    ],
  };
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
