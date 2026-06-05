import type { Bot, Context } from "grammy";
import type { ChatMessage } from "../ollama/client.js";
import { config } from "../config.js";
import { clearHistory } from "../db/history.js";
import { clearGroupMemory, getGroupFacts } from "../db/group-memory.js";
import { getGeneralFacts } from "../db/general-memory.js";
import { clearUserMemory, getUserFacts } from "../db/user-memory.js";
import { rememberMessageRef } from "../db/message-refs.js";
import {
  scheduleGeneralMemoryCompression,
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
  currentSpeakerFromUser,
  groupMemoryUserMessage,
  historyUserLabel,
  isGroupChat,
  resolveConversationKey,
  resolveGroupChatId,
  resolveUserId,
} from "./conversation.js";
import { runChatTurn } from "./chat-turn.js";
import {
  findReplyMediaMessage,
  loadVisionFromMessage,
  messageHasUserImage,
} from "./message-media.js";
import { stickerUserPrompt } from "./stickers.js";
import { isMessageAddressedToBot } from "./address-analyze.js";
import { getOwnerUserId, getOwnerUsername, isOwner } from "./owner.js";
import { tryResolveOwnerFromUser } from "./owner-sync.js";
import { rememberTelegramUser } from "../db/known-users.js";
import { stripBotAddressing } from "./bot-identity.js";
import { isSlashCommandMessage } from "./addressed.js";
import { enrichTextWithUserMentions } from "./mentions.js";
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
  formatGroupActivityContext,
  recordPassiveGroupActivity,
  resolveGroupActivityKey,
} from "./group-activity.js";
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

function trackTelegramUser(ctx: Context): void {
  rememberTelegramUser(ctx.from);
  tryResolveOwnerFromUser(ctx.from);
}

export function registerHandlers(bot: Bot, botUsername: string): void {
  bot.use((ctx, next) => {
    try {
      trackTelegramUser(ctx);
    } catch (err) {
      console.error("Failed to track Telegram user:", err);
    }
    return next();
  });

  registerBotCommands(bot, botUsername);

  bot.use(async (ctx, next) => {
    try {
      recordPassiveGroupActivity(ctx);
    } catch (err) {
      console.error("Failed to record group activity:", err);
    }
    await next();
  });

  bot.on("message", async (ctx) => {
    if (!ctx.message) return;
    if (ctx.from?.is_bot) return;
    if (isSlashCommandMessage(ctx)) return;

    const text = extractText(ctx);
    const hasMedia =
      !!ctx.message.photo ||
      !!ctx.message.sticker ||
      !!ctx.message.document;

    if (!text && !hasMedia) return;

    const addressed = await isMessageAddressedToBot(ctx);
    const settings = getSettings();
    const inGroup = ctx.chat?.type !== "private";
    const randomHit =
      settings.randomReplyEnabled &&
      inGroup &&
      !addressed &&
      Math.random() * 100 < settings.randomReplyChance;
    const imageHit =
      settings.reactToEveryImage &&
      inGroup &&
      !addressed &&
      !randomHit &&
      messageHasUserImage(ctx.message);

    if (!addressed && !randomHit && !imageHit) return;

    recordMessageReceived();

    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const convKey = resolveConversationKey(ctx);
    if (!convKey) return;

    const userId = resolveUserId(ctx);
    const groupChatId = resolveGroupChatId(ctx);
    const inGroupChat = isGroupChat(ctx);
    const userMemoryFacts = userId ? getUserFacts(userId) : [];
    const groupMemoryFacts = groupChatId ? getGroupFacts(groupChatId) : [];
    const generalMemoryFacts = getGeneralFacts();

    if (userId) scheduleUserMemoryCompression(userId);
    if (groupChatId) scheduleGroupMemoryCompression(groupChatId);
    scheduleGeneralMemoryCompression();
    scheduleHistoryCompression(convKey);

    try {
      let visionFromReply = false;
      let loaded = await loadVisionFromMessage(bot.token, ctx.message);

      if (loaded.unavailableText) {
        await replyToUser(ctx, loaded.unavailableText);
        recordReply(false);
        return;
      }

      if (loaded.images.length === 0) {
        const replyMediaMsg = findReplyMediaMessage(ctx.message);
        if (replyMediaMsg) {
          const replyLoaded = await loadVisionFromMessage(
            bot.token,
            replyMediaMsg,
          );
          if (replyLoaded.unavailableText) {
            await replyToUser(ctx, replyLoaded.unavailableText);
            recordReply(false);
            return;
          }
          if (replyLoaded.images.length > 0) {
            loaded = replyLoaded;
            visionFromReply = true;
          }
        }
      }

      const images = loaded.images;
      const usedVision = images.length > 0;
      const sticker = loaded.sourceSticker ?? ctx.message.sticker;
      const stickerVisionHint = loaded.visionHint;
      const botId = ctx.me?.id;
      const botUsername = ctx.me?.username;
      const promptText = stripBotAddressing(text) || text;
      const messageText = enrichTextWithUserMentions(promptText, ctx.message, {
        botId,
        botUsername,
        senderId: ctx.from?.id,
        senderUsername: ctx.from?.username,
      });
      const body = sticker
        ? stickerUserPrompt(sticker, messageText, stickerVisionHint)
        : buildUserContent(messageText, usedVision, visionFromReply);
      const historyBase = historyUserLabel(
        messageText,
        usedVision,
        visionFromReply ? undefined : sticker,
        visionFromReply,
      );
      const speaker = inGroupChat ? currentSpeakerFromUser(ctx.from) : null;
      let replyContext = formatReplyContext(ctx, botId, speaker);
      if (visionFromReply && usedVision) {
        const mediaNote = sticker
          ? "The sticker image from the replied-to message is attached to this turn — interpret the artwork, not only the pack emoji."
          : "The photo or image from the replied-to message is attached to this turn for you to view.";
        replyContext = replyContext
          ? `${replyContext}\n\n• ${mediaNote}`
          : `• ${mediaNote}`;
      }
      const memoryUserLabel = replyContext
        ? appendReplyContext(ctx, historyBase, botId, speaker)
        : historyBase;

      if (!inGroupChat) {
        rememberMessageRef(
          convKey,
          ctx.message.message_id,
          "user",
          historyBase,
        );
      }

      const groupActivityKey = inGroupChat
        ? resolveGroupActivityKey(ctx)
        : null;
      const groupActivityContext = groupActivityKey
        ? formatGroupActivityContext(groupActivityKey, {
            excludeMessageId: ctx.message.message_id,
            currentSpeakerLabel: speaker?.label ?? null,
          })
        : null;

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
        inGroup: inGroupChat,
        currentUser,
        historyLabel: historyBase,
        userMemoryFacts,
        groupMemoryFacts,
        generalMemoryFacts,
        currentSpeaker: speaker,
        currentSpeakerIsOwner: inGroupChat ? isOwner(ctx) : false,
        replyContext,
        groupActivityContext,
        usedVision,
        memoryInput: {
          userMessage: groupMemoryUserMessage(memoryUserLabel, speaker),
          replyContext,
          existingUserFacts: userMemoryFacts,
          existingGroupFacts: groupMemoryFacts,
          existingGeneralFacts: generalMemoryFacts,
          isGroupChat: inGroupChat,
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
    const userId =
      resolved.reactor?.id != null
        ? String(resolved.reactor.id)
        : resolveUserId(ctx);
    const inGroup =
      resolved.chatType === "group" || resolved.chatType === "supergroup";
    const groupChatId = inGroup ? String(chatId) : null;
    const userMemoryFacts = userId ? getUserFacts(userId) : [];
    const groupMemoryFacts = groupChatId ? getGroupFacts(groupChatId) : [];
    const generalMemoryFacts = getGeneralFacts();

    if (userId) scheduleUserMemoryCompression(userId);
    if (groupChatId) scheduleGroupMemoryCompression(groupChatId);
    scheduleGeneralMemoryCompression();
    scheduleHistoryCompression(convKey);

    const reactor = resolved.reactor;
    const speaker = inGroup ? currentSpeakerFromUser(reactor) : null;
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
      generalMemoryFacts,
      currentSpeaker: speaker,
      currentSpeakerIsOwner: inGroup ? isOwner(ctx) : false,
      memoryInput: {
        userMessage: groupMemoryUserMessage(historyLabel, speaker),
        replyContext: targetContent,
        existingUserFacts: userMemoryFacts,
        existingGroupFacts: groupMemoryFacts,
        existingGeneralFacts: generalMemoryFacts,
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
}

function registerBotCommands(bot: Bot, botUsername: string): void {
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
        (config.tavilyApiKey
          ? `• I can search the web via Tavily when needed\n`
          : "") +
        `• I learn facts about you (stored per user)` +
        (inGroup ? `\n• I learn facts about this group (stored per chat)` : "") +
        `\n\n` +
        `Current model: <code>${escapeHtml(settings.model)}</code>\n` +
        `Clear chat context: /reset@${botUsername} · Clear your memory: /forget@${botUsername}` +
        (inGroup
          ? ` · Clear group memory: /forgetgroup@${botUsername}`
          : "") +
        (isOwner(ctx) ? `\n\nYou are the configured bot owner.` : "") +
        (!inGroup && !getOwnerUserId() && !getOwnerUsername()
          ? `\n\nSet owner: enter your @username in the dashboard Settings page (message the bot once first).`
          : ""),
    );
  });

  bot.command("id", async (ctx) => {
    try {
      const userId = resolveUserId(ctx);
      if (!userId) return;
      const username = ctx.from?.username;
      let text = `Your Telegram user id: <code>${escapeHtml(userId)}</code>`;
      if (username) {
        text += `\nYour username: @${escapeHtml(username)}`;
      }
      if (isOwner(ctx)) {
        text += "\n\nYou are the configured bot owner.";
      } else if (!getOwnerUserId() && !getOwnerUsername()) {
        text +=
          "\n\nSet owner in the dashboard Settings page using your @username (send /start here first so it can be resolved).";
      }
      if (isGroupChat(ctx)) {
        text += `\n\nIn groups use <code>/id@${botUsername}</code> so Telegram delivers the command.`;
      }
      await replyToUser(ctx, text);
    } catch (err) {
      console.error("/id command error:", err);
      await replyToUser(ctx, "Sorry, I could not look up your id.").catch(
        (e) => console.error("Failed to send /id error reply:", e),
      );
    }
  });

  bot.command("reset", async (ctx) => {
    const convKey = resolveConversationKey(ctx);
    if (!convKey) return;
    clearHistory(convKey);
    const scope = isGroupChat(ctx)
      ? "your messages with the bot in this group"
      : "this conversation";
    await replyToUser(ctx, `Chat context cleared for ${scope}.`);
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

function buildUserContent(
  text: string,
  usedVision: boolean,
  aboutRepliedMedia = false,
): string {
  if (text) {
    if (aboutRepliedMedia && usedVision) {
      return (
        `${text}\n\n` +
        "(They are asking about the image from the message they replied to; it is attached to this turn.)"
      );
    }
    return text;
  }
  if (usedVision) {
    return aboutRepliedMedia
      ? "Answer about the image from the message they replied to."
      : "Describe what you see in this image.";
  }
  return "Hello!";
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
