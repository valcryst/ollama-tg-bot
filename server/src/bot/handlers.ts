import type { Bot, Context } from "grammy";
import { config } from "../config.js";
import { clearHistory } from "../db/history.js";
import {
  clearGroupMemory,
  createGroupFact,
  getGroupFacts,
} from "../db/group-memory.js";
import {
  createGeneralFact,
  getGeneralFacts,
} from "../db/general-memory.js";
import {
  MAX_FACT_LENGTH,
  MIN_FACT_LENGTH,
} from "../db/memory-facts.js";
import {
  clearUserMemory,
  createUserFact,
  getUserFacts,
} from "../db/user-memory.js";
import {
  scheduleGeneralMemoryCompression,
  scheduleGroupMemoryCompression,
  scheduleUserMemoryCompression,
} from "../context-compress.js";
import {
  getSettings,
  recordMessageReceived,
  recordReply,
} from "../db/database.js";
import {
  currentSpeakerFromUser,
  isGroupChat,
  resolveConversationKey,
  resolveGroupChatId,
  resolveUserId,
} from "./conversation.js";
import {
  buildMediaHistoryContent,
  buildTextHistoryContent,
  mediaKindForMessage,
  userRoleTag,
} from "./history-format.js";
import { stickerPackEmoji } from "./stickers.js";
import { describeVisionImages } from "./vision-describe.js";
import { recordPassiveGroupHistory } from "./history-record.js";
import { runChatTurn } from "./chat-turn.js";
import { runExplainTurn } from "./explain-turn.js";
import {
  findReplyMediaMessage,
  loadVisionFromMessage,
  messageHasUserImage,
  messageHasVisionMedia,
} from "./message-media.js";
import { isMessageAddressedToBot } from "./address-analyze.js";
import { getOwnerUserId, getOwnerUsername, isOwner } from "./owner.js";
import { tryResolveOwnerFromUser } from "./owner-sync.js";
import { rememberTelegramUser } from "../db/known-users.js";
import { stripBotAddressing } from "./bot-identity.js";
import { isSlashCommandMessage } from "./addressed.js";
import {
  formatMentionedUsersContext,
  resolveMentionedKnownUsers,
} from "./mentions.js";
import {
  groupSetupMessage,
  wasBotAddedToChat,
} from "./group-setup.js";
import {
  formatReplyContext,
  replyParameters,
  summarizeMessageContent,
} from "./replies.js";
import { logEvent, logEventError } from "../event-log.js";
import { buildMoodCommandReply } from "./mood-command.js";

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
      await recordPassiveGroupHistory(ctx, bot.token);
    } catch (err) {
      logEventError("passive_history_failed", err, {
        chatId: ctx.chat?.id,
        messageId: ctx.message?.message_id,
      });
    }
    await next();
  });

  bot.on("message", async (ctx) => {
    if (!ctx.message) return;

    const msgLog = {
      chatId: ctx.chat?.id,
      userId: ctx.from?.id,
      messageId: ctx.message.message_id,
      chatType: ctx.chat?.type,
    };

    logEvent("message_received", msgLog);

    if (ctx.from?.is_bot) {
      logEvent("message_ignored", { ...msgLog, reason: "from_bot" });
      return;
    }
    if (isSlashCommandMessage(ctx)) {
      logEvent("message_ignored", { ...msgLog, reason: "slash_command" });
      return;
    }

    const text = extractText(ctx);
    const hasMedia =
      !!ctx.message.photo ||
      !!ctx.message.sticker ||
      !!ctx.message.document;

    if (!text && !hasMedia) {
      logEvent("message_ignored", { ...msgLog, reason: "no_content" });
      return;
    }

    if (messageHasVisionMedia(ctx.message)) {
      logEvent("media_detected", {
        ...msgLog,
        mediaKind: mediaKindForMessage(ctx.message, !!ctx.message.sticker),
        onMessage: true,
      });
    }

    const settings = getSettings();
    const inGroup = ctx.chat?.type !== "private";
    const randomHit =
      settings.randomReplyEnabled &&
      inGroup &&
      Math.random() * 100 < settings.randomReplyChance;
    const imageHit =
      settings.reactToEveryImage &&
      inGroup &&
      !randomHit &&
      messageHasUserImage(ctx.message);
    const addressed =
      randomHit || imageHit ? false : await isMessageAddressedToBot(ctx);

    if (!addressed && !randomHit && !imageHit) {
      logEvent("message_ignored", { ...msgLog, reason: "not_addressed" });
      return;
    }

    const trigger = addressed
      ? "addressed"
      : randomHit
        ? "random"
        : "image";
    logEvent("message_accepted", { ...msgLog, trigger });

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

    try {
      const botId = ctx.me?.id;
      const botUsername = ctx.me?.username;
      const speaker = inGroupChat ? currentSpeakerFromUser(ctx.from) : null;
      const userRole = userRoleTag(ctx.from);

      const promptText = stripBotAddressing(text) || text;
      const mentionCtx = {
        botId,
        botUsername,
        senderId: ctx.from?.id,
        senderUsername: ctx.from?.username,
      };
      const mentionedUsers = resolveMentionedKnownUsers(
        text.trim(),
        ctx.message,
        mentionCtx,
      );
      const mentionedUsersContext = formatMentionedUsersContext(mentionedUsers);
      const messageText = promptText;

      let userHistoryContent: string | null = null;
      let skipUserHistory = inGroupChat;
      let latestBody = messageText || "(non-text message)";
      let replyContext = formatReplyContext(ctx, botId, speaker);

      if (inGroupChat) {
        if (messageHasVisionMedia(ctx.message)) {
          const loaded = await loadVisionFromMessage(bot.token, ctx.message);
          if (loaded.unavailableText) {
            logEvent("vision_unavailable", { ...msgLog, convKey, addressed: true });
            await replyToUser(ctx, loaded.unavailableText);
            recordReply(false);
            return;
          }
          if (loaded.images.length > 0) {
            const visionDescription = await describeVisionImages(
              loaded.images,
              {
                ...msgLog,
                convKey,
              },
              loaded.visionHint,
            );
            const sticker = loaded.sourceSticker ?? ctx.message.sticker;
            const mediaKind = mediaKindForMessage(ctx.message, !!sticker);
            const mediaHistory = buildMediaHistoryContent(
              ctx.from,
              ctx.message,
              mediaKind,
              visionDescription,
              botId,
              stickerPackEmoji(sticker),
            );
            if (mediaHistory) {
              userHistoryContent = mediaHistory;
              skipUserHistory = false;
              logEvent("vision_stored", {
                ...msgLog,
                convKey,
                mediaKind,
                chars: visionDescription.length,
              });
            }
            const mediaNote = `The user sent a ${mediaKind}: ${visionDescription}`;
            latestBody = [messageText, mediaNote].filter(Boolean).join("\n\n");
          }
        }
        if (!latestBody.trim() || latestBody === "(non-text message)") {
          latestBody = "Respond to this.";
        }
      } else {
        let visionFromReply = false;
        let loaded = await loadVisionFromMessage(bot.token, ctx.message);

        if (loaded.unavailableText) {
          logEvent("vision_unavailable", { ...msgLog, convKey });
          await replyToUser(ctx, loaded.unavailableText);
          recordReply(false);
          return;
        }

        if (loaded.images.length === 0) {
          const replyMediaMsg = findReplyMediaMessage(ctx.message);
          if (replyMediaMsg) {
            logEvent("media_detected", {
              ...msgLog,
              mediaKind: mediaKindForMessage(replyMediaMsg, !!replyMediaMsg.sticker),
              onMessage: false,
              fromReply: true,
            });
            const replyLoaded = await loadVisionFromMessage(
              bot.token,
              replyMediaMsg,
            );
            if (replyLoaded.unavailableText) {
              logEvent("vision_unavailable", { ...msgLog, convKey, fromReply: true });
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

        let visionDescription = "";
        if (loaded.images.length > 0) {
          visionDescription = await describeVisionImages(
            loaded.images,
            {
              ...msgLog,
              convKey,
              fromReply: visionFromReply,
            },
            loaded.visionHint,
          );
        }

        const sticker = loaded.sourceSticker ?? ctx.message.sticker;
        const mediaOnCurrentMessage = messageHasVisionMedia(ctx.message);
        const mediaKind = mediaKindForMessage(
          ctx.message,
          !!sticker || !!loaded.sourceSticker,
        );

        if (visionDescription && mediaOnCurrentMessage) {
          const mediaHistory = buildMediaHistoryContent(
            ctx.from,
            ctx.message,
            mediaKind,
            visionDescription,
            botId,
            stickerPackEmoji(sticker),
          );
          if (mediaHistory) {
            userHistoryContent = mediaHistory;
            skipUserHistory = false;
            logEvent("vision_stored", {
              ...msgLog,
              convKey,
              mediaKind,
              fromReply: visionFromReply,
              chars: visionDescription.length,
            });
          }
          latestBody = messageText || "What do you think?";
        } else if (visionDescription && visionFromReply) {
          const mediaNote = `The user is asking about an ${mediaKind} they replied to: ${visionDescription}`;
          latestBody = [messageText, mediaNote].filter(Boolean).join("\n\n");
          const mediaNoteCtx = `Replied-to ${mediaKind}: ${visionDescription}`;
          replyContext = replyContext
            ? `${replyContext}\n\n${mediaNoteCtx}`
            : mediaNoteCtx;
        } else {
          const textHistory = buildTextHistoryContent(
            ctx.from,
            ctx.message,
            messageText,
            botId,
          );
          if (textHistory) {
            userHistoryContent = textHistory;
            skipUserHistory = false;
          }
          latestBody = messageText || "(non-text message)";
        }
      }

      await runChatTurn(ctx, {
        convKey,
        chatId,
        userId,
        groupChatId,
        inGroup: inGroupChat,
        latestBody,
        userRole,
        userHistoryContent,
        skipUserHistory,
        userMemoryFacts,
        groupMemoryFacts,
        generalMemoryFacts,
        currentSpeaker: speaker,
        currentSpeakerIsOwner: inGroupChat ? isOwner(ctx) : false,
        replyContext,
        mentionedUsersContext,
        messageThreadId: ctx.message?.message_thread_id,
        memoryInput: {
          userMessage: latestBody,
          replyContext,
          existingUserFacts: userMemoryFacts,
          existingGroupFacts: groupMemoryFacts,
          existingGeneralFacts: generalMemoryFacts,
          isGroupChat: inGroupChat,
        },
      });
    } catch (err) {
      logEventError("handler_error", err, msgLog);
    }
  });

  bot.on("my_chat_member", async (ctx) => {
    const chat = ctx.chat;
    if (!chat || (chat.type !== "group" && chat.type !== "supergroup")) return;

    const { old_chat_member: oldMember, new_chat_member: newMember } =
      ctx.myChatMember;
    if (!wasBotAddedToChat(oldMember.status, newMember.status)) return;

    const text = groupSetupMessage(botUsername);

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
            `• Send photos or stickers (animated/video use a preview frame)\n`) +
        `• I remember recent messages in this chat\n` +
        `• I open links in your messages and read the page content\n` +
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
        (isOwner(ctx)
          ? `\nOwner tools: /mood@${botUsername} · /explain@${botUsername} · /remember@${botUsername} (or reply with either)`
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
      ? "this group's shared chat history"
      : "this conversation";
    await replyToUser(ctx, `Chat context cleared for ${scope}.`);
  });

  bot.command("mood", async (ctx) => {
    if (!isOwner(ctx)) {
      await replyToUser(ctx, "Only the bot owner can use /mood.");
      return;
    }

    try {
      await replyToUser(ctx, buildMoodCommandReply());
    } catch (err) {
      console.error("/mood command error:", err);
      await replyToUser(ctx, "Sorry, I could not load mood.").catch((e) =>
        console.error("Failed to send /mood error reply:", e),
      );
    }
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

  bot.command("explain", async (ctx) => {
    if (!isOwner(ctx)) {
      await replyToUser(ctx, "Only the bot owner can use /explain.");
      return;
    }

    const question = resolveCommandInlineOrReplyText(ctx, String(ctx.match ?? ""));
    if (!question) {
      await replyToUser(
        ctx,
        `Usage: <code>/explain@${botUsername} your question</code>\n` +
          `Or reply to a message with <code>/explain@${botUsername}</code>\n` +
          `Example: <code>/explain why are you so aggressive?</code>\n\n` +
          `Answers honestly about configuration and memories — not in character.`,
      );
      return;
    }

    recordMessageReceived();

    const chatId = ctx.chat?.id;
    if (!chatId) return;

    const convKey = resolveConversationKey(ctx);
    if (!convKey) return;

    const userId = resolveUserId(ctx);
    const groupChatId = resolveGroupChatId(ctx);
    const inGroupChat = isGroupChat(ctx);

    try {
      await runExplainTurn(ctx, {
        convKey,
        chatId,
        userId,
        groupChatId,
        inGroup: inGroupChat,
        question,
        userRole: userRoleTag(ctx.from),
        userMemoryFacts: userId ? getUserFacts(userId) : [],
        groupMemoryFacts: groupChatId ? getGroupFacts(groupChatId) : [],
        generalMemoryFacts: getGeneralFacts(),
        messageThreadId: ctx.message?.message_thread_id,
      });
    } catch (err) {
      logEventError("explain_command_failed", err, {
        chatId,
        userId,
      });
    }
  });

  bot.command("remember", async (ctx) => {
    if (!isOwner(ctx)) {
      await replyToUser(ctx, "Only the bot owner can use /remember.");
      return;
    }

    const fact = resolveCommandInlineOrReplyText(ctx, String(ctx.match ?? ""));
    if (!fact) {
      await replyToUser(
        ctx,
        `Usage: <code>/remember@${botUsername} fact to store</code>\n` +
          `Or reply to a message with <code>/remember@${botUsername}</code>\n` +
          `Example: <code>/remember be very aggressive</code>\n\n` +
          `Private chat → general memory · Group → group memory · Reply → that user's memory`,
      );
      return;
    }

    const target = resolveRememberTarget(ctx);
    if (!target) {
      await replyToUser(ctx, "Could not determine where to store this memory.");
      return;
    }

    let saved = false;
    let targetLabel = "";

    if (target.kind === "user") {
      const record = createUserFact(target.userId, fact);
      saved = record != null;
      targetLabel = `user memory for ${target.label}`;
      if (saved) scheduleUserMemoryCompression(target.userId);
    } else if (target.kind === "group") {
      const record = createGroupFact(target.groupId, fact);
      saved = record != null;
      targetLabel = "group memory";
      if (saved) scheduleGroupMemoryCompression(target.groupId);
    } else {
      const record = createGeneralFact(fact);
      saved = record != null;
      targetLabel = "general memory";
      if (saved) scheduleGeneralMemoryCompression();
    }

    if (!saved) {
      await replyToUser(
        ctx,
        `Could not save memory. Facts must be ${MIN_FACT_LENGTH}–${MAX_FACT_LENGTH} characters.`,
      );
      return;
    }

    logEvent("remember_saved", {
      chatId: ctx.chat?.id,
      userId: resolveUserId(ctx),
      target: target.kind,
      targetUserId: target.kind === "user" ? target.userId : undefined,
      targetGroupId: target.kind === "group" ? target.groupId : undefined,
      factChars: fact.length,
    });

    await replyToUser(
      ctx,
      `Saved to <b>${escapeHtml(targetLabel)}</b>:\n<code>${escapeHtml(fact)}</code>`,
    );
  });
}

type RememberTarget =
  | { kind: "user"; userId: string; label: string }
  | { kind: "group"; groupId: string }
  | { kind: "general" };

function resolveRememberTarget(ctx: Context): RememberTarget | null {
  const replied = ctx.message?.reply_to_message;
  const botId = ctx.me?.id;
  const replyAuthor = replied?.from;

  if (
    replyAuthor &&
    !replyAuthor.is_bot &&
    (botId == null || replyAuthor.id !== botId)
  ) {
    const userId = String(replyAuthor.id);
    const name = [replyAuthor.first_name, replyAuthor.last_name]
      .filter(Boolean)
      .join(" ");
    const label = replyAuthor.username
      ? `${name} (@${replyAuthor.username})`
      : name || `user ${userId}`;
    return { kind: "user", userId, label };
  }

  if (ctx.chat?.type === "private") {
    return { kind: "general" };
  }

  const groupId = resolveGroupChatId(ctx);
  if (groupId) {
    return { kind: "group", groupId };
  }

  return null;
}

function resolveCommandInlineOrReplyText(
  ctx: Context,
  inline: string,
): string | null {
  const text = inline.trim();
  if (text) return text;

  const replied = ctx.message?.reply_to_message;
  if (!replied) return null;

  const summary = summarizeMessageContent(replied).trim();
  if (!summary || summary === "[message]") return null;
  return summary;
}

function extractText(ctx: Context): string {
  const msg = ctx.message;
  if (!msg) return "";
  return (msg.text ?? msg.caption ?? "").trim();
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
