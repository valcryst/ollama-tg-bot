import type { Context } from "grammy";
import type { Message, User } from "grammy/types";
import type { CurrentSpeaker } from "./speaker.js";
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
  currentSpeaker?: CurrentSpeaker | null,
): string | null {
  const msg = ctx.message;
  if (!msg) return null;

  const thread = buildReplyThread(msg, {
    botId,
    chatId: ctx.chat?.id,
    currentSpeaker,
  });

  const quoteText = msg.quote?.text?.trim();
  if (quoteText && thread) {
    return `${thread}\n\nQuoted fragment from the replied-to message:\n• ${quoteText}`;
  }
  if (quoteText) {
    return `Quoted fragment:\n• ${quoteText}`;
  }

  const externalText = summarizeExternalReply(msg);
  if (externalText && thread) {
    return `${thread}\n\nExternal reply reference:\n• ${externalText}`;
  }
  if (externalText) {
    return `External reply reference:\n• ${externalText}`;
  }

  return thread;
}

export function isReplyThreadContext(
  context: string | null | undefined,
): boolean {
  return Boolean(context?.includes("[REPLY THREAD"));
}

export function replyParameters(
  ctx: Context,
): { message_id: number } | undefined {
  const messageId = ctx.message?.message_id;
  return messageId != null ? { message_id: messageId } : undefined;
}

export function summarizeMessageContent(message: Message): string {
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

interface ReplyThreadOptions {
  botId?: number;
  chatId?: number;
  currentSpeaker?: CurrentSpeaker | null;
  maxDepth?: number;
}

interface ThreadStep {
  message: Message;
  sender: string;
  summary: string;
  replyToSender: string | null;
}

function buildReplyThread(
  message: Message,
  options: ReplyThreadOptions,
): string | null {
  const chain = collectReplyChain(message, options.maxDepth ?? 8);
  if (chain.length <= 1) return null;

  const steps: ThreadStep[] = chain.map((msg, index) => {
    const sender = formatSenderLabel(msg, options.botId) || "Unknown";
    const summary = describeMessage(msg, options);
    const parent = index > 0 ? chain[index - 1] : null;
    const replyToSender = parent
      ? formatSenderLabel(parent, options.botId) || "Unknown"
      : null;
    return { message: msg, sender, summary, replyToSender };
  });

  const lines: string[] = [
    "[REPLY THREAD — oldest first; the last step is from the person you answer now]",
  ];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepNum = i + 1;
    const isLast = i === steps.length - 1;
    const speakerTag = isLast ? " [CURRENT SPEAKER — reply to them]" : "";
    const replyNote = step.replyToSender
      ? ` (replying to ${step.replyToSender})`
      : "";
    lines.push(
      `${stepNum}. ${step.sender}${speakerTag}${replyNote}: ${step.summary}`,
    );
  }

  return lines.join("\n");
}

function collectReplyChain(message: Message, maxDepth: number): Message[] {
  const chain: Message[] = [message];
  let current = message.reply_to_message;
  let depth = 0;

  while (current && depth < maxDepth) {
    chain.unshift(current);
    current = current.reply_to_message;
    depth++;
  }

  return chain;
}

function describeMessage(message: Message, options: ReplyThreadOptions): string {
  const summary = summarizeMessageContent(message);

  if (summary === "[message]" && message.reply_to_message) {
    const nested = describeMessage(message.reply_to_message, options);
    if (nested && nested !== "[message]") {
      return `(nested in reply chain) ${nested}`;
    }
  }

  return summary;
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

function summarizeExternalReply(msg: Message): string | null {
  const external = msg.external_reply;
  if (!external) return null;

  const text = (external as { text?: string }).text?.trim();
  if (text) return text;

  const caption = (external as { caption?: string }).caption?.trim();
  if (caption) return caption;

  return null;
}
