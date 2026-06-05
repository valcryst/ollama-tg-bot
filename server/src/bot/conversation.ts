import type { Context } from "grammy";
import type { ChatMessage } from "../ollama/client.js";
import {
  appendMessage,
  conversationKey,
  getHistory,
  historyToChatMessages,
} from "../db/history.js";
import { scheduleHistoryCompression } from "../context-compress.js";
import { buildSystemPrompt } from "../prompts.js";
import { stickerHistoryLabel } from "./stickers.js";
import type { Sticker } from "@grammyjs/types";
import {
  currentSpeakerFromUser,
  wrapCurrentTurnForGroup,
  type CurrentSpeaker,
} from "./speaker.js";

export type { CurrentSpeaker } from "./speaker.js";

export function resolveConversationKey(ctx: Context): string | null {
  const chatId = ctx.chat?.id;
  if (chatId == null) return null;

  const inGroup =
    ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
  const threadId = ctx.message?.message_thread_id;
  const userId = ctx.from?.id;

  return conversationKey(chatId, {
    threadId,
    userId: inGroup && userId != null ? String(userId) : undefined,
  });
}

export function buildChatMessages(
  customSystemPrompt: string,
  chatKey: string,
  currentUser: ChatMessage,
  userMemoryFacts: string[] = [],
  replyContext?: string | null,
  memoryOptions: {
    isGroupChat?: boolean;
    groupMemoryFacts?: string[];
    generalMemoryFacts?: string[];
    currentSpeaker?: CurrentSpeaker | null;
    webSearchContext?: string | null;
    ownerUserId?: string | null;
    ownerUsername?: string | null;
    currentSpeakerIsOwner?: boolean;
  } = {},
): ChatMessage[] {
  const history = historyToChatMessages(getHistory(chatKey));
  const turns: ChatMessage[] = [...history];

  if (replyContext?.trim()) {
    turns.push({
      role: "user",
      content:
        `The user is replying to this earlier Telegram message (if they say "this", "that", or "it", they mean this):\n` +
        replyContext.trim(),
    });
  }

  const { webSearchContext } = memoryOptions;
  if (webSearchContext?.trim()) {
    turns.push({
      role: "user",
      content:
        `[WEB SEARCH — use for your reply to the next message. ` +
        `Answer from the Tavily summary and sources below.]\n\n` +
        webSearchContext.trim(),
    });
  }

  const {
    isGroupChat = false,
    currentSpeaker = null,
    ownerUserId = null,
    ownerUsername = null,
    currentSpeakerIsOwner = false,
  } = memoryOptions;
  let userContent = currentUser.content;
  if (isGroupChat && currentSpeaker) {
    userContent = wrapCurrentTurnForGroup(userContent, currentSpeaker, {
      isOwner: currentSpeakerIsOwner,
    });
  }

  turns.push({ ...currentUser, content: userContent });

  return [
    {
      role: "system",
      content: buildSystemPrompt(customSystemPrompt, userMemoryFacts, memoryOptions),
    },
    ...turns,
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
  userText: string,
  assistantText: string,
): void {
  appendMessage(chatKey, "user", userText);
  appendMessage(chatKey, "assistant", assistantText);
  scheduleHistoryCompression(chatKey);
}

/** Text stored in history (images are not re-sent). */
export function historyUserLabel(
  text: string,
  usedVision: boolean,
  sticker?: Sticker,
  visionFromReply = false,
): string {
  if (text && sticker) return `${text}\n${stickerHistoryLabel(sticker)}`;
  if (text) return text;
  if (sticker) return stickerHistoryLabel(sticker);
  if (usedVision && visionFromReply) return "[replied to an image]";
  if (usedVision) return "[sent an image]";
  return "[message]";
}

export function groupMemoryUserMessage(
  baseLabel: string,
  speaker: CurrentSpeaker | null,
): string {
  if (!speaker) return baseLabel;
  return `[Speaker: ${speaker.label}] ${baseLabel}`;
}

export { currentSpeakerFromUser };
