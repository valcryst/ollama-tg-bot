import type { Context } from "grammy";
import type { Message } from "grammy/types";
import { conversationKey } from "../db/history.js";
import {
  getRecentMessageRefs,
  rememberMessageRef,
  type MessageRefEntry,
} from "../db/message-refs.js";
import { isSlashCommandMessage } from "./addressed.js";
import { summarizeMessageContent } from "./replies.js";
import { currentSpeakerFromUser } from "./speaker.js";

/** Group-level key (no per-member suffix) for passive chat awareness. */
export function resolveGroupActivityKey(ctx: Context): string | null {
  const chatId = ctx.chat?.id;
  if (chatId == null) return null;
  if (ctx.chat?.type !== "group" && ctx.chat?.type !== "supergroup") {
    return null;
  }
  const threadId = ctx.message?.message_thread_id;
  return conversationKey(chatId, { threadId });
}

export function recordPassiveGroupActivity(ctx: Context): void {
  const msg = ctx.message;
  if (!msg || ctx.from?.is_bot) return;
  if (isSlashCommandMessage(ctx)) return;

  const chatKey = resolveGroupActivityKey(ctx);
  if (!chatKey) return;

  const speaker = currentSpeakerFromUser(ctx.from);
  const senderLabel = speaker?.label ?? "Unknown member";
  const content = summarizeGroupMessage(msg);
  if (!content) return;

  rememberMessageRef(
    chatKey,
    msg.message_id,
    "user",
    content,
    senderLabel,
  );
}

export function formatGroupActivityContext(
  chatKey: string,
  options?: {
    limit?: number;
    excludeMessageId?: number;
    currentSpeakerLabel?: string | null;
  },
): string | null {
  const entries = getRecentMessageRefs(
    chatKey,
    options?.limit ?? 18,
    options?.excludeMessageId,
  );
  if (entries.length === 0) return null;

  const lines = entries.map((entry) => formatActivityLine(entry));
  const speakerNote = options?.currentSpeakerLabel
    ? `You are answering ${options.currentSpeakerLabel} — the other lines are background from the group.\n\n`
    : "";

  return (
    `[RECENT GROUP MESSAGES — situational context only; ` +
    `do not reply to everyone listed unless the current speaker asks you to]\n` +
    speakerNote +
    lines.join("\n")
  );
}

function formatActivityLine(entry: MessageRefEntry): string {
  const who =
    entry.role === "assistant"
      ? "Bot"
      : (entry.senderLabel ?? "Someone");
  return `• ${who}: ${entry.content}`;
}

function summarizeGroupMessage(message: Message): string | null {
  const summary = summarizeMessageContent(message);
  if (summary === "[message]") return null;
  return summary;
}
