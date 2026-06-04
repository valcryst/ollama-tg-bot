import type { Context } from "grammy";
import type { Chat, User } from "grammy/types";
import {
  findMessageRefInChat,
  type MessageRefRole,
} from "../db/message-refs.js";
import { threadIdFromChatKey } from "../db/history.js";

export interface ReactionChange {
  emojiAdded: string[];
  emojiRemoved: string[];
  customEmojiAdded: string[];
  paidAdded: boolean;
}

export interface ResolvedReaction {
  convKey: string;
  chatId: number;
  messageId: number;
  chatType: Chat["type"];
  messageThreadId?: number;
  targetRole: MessageRefRole | null;
  targetContent: string | null;
}

export function parseReactionChange(ctx: Context): ReactionChange | null {
  if (!ctx.messageReaction) return null;
  const diff = ctx.reactions();
  const hasAdd =
    diff.emojiAdded.length > 0 ||
    diff.customEmojiAdded.length > 0 ||
    diff.paidAdded;
  if (!hasAdd) return null;

  return {
    emojiAdded: diff.emojiAdded,
    emojiRemoved: diff.emojiRemoved,
    customEmojiAdded: diff.customEmojiAdded,
    paidAdded: diff.paidAdded,
  };
}

export function resolveReaction(ctx: Context): ResolvedReaction | null {
  const update = ctx.messageReaction;
  if (!update) return null;

  const chatId = update.chat.id;
  const messageId = update.message_id;
  const match = findMessageRefInChat(chatId, messageId);

  const convKey = match?.chatKey ?? String(chatId);
  const messageThreadId = threadIdFromChatKey(convKey, chatId);

  return {
    convKey,
    chatId,
    messageId,
    chatType: update.chat.type,
    messageThreadId,
    targetRole: match?.role ?? null,
    targetContent: match?.content ?? null,
  };
}

export function isReactionAddressed(
  chatType: Chat["type"],
  targetRole: MessageRefRole | null,
  randomHit: boolean,
): boolean {
  if (chatType === "private") return true;
  if (targetRole === "assistant") return true;
  return randomHit;
}

export function formatReactionPrompt(
  reactor: User | undefined,
  change: ReactionChange,
  targetRole: MessageRefRole | null,
  targetContent: string | null,
): string {
  const who = reactor ? formatUserName(reactor) : "Someone";
  const added = formatAddedReactions(change);
  const target = describeReactionTarget(targetRole, targetContent);

  let text =
    `${who} added ${added} as a reaction to ${target}. ` +
    "Respond naturally to what this reaction means in context (acknowledge, answer, or banter).";

  if (change.emojiRemoved.length > 0) {
    text += `\n(They removed: ${change.emojiRemoved.join(" ")})`;
  }

  return text;
}

export function reactionHistoryLabel(
  reactor: User | undefined,
  change: ReactionChange,
  targetRole: MessageRefRole | null,
): string {
  const who = reactor?.first_name ?? "User";
  const added = formatAddedReactions(change);
  const target =
    targetRole === "assistant"
      ? "the bot's message"
      : targetRole === "user"
        ? "a message"
        : "a message";
  return `${who} reacted ${added} to ${target}`;
}

function formatAddedReactions(change: ReactionChange): string {
  const parts: string[] = [...change.emojiAdded];
  if (change.customEmojiAdded.length > 0) {
    parts.push(
      ...change.customEmojiAdded.map(() => "[custom emoji reaction]"),
    );
  }
  if (change.paidAdded) parts.push("[paid reaction ⭐]");
  return parts.length > 0 ? parts.join(" ") : "a reaction";
}

function describeReactionTarget(
  role: MessageRefRole | null,
  content: string | null,
): string {
  if (role === "assistant") {
    return content
      ? `the bot's earlier message: "${content}"`
      : "the bot's earlier message";
  }
  if (role === "user") {
    return content
      ? `this earlier message: "${content}"`
      : "an earlier message in the chat";
  }
  return "a message in the chat (original text unavailable)";
}

function formatUserName(user: User): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
  return user.username ? `${name} (@${user.username})` : name;
}
