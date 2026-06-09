import type { Context } from "grammy";
import { appendMessage } from "../db/history.js";
import { rememberMessageRef } from "../db/message-refs.js";
import { scheduleHistoryCompression } from "../context-compress.js";
import { logEvent, logEventError } from "../event-log.js";
import { isSlashCommandMessage } from "./addressed.js";
import { resolveConversationKey } from "./conversation.js";
import {
  buildMediaHistoryContent,
  buildPassiveHistoryContent,
  mediaKindForMessage,
  userRoleTag,
} from "./history-format.js";
import {
  loadVisionFromMessage,
  messageHasVisionMedia,
} from "./message-media.js";
import { stickerPackEmoji } from "./stickers.js";
import { enrichTextWithUserMentions } from "./mentions.js";
import { describeVisionImages } from "./vision-describe.js";

/**
 * Record every human group message into shared history (text + vision for media).
 * Runs before address checks so the bot has context when it joins mid-conversation.
 */
export async function recordPassiveGroupHistory(
  ctx: Context,
  botToken: string,
): Promise<void> {
  const msg = ctx.message;
  if (!msg || ctx.from?.is_bot) return;
  if (isSlashCommandMessage(ctx)) return;
  if (ctx.chat?.type === "private") return;

  const chatKey = resolveConversationKey(ctx);
  const role = userRoleTag(ctx.from);
  if (!chatKey || !role) return;

  const msgLog = {
    chatId: ctx.chat?.id,
    userId: ctx.from?.id,
    messageId: msg.message_id,
    convKey: chatKey,
    passive: true,
  };
  const botId = ctx.me?.id;
  let stored = false;

  const rawText = (msg.text ?? msg.caption ?? "").trim();
  const enrichedText = rawText
    ? enrichTextWithUserMentions(rawText, msg, {
        botId,
        botUsername: ctx.me?.username,
        senderId: ctx.from?.id,
        senderUsername: ctx.from?.username,
      })
    : "";
  const textContent = buildPassiveHistoryContent(
    msg,
    ctx.from,
    enrichedText,
    botId,
  );
  if (textContent) {
    appendMessage(chatKey, role, textContent);
    rememberMessageRef(chatKey, msg.message_id, "user", textContent);
    stored = true;
    logEvent("passive_history_stored", { ...msgLog, kind: "text" });
  }

  if (messageHasVisionMedia(msg)) {
    logEvent("media_detected", {
      ...msgLog,
      mediaKind: mediaKindForMessage(msg, !!msg.sticker),
      onMessage: true,
    });

    const loaded = await loadVisionFromMessage(botToken, msg);
    if (loaded.unavailableText) {
      logEvent("vision_unavailable", msgLog);
    } else if (loaded.images.length > 0) {
      const sticker = loaded.sourceSticker ?? msg.sticker;
      const mediaKind = mediaKindForMessage(msg, !!sticker);
      const visionDescription = await describeVisionImages(loaded.images, msgLog);
      const mediaHistory = buildMediaHistoryContent(
        ctx.from,
        msg,
        mediaKind,
        visionDescription,
        botId,
        stickerPackEmoji(sticker),
      );
      if (mediaHistory) {
        appendMessage(chatKey, role, mediaHistory);
        rememberMessageRef(chatKey, msg.message_id, "user", mediaHistory);
        stored = true;
        logEvent("vision_stored", {
          ...msgLog,
          mediaKind,
          chars: visionDescription.length,
        });
      }
    }
  }

  if (stored) {
    scheduleHistoryCompression(chatKey);
  }
}
