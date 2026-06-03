import type { Api, Bot, Context } from "grammy";
import { chat, type ChatMessage } from "../ollama/client.js";
import { clearHistory } from "../db/history.js";
import {
  addUserFacts,
  clearUserMemory,
  getUserFacts,
} from "../db/user-memory.js";
import { parseStructuredResponse } from "../response-format.js";
import { sanitizeModelOutput } from "../ollama/sanitize.js";
import { prepareTelegramHtml } from "../telegram/html.js";
import {
  getSettings,
  recordError,
  recordMessageReceived,
  recordReply,
  type ErrorLogInput,
} from "../db/database.js";
import {
  buildChatMessages,
  historyUserLabel,
  recordExchange,
  resolveConversationKey,
  resolveUserId,
} from "./conversation.js";
import type { ImagePayload } from "./files.js";
import { downloadTelegramFile } from "./files.js";
import {
  loadStickerForVision,
  stickerUnavailableText,
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

/** Telegram clears typing after ~5s; refresh until stopped. */
const TYPING_REFRESH_MS = 4000;

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

function startTypingIndicator(api: Api, chatId: number): () => void {
  const refresh = () => {
    void api.sendChatAction(chatId, "typing").catch(() => {});
  };
  refresh();
  const timer = setInterval(refresh, TYPING_REFRESH_MS);
  return () => clearInterval(timer);
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
    const userMemoryFacts = userId ? getUserFacts(userId) : [];

    const stopTyping = startTypingIndicator(ctx.api, chatId);

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
      const botId = ctx.me?.id;
      const promptText =
        stripBotMention(text, ctx.me?.username) || text;
      const body = buildUserContent(promptText, usedVision, stickerVisionHint);
      const historyBase = historyUserLabel(
        promptText,
        usedVision,
        stickerVisionHint,
      );
      const replyContext = formatReplyContext(ctx, botId);
      const historyLabel = replyContext
        ? appendReplyContext(ctx, historyBase, botId)
        : historyBase;

      const currentUser: ChatMessage = {
        role: "user",
        content: body,
        ...(usedVision ? { images: images.map((i) => i.base64) } : {}),
      };

      const messages = buildChatMessages(
        settings.customSystemPrompt,
        convKey,
        currentUser,
        userMemoryFacts,
        replyContext,
      );

      const raw = await chat(messages);
      let { memoryFacts, reply: replyBody } = parseStructuredResponse(raw);

      if (!replyBody.trim()) {
        replyBody = sanitizeModelOutput(raw) || raw.trim();
      }
      if (!replyBody.trim()) {
        throw new Error("Model response had no [REPLY] content");
      }

      if (userId && memoryFacts.length > 0) {
        addUserFacts(userId, memoryFacts);
      }

      const reply = prepareTelegramHtml(replyBody);
      recordExchange(convKey, historyLabel, reply);
      const chunks = splitMessage(reply);

      for (let i = 0; i < chunks.length; i++) {
        if (i > 0) {
          await ctx.api.sendChatAction(chatId, "typing");
        }
        if (i === 0) {
          await replyToUser(ctx, chunks[i]);
        } else {
          await replyHtml(ctx, chunks[i]);
        }
      }

      recordReply(usedVision);
    } catch (err) {
      console.error("Handler error:", err);
      const detail: ErrorLogInput = {
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
        chatId,
        userId: userId ?? undefined,
      };
      recordError(detail);
      const msg =
        err instanceof Error ? err.message : "Something went wrong";
      await replyToUser(
        ctx,
        `Sorry, I could not get a response from Ollama.\n\n<code>${escapeHtml(msg)}</code>`,
      ).catch(async (replyErr) => {
        console.error("Failed to send error reply:", replyErr);
        await replyToUser(ctx, "Sorry, I could not get a response from Ollama.").catch(
          (err) => console.error("Failed to send fallback reply:", err),
        );
      });
    } finally {
      stopTyping();
    }
  });

  bot.on("my_chat_member", async (ctx) => {
    const chat = ctx.chat;
    if (!chat || (chat.type !== "group" && chat.type !== "supergroup")) return;

    const { old_chat_member: oldMember, new_chat_member: newMember } =
      ctx.myChatMember;
    if (!wasBotAddedToChat(oldMember.status, newMember.status)) return;

    try {
      await ctx.api.sendMessage(chat.id, groupSetupMessage(botUsername), {
        parse_mode: "HTML",
      });
    } catch (err) {
      console.error("Failed to send group setup message:", err);
    }
  });

  bot.command("start", async (ctx) => {
    const settings = getSettings();
    const inGroup =
      ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
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
        `• I learn facts about you (stored per user)\n\n` +
        `Current model: <code>${escapeHtml(settings.model)}</code>\n` +
        `Clear chat context: /reset@${botUsername} · Clear your memory: /forget@${botUsername}`,
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
}

function extractText(ctx: Context): string {
  const msg = ctx.message;
  if (!msg) return "";
  return (msg.text ?? msg.caption ?? "").trim();
}

function buildUserContent(
  text: string,
  usedVision: boolean,
  stickerHint?: string,
): string {
  if (text && stickerHint) return `${text}\n\n${stickerHint}`;
  if (text) return text;
  if (stickerHint) return stickerHint;
  if (usedVision) return "Describe what you see in this image.";
  return "Hello!";
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function splitMessage(text: string, maxLen = 4000): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > maxLen) {
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt < maxLen * 0.5) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}
