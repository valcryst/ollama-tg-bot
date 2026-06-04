import type { Context } from "grammy";
import type { Message, User } from "grammy/types";
import { stickerHistoryLabel } from "./stickers.js";

export function isReplyToBot(ctx: Context, botUsername: string): boolean {
  const msg = ctx.message;
  if (!msg) return false;

  const botId = ctx.me?.id;
  const replied = msg.reply_to_message;
  if (replied) {
    if (botId != null && replied.from?.id === botId) return true;
    const username = replied.from?.username;
    if (
      username &&
      username.toLowerCase() === botUsername.toLowerCase()
    ) {
      return true;
    }
    if (botId != null && isMessageFromBot(replied, botId, botUsername)) {
      return true;
    }
  }

  const external = msg.external_reply;
  if (external && botId != null) {
    const origin = external.origin;
    if (origin.type === "user" && origin.sender_user.id === botId) {
      return true;
    }
  }

  return false;
}

/** True when the user is continuing a thread (reply chain includes the bot). */
export function isReplyInBotThread(
  ctx: Context,
  botUsername: string,
): boolean {
  if (isReplyToBot(ctx, botUsername)) return true;

  const botId = ctx.me?.id;
  let current = ctx.message?.reply_to_message;
  let depth = 0;

  while (current && depth < 8) {
    if (botId != null && isMessageFromBot(current, botId, botUsername)) {
      return true;
    }
    current = current.reply_to_message;
    depth++;
  }

  return false;
}

export function formatReplyContext(
  ctx: Context,
  botId?: number,
): string | null {
  const msg = ctx.message;
  if (!msg) return null;

  const lines: string[] = [];

  const quoteText = msg.quote?.text?.trim();
  if (quoteText) {
    lines.push(quoteText);
  }

  const replied = msg.reply_to_message;
  if (replied) {
    const described = describeMessage(replied, botId);
    if (described && !lines.some((l) => l === described || l.includes(described))) {
      lines.push(described);
    }
  }

  const externalText = summarizeExternalReply(msg);
  if (externalText && !lines.includes(externalText)) {
    lines.push(externalText);
  }

  if (lines.length === 0) return null;

  return lines.map((line) => `• ${line}`).join("\n");
}

export function appendReplyContext(
  ctx: Context,
  body: string,
  botId?: number,
): string {
  const context = formatReplyContext(ctx, botId);
  if (!context) return body;
  return `Replied-to message:\n${context}\n\nUser asks: ${body}`;
}

export function replyParameters(
  ctx: Context,
): { message_id: number } | undefined {
  const messageId = ctx.message?.message_id;
  return messageId != null ? { message_id: messageId } : undefined;
}

function isMessageFromBot(
  message: Message,
  botId: number,
  botUsername: string,
): boolean {
  if (message.from?.id === botId) return true;
  const username = message.from?.username;
  return (
    !!username && username.toLowerCase() === botUsername.toLowerCase()
  );
}

function describeMessage(message: Message, botId?: number): string {
  const summary = summarizeMessageContent(message);
  if (summary === "[message]" && message.reply_to_message) {
    const nested = describeMessage(message.reply_to_message, botId);
    if (nested && nested !== "[message]") return nested;
  }

  const sender = formatSenderLabel(message, botId);
  if (!sender) return summary;
  if (summary === "[message]") return `${sender} sent a message`;
  return `${sender}: ${summary}`;
}

function formatSenderLabel(message: Message, botId?: number): string {
  if (message.from) {
    if (botId != null && message.from.id === botId) return "Bot";
    return formatUserName(message.from);
  }
  if (message.sender_chat?.title) return message.sender_chat.title;
  return "";
}

function formatUserName(user: User): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
  return user.username ? `${name} (@${user.username})` : name;
}

function summarizeMessageContent(message: Message): string {
  const text = (message.text ?? message.caption ?? "").trim();
  if (text) return text;

  if (message.photo?.length) return "[photo]";
  if (message.sticker) return stickerHistoryLabel(message.sticker);
  if (message.document) {
    return message.document.file_name
      ? `[file: ${message.document.file_name}]`
      : "[file]";
  }
  if (message.video) return "[video]";
  if (message.voice) return "[voice message]";
  if (message.audio) return "[audio]";
  if (message.animation) return "[animation]";
  return "[message]";
}

function summarizeExternalReply(msg: Message): string | null {
  const external = msg.external_reply;
  if (!external) return null;

  const text = (external as { text?: string }).text?.trim();
  if (text) return text;

  const caption = (external as { caption?: string }).caption?.trim();
  if (caption) return caption;

  return null;
}
