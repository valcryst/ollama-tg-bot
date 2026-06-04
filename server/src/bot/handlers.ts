import type { Bot, Context } from "grammy";
import type { ChatMessage } from "../ollama/client.js";
import { clearHistory } from "../db/history.js";
import { clearGroupMemory, getGroupFacts } from "../db/group-memory.js";
import { clearUserMemory, getUserFacts } from "../db/user-memory.js";
import { rememberMessageRef } from "../db/message-refs.js";
import {
  scheduleGroupMemoryCompression,
  scheduleHistoryCompression,
  scheduleUserMemoryCompression,
} from "../context-compress.js";
import {
  getSettings,
  recordMessageReceived,
  recordReply,
} from "../db/database.js";
import {
  historyUserLabel,
  isGroupChat,
  resolveConversationKey,
  resolveGroupChatId,
  resolveUserId,
} from "./conversation.js";
import { runChatTurn } from "./chat-turn.js";
import type { ImagePayload } from "./files.js";
import { downloadTelegramFile } from "./files.js";
import {
  loadStickerForVision,
  stickerUnavailableText,
  stickerUserPrompt,
} from "./stickers.js";
import {
  isMessageForBot,
  isSlashCommandMessage,
  stripBotMention,
} from "./addressed.js";
import {
  groupSetupMessage,
  wasBotAddedToChat,
} from "./group-setup.js";
import {
  appendReplyContext,
  formatReplyContext,
  replyParameters,
} from "./replies.js";
import {
  formatReactionPrompt,
  isReactionAddressed,
  parseReactionChange,
  reactionHistoryLabel,
  resolveReaction,
} from "./reactions.js";

async function replyHtml(
  ctx: Context,
  text: string,
  extra?: Parameters<Context["reply"]>[1],
) {
  try {
    return await ctx.reply(text, { parse_mode: "HTML", ...extra });
  } catch {
    return await ctx.reply(text, extra);
  }
}

async function replyToUser(
  ctx: Context,
  text: string,
  extra?: Parameters<Context["reply"]>[1],
) {
  const params = replyParameters(ctx);
  return replyHtml(
    ctx,
    text,
    params ? { reply_parameters: params, ...extra } : extra,
  );
}

export function registerHandlers(bot: Bot, botUsername: string): void {
  bot.on("message", async (ctx) => {
    if (!ctx.message) return;
    if (isSlashCommandMessage(ctx)) return;

    const text = extractText(ctx);
    const hasMedia =
      !!ctx.message.photo ||
      !!ctx.message.sticker ||
      !!ctx.message.document;

    if (!text && !hasMedia) return;

    const addressed = isMessageForBot(ctx);
    const settings = getSettings();
    const randomHit =
      settings.randomReplyEnabled &&
      ctx.chat?.type !== "private" &&
      !addressed &&
      Math.random() * 100 < settings.randomReplyChance;

    if (!addressed && !randomHit) return;

    recordMessageReceived();

    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const convKey = resolveConversationKey(ctx);
    if (!convKey) return;

    const userId = resolveUserId(ctx);
    const groupChatId = resolveGroupChatId(ctx);
    const inGroup = isGroupChat(ctx);
    const userMemoryFacts = userId ? getUserFacts(userId) : [];
    const groupMemoryFacts = groupChatId ? getGroupFacts(groupChatId) : [];

    if (userId) scheduleUserMemoryCompression(userId);
    if (groupChatId) scheduleGroupMemoryCompression(groupChatId);
    scheduleHistoryCompression(convKey);

    try {
      const images: ImagePayload[] = [];
      let stickerVisionHint: string | undefined;

      if (ctx.message.photo) {
        const photo = ctx.message.photo[ctx.message.photo.length - 1];
        const img = await downloadTelegramFile(bot.token, photo.file_id);
        if (img) images.push(img);
      } else if (ctx.message.sticker) {
        const loaded = await loadStickerForVision(
          bot.token,
          ctx.message.sticker,
        );
        if (!loaded) {
          await replyToUser(
            ctx,
            stickerUnavailableText(ctx.message.sticker),
          );
          recordReply(false);
          return;
        }
        images.push(loaded.payload);
        stickerVisionHint = loaded.visionHint;
      } else if (
        ctx.message.document?.mime_type?.startsWith("image/")
      ) {
        const img = await downloadTelegramFile(
          bot.token,
          ctx.message.document.file_id,
        );
        if (img) images.push(img);
      }

      const usedVision = images.length > 0;
      const sticker = ctx.message.sticker;
      const botId = ctx.me?.id;
      const promptText =
        stripBotMention(text, ctx.me?.username) || text;
      const body = sticker
        ? stickerUserPrompt(sticker, promptText, stickerVisionHint)
        : buildUserContent(promptText, usedVision);
      const historyBase = historyUserLabel(promptText, usedVision, sticker);
      const replyContext = formatReplyContext(ctx, botId);
      const historyLabel = replyContext
        ? appendReplyContext(ctx, historyBase, botId)
        : historyBase;

      rememberMessageRef(
        convKey,
        ctx.message.message_id,
        "user",
        historyLabel,
      );

      const memoryUserLabel = replyContext
        ? appendReplyContext(ctx, historyBase, botId)
        : historyBase;

      const currentUser: ChatMessage = {
        role: "user",
        content: body,
        ...(usedVision ? { images: images.map((i) => i.base64) } : {}),
      };

      await runChatTurn(ctx, {
        convKey,
        chatId,
        userId,
        groupChatId,
        inGroup,
        currentUser,
        historyLabel,
        userMemoryFacts,
        groupMemoryFacts,
        replyContext,
        usedVision,
        memoryInput: {
          userMessage: memoryUserLabel,
          replyContext,
          existingUserFacts: userMemoryFacts,
          existingGroupFacts: groupMemoryFacts,
          isGroupChat: inGroup,
        },
      });
    } catch (err) {
      console.error("Handler error:", err);
    }
  });

  bot.on("message_reaction", async (ctx) => {
    const change = parseReactionChange(ctx);
    if (!change) return;

    const resolved = resolveReaction(ctx);
    if (!resolved) return;

    const settings = getSettings();
    const randomHit =
      settings.randomReplyEnabled &&
      resolved.chatType !== "private" &&
      Math.random() * 100 < settings.randomReplyChance;

    if (
      !isReactionAddressed(
        resolved.chatType,
        resolved.targetRole,
        randomHit,
      )
    ) {
      console.log(
        `Ignored reaction in ${resolved.chatType} chat ${resolved.chatId} ` +
          `(msg ${resolved.messageId}, target=${resolved.targetRole ?? "unknown"})`,
      );
      return;
    }

    recordMessageReceived();

    const { convKey, chatId, messageId, targetRole, targetContent } = resolved;
    const userId = resolveUserId(ctx);
    const inGroup =
      resolved.chatType === "group" || resolved.chatType === "supergroup";
    const groupChatId = inGroup ? String(chatId) : null;
    const userMemoryFacts = userId ? getUserFacts(userId) : [];
    const groupMemoryFacts = groupChatId ? getGroupFacts(groupChatId) : [];

    if (userId) scheduleUserMemoryCompression(userId);
    if (groupChatId) scheduleGroupMemoryCompression(groupChatId);
    scheduleHistoryCompression(convKey);

    const reactor = ctx.from ?? ctx.messageReaction?.user;
    const body = formatReactionPrompt(reactor, change, targetRole, targetContent);
    const historyLabel = reactionHistoryLabel(reactor, change, targetRole);

    const currentUser: ChatMessage = { role: "user", content: body };

    await runChatTurn(ctx, {
      convKey,
      chatId,
      userId,
      groupChatId,
      inGroup,
      currentUser,
      historyLabel,
      userMemoryFacts,
      groupMemoryFacts,
      memoryInput: {
        userMessage: historyLabel,
        replyContext: targetContent,
        existingUserFacts: userMemoryFacts,
        existingGroupFacts: groupMemoryFacts,
        isGroupChat: inGroup,
      },
      replyToMessageId: messageId,
      messageThreadId: resolved.messageThreadId,
    });
  });

  bot.on("my_chat_member", async (ctx) => {
    const chat = ctx.chat;
    if (!chat || (chat.type !== "group" && chat.type !== "supergroup")) return;

    const { old_chat_member: oldMember, new_chat_member: newMember } =
      ctx.myChatMember;
    if (!wasBotAddedToChat(oldMember.status, newMember.status)) return;

    let text = groupSetupMessage(botUsername);
    if (newMember.status !== "administrator") {
      text +=
        "\n\n<b>Emoji reactions:</b> make me a <b>group admin</b> so I can see " +
        "when you react to my messages (required by Telegram in groups).";
    }

    try {
      await ctx.api.sendMessage(chat.id, text, { parse_mode: "HTML" });
    } catch (err) {
      console.error("Failed to send group setup message:", err);
    }
  });

  bot.command("start", async (ctx) => {
    const settings = getSettings();
    const inGroup = isGroupChat(ctx);
    await replyToUser(
      ctx,
      (inGroup
        ? groupSetupMessage(botUsername) + "\n\n"
        : `Hi! I'm connected to Ollama.\n\n`) +
        (inGroup
          ? ""
          : `• Send me anything in private chat\n` +
            `• Send photos or stickers (animated/video use a preview frame)\n` +
            `• React to my messages with emoji — I'll respond\n`) +
        `• I remember recent messages in this chat\n` +
        `• I learn facts about you (stored per user)` +
        (inGroup ? `\n• I learn facts about this group (stored per chat)` : "") +
        `\n\n` +
        `Current model: <code>${escapeHtml(settings.model)}</code>\n` +
        `Clear chat context: /reset@${botUsername} · Clear your memory: /forget@${botUsername}` +
        (inGroup
          ? ` · Clear group memory: /forgetgroup@${botUsername}`
          : ""),
    );
  });

  bot.command("reset", async (ctx) => {
    const convKey = resolveConversationKey(ctx);
    if (!convKey) return;
    clearHistory(convKey);
    await replyToUser(ctx, "Chat context cleared for this conversation.");
  });

  bot.command("forget", async (ctx) => {
    const userId = resolveUserId(ctx);
    if (!userId) return;
    clearUserMemory(userId);
    await replyToUser(ctx, "Your stored memory has been cleared.");
  });

  bot.command("forgetgroup", async (ctx) => {
    const groupChatId = resolveGroupChatId(ctx);
    if (!groupChatId) {
      await replyToUser(ctx, "Group memory is only available in group chats.");
      return;
    }
    clearGroupMemory(groupChatId);
    await replyToUser(ctx, "Stored memory for this group has been cleared.");
  });
}

function extractText(ctx: Context): string {
  const msg = ctx.message;
  if (!msg) return "";
  return (msg.text ?? msg.caption ?? "").trim();
}

function buildUserContent(text: string, usedVision: boolean): string {
  if (text) return text;
  if (usedVision) return "Describe what you see in this image.";
  return "Hello!";
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
