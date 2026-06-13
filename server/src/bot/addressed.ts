import type { Context } from "grammy";
import type { Message } from "grammy/types";
import { isReplyInBotThread, isReplyToBot } from "./replies.js";

export function isMessageForBot(ctx: Context): boolean {
  if (!ctx.message) return false;
  if (ctx.chat?.type === "private") return true;

  const me = ctx.me;
  if (!me?.id) return false;

  const username = me.username ?? "";

  if (isReplyToBot(ctx, username)) return true;
  if (isReplyInBotThread(ctx, username)) return true;
  if (messageMentionsBot(ctx.message, me.id, me.username)) return true;
  if (messageHasBotCommand(ctx.message, me.username)) return true;

  return false;
}

function messageMentionsBot(
  msg: Message,
  botId: number,
  botUsername?: string,
): boolean {
  const text = msg.text ?? msg.caption ?? "";
  if (!text) return false;

  const user = botUsername?.toLowerCase();
  const textLower = text.toLowerCase();

  if (user && textLower.includes(`@${user}`)) return true;

  const entities = [...(msg.entities ?? []), ...(msg.caption_entities ?? [])];
  for (const entity of entities) {
    if (entity.type === "text_mention" && entity.user.id === botId) {
      return true;
    }
    if (entity.type === "mention" && user) {
      const mention = sliceEntity(text, entity.offset, entity.length)
        .replace(/^@/, "")
        .toLowerCase();
      if (mention === user) return true;
    }
  }

  return false;
}

function messageHasBotCommand(msg: Message, botUsername?: string): boolean {
  const text = msg.text ?? msg.caption ?? "";
  if (!text.trimStart().startsWith("/")) return false;

  const user = botUsername?.toLowerCase();
  const entities = [...(msg.entities ?? []), ...(msg.caption_entities ?? [])];

  for (const entity of entities) {
    if (entity.type !== "bot_command") continue;

    const cmd = sliceEntity(text, entity.offset, entity.length);
    const at = cmd.indexOf("@");
    if (at === -1) continue;

    const target = cmd.slice(at + 1).toLowerCase();
    if (user && target === user) return true;
  }

  return false;
}

/** Telegram entity offsets are UTF-16 code units (same as JS strings). */
export function sliceEntity(
  text: string,
  offset: number,
  length: number,
): string {
  return text.slice(offset, offset + length);
}

export function isSlashCommandMessage(ctx: Context): boolean {
  const text = ctx.message?.text?.trim() ?? "";
  return text.startsWith("/");
}
