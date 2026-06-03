import type { Context } from "grammy";
import type { ChatMessage } from "../ollama/client.js";
import {
  appendMessage,
  conversationKey,
  getHistory,
  historyToChatMessages,
} from "../db/history.js";
import { buildSystemPrompt } from "../prompts.js";

export function resolveConversationKey(ctx: Context): string | null {
  const chatId = ctx.chat?.id;
  if (chatId == null) return null;
  const threadId = ctx.message?.message_thread_id;
  return conversationKey(chatId, threadId);
}

export function buildChatMessages(
  customSystemPrompt: string,
  chatKey: string,
  currentUser: ChatMessage,
  userMemoryFacts: string[] = [],
): ChatMessage[] {
  const history = historyToChatMessages(getHistory(chatKey));
  return [
    {
      role: "system",
      content: buildSystemPrompt(customSystemPrompt, userMemoryFacts),
    },
    ...history,
    currentUser,
  ];
}

export function resolveUserId(ctx: Context): string | null {
  const id = ctx.from?.id;
  return id != null ? String(id) : null;
}

export function recordExchange(
  chatKey: string,
  userText: string,
  assistantText: string,
): void {
  appendMessage(chatKey, "user", userText);
  appendMessage(chatKey, "assistant", assistantText);
}

/** Text stored in history (images are not re-sent). */
export function historyUserLabel(
  text: string,
  usedVision: boolean,
  stickerHint?: string,
): string {
  if (text && stickerHint) return `${text}\n\n${stickerHint}`;
  if (text) return text;
  if (stickerHint) return stickerHint;
  if (usedVision) return "[sent an image]";
  return "[message]";
}
