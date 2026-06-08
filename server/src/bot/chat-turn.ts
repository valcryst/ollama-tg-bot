import type { Api, Context } from "grammy";
import type { ChatMessage } from "../ollama/client.js";
import { chatComplete } from "../ollama/client.js";
import { rememberMessageRef } from "../db/message-refs.js";
import {
  getSettings,
  recordError,
  recordReply,
  type ErrorLogInput,
} from "../db/database.js";
import { getActivePersonalityPrompt } from "../db/personalities.js";
import { getHistoryLimits } from "../settings-limits.js";
import { parseStructuredResponse } from "../response-format.js";
import { sanitizeModelOutput } from "../ollama/sanitize.js";
import { prepareTelegramHtml } from "../telegram/html.js";
import {
  formatTavilyContext,
  formatTavilyFailure,
  isTavilyConfigured,
  tavilySearch,
} from "../tavily/client.js";
import { resolveLinkFetchContext } from "./link-fetch.js";
import { analyzeSearchNeed } from "./search-analyze.js";
import {
  buildChatMessages,
  recordExchange,
  type CurrentSpeaker,
} from "./conversation.js";
import { scheduleMemoryPersistence } from "../memory-extract.js";
import type { MemoryExtractInput } from "../memory-extract.js";
import { getOwnerUserId, getOwnerUsername } from "./owner.js";
import { replyParameters } from "./replies.js";
import { logEvent, logEventError } from "../event-log.js";
import {
  analyzeStickerForReply,
  shouldTryStickerReply,
} from "./sticker-analyze.js";
import { resolveStickerFileId } from "./sticker-catalog.js";
import { getHistory, historyToChatMessages } from "../db/history.js";
import { getEffectiveMood, saveMoodState } from "../db/mood.js";
import { evaluateMood } from "../mood-evaluate.js";

export type ChatTurnMemoryInput = Omit<MemoryExtractInput, "assistantReply">;

const TYPING_REFRESH_MS = 4000;

export interface ChatTurnInput {
  convKey: string;
  chatId: number;
  userId: string | null;
  groupChatId: string | null;
  inGroup: boolean;
  latestBody: string;
  userRole: string | null;
  userHistoryContent: string | null;
  skipUserHistory?: boolean;
  userMemoryFacts: string[];
  groupMemoryFacts: string[];
  generalMemoryFacts: string[];
  memoryInput: ChatTurnMemoryInput;
  currentSpeaker?: CurrentSpeaker | null;
  currentSpeakerIsOwner?: boolean;
  replyContext?: string | null;
  mentionedUsersContext?: string | null;
  replyToMessageId?: number;
  messageThreadId?: number;
}

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

function startTypingIndicator(
  api: Api,
  chatId: number,
  messageThreadId?: number,
): () => void {
  const refresh = () => {
    void api
      .sendChatAction(chatId, "typing", {
        ...(messageThreadId ? { message_thread_id: messageThreadId } : {}),
      })
      .catch(() => {});
  };
  refresh();
  const timer = setInterval(refresh, TYPING_REFRESH_MS);
  return () => clearInterval(timer);
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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildReplyExtra(
  ctx: Context,
  options?: { replyToMessageId?: number; messageThreadId?: number },
): Parameters<Context["reply"]>[1] {
  const extra: Parameters<Context["reply"]>[1] = {};
  if (options?.messageThreadId) {
    extra.message_thread_id = options.messageThreadId;
  }
  const replyParams = options?.replyToMessageId
    ? { message_id: options.replyToMessageId }
    : replyParameters(ctx);
  if (replyParams) extra.reply_parameters = replyParams;
  return Object.keys(extra).length > 0 ? extra : undefined;
}

export async function runChatTurn(
  ctx: Context,
  input: ChatTurnInput,
): Promise<void> {
  const settings = getSettings();
  const stopTyping = startTypingIndicator(
    ctx.api,
    input.chatId,
    input.messageThreadId,
  );

  const turnLog = {
    chatId: input.chatId,
    userId: input.userId,
    groupId: input.groupChatId,
    convKey: input.convKey,
    inGroup: input.inGroup,
  };

  try {
    logEvent("chat_turn_started", turnLog);

    let linkFetchContext: string | null = null;
    const linkFetch = await resolveLinkFetchContext({
      userMessage: input.latestBody,
      replyContext: input.replyContext,
    });
    if (linkFetch.urlCount > 0) {
      logEvent("link_fetch_triggered", {
        ...turnLog,
        urlCount: linkFetch.urlCount,
      });
      linkFetchContext = linkFetch.context;
    } else {
      logEvent("link_fetch_skipped", turnLog);
    }

    let webSearchContext: string | null = null;
    if (isTavilyConfigured() && !linkFetch.resolved) {
      const decision = await analyzeSearchNeed({
        userMessage: input.latestBody,
        replyContext: input.replyContext,
      });
      if (decision.needsSearch && decision.query) {
        logEvent("web_search_triggered", { ...turnLog, queryLen: decision.query.length });
        try {
          const payload = await tavilySearch(decision.query);
          webSearchContext = formatTavilyContext(decision.query, payload);
          logEvent("web_search_done", {
            ...turnLog,
            sourceCount: payload.results.length,
            hasSummary: Boolean(payload.answer),
          });
        } catch (err) {
          logEventError("web_search_failed", err, turnLog);
          webSearchContext = formatTavilyFailure(decision.query, err);
        }
      } else {
        logEvent("web_search_skipped", turnLog);
      }
    } else if (isTavilyConfigured() && linkFetch.resolved) {
      logEvent("web_search_skipped", { ...turnLog, reason: "link_fetch_resolved" });
    }

    const storedHistory = getHistory(input.convKey);
    const historyMessages = historyToChatMessages(storedHistory);
    const moodContextText = historyMessages
      .map((m) => `${m.role}: ${m.content}`)
      .join("\n\n");

    const latestTurnPreview = [
      input.mentionedUsersContext,
      input.replyContext,
      linkFetchContext,
      webSearchContext,
      input.latestBody,
    ]
      .filter((part) => part?.trim())
      .join("\n\n");

    logEvent("mood_evaluate_started", turnLog);
    const decayedMood = getEffectiveMood();
    const evaluatedMood = await evaluateMood({
      currentMood: decayedMood,
      historyText: moodContextText,
      latestTurn: latestTurnPreview,
    });
    saveMoodState(evaluatedMood);
    logEvent("mood_evaluate_done", {
      ...turnLog,
      moodSummary: JSON.stringify(evaluatedMood),
    });

    logEvent("ollama_reply_started", turnLog);
    const built = buildChatMessages(
      getActivePersonalityPrompt(),
      input.convKey,
      {
        body: input.latestBody,
        speakerTag: input.userRole,
        mentionedUsersContext: input.mentionedUsersContext,
        replyContext: input.replyContext,
        linkFetchContext,
        webSearchContext,
        currentSpeaker: input.currentSpeaker,
        currentSpeakerIsOwner: input.currentSpeakerIsOwner,
        isGroupChat: input.inGroup,
      },
      {
        settings,
        isGroupChat: input.inGroup,
        groupMemoryFacts: input.groupMemoryFacts,
        generalMemoryFacts: input.generalMemoryFacts,
        currentUserId: input.userId,
        ownerUserId: getOwnerUserId(),
        ownerUsername: getOwnerUsername(),
        mood: evaluatedMood,
      },
    );

    const historyLimits = getHistoryLimits(settings);
    const injectedChars = built.historyMessages.reduce(
      (n, m) => n + m.content.length,
      0,
    );
    logEvent("history_injected", {
      ...turnLog,
      injectedMessages: built.historyMessages.length,
      storedMessages: built.storedHistoryCount,
      maxMessages: historyLimits.historyMaxMessages,
      maxChars: historyLimits.historyMaxChars,
      injectedChars,
      charTrimmed:
        built.storedHistoryCount > 0 &&
        built.historyMessages.length < built.storedHistoryCount,
      latestChars: built.latestContent.length,
    });

    const modelOutput = await chatComplete(built.messages, {
      verboseLabel: "main reply",
      verboseLayout: {
        system: built.systemContent,
        history: built.historyMessages,
        latest: built.latestContent,
      },
    });
    logEvent("ollama_reply_done", {
      ...turnLog,
      outputChars: modelOutput.length,
    });

    let { reply: replyBody } = parseStructuredResponse(modelOutput);

    if (!replyBody.trim()) {
      replyBody = sanitizeModelOutput(modelOutput) || modelOutput.trim();
    }
    if (!replyBody.trim()) {
      throw new Error("Model response had no [REPLY] content");
    }

    let stickerEmoji: string | null = null;
    if (
      settings.stickersEnabled &&
      shouldTryStickerReply(settings.stickerReplyChance)
    ) {
      logEvent("sticker_analyze_started", turnLog);
      stickerEmoji = await analyzeStickerForReply({
        userMessage: input.latestBody,
        botReply: replyBody,
        replyContext: input.replyContext,
      });
      logEvent("sticker_analyze_done", {
        ...turnLog,
        picked: stickerEmoji ?? undefined,
      });
    }

    const stickerFileId = stickerEmoji
      ? resolveStickerFileId(stickerEmoji)
      : null;
    if (stickerEmoji && settings.stickersEnabled && !stickerFileId) {
      logEvent("sticker_resolve_failed", {
        ...turnLog,
        emoji: stickerEmoji,
      });
    }

    const historyText =
      stickerEmoji && replyBody.trim()
        ? `${replyBody}\n[sticker: ${stickerEmoji}]`
        : stickerEmoji
          ? `[sticker: ${stickerEmoji}]`
          : replyBody;

    const reply = replyBody.trim() ? prepareTelegramHtml(replyBody) : "";
    recordExchange(
      input.convKey,
      input.userRole,
      input.userHistoryContent,
      historyText,
      { skipUser: input.skipUserHistory },
    );
    const chunks = reply ? splitMessage(reply) : [];

    const replyExtra = buildReplyExtra(ctx, {
      replyToMessageId: input.replyToMessageId,
      messageThreadId: input.messageThreadId,
    });

    for (let i = 0; i < chunks.length; i++) {
      if (i > 0) {
        await ctx.api.sendChatAction(input.chatId, "typing");
      }
      const sent = await replyHtml(ctx, chunks[i], replyExtra);
      rememberMessageRef(
        input.convKey,
        sent.message_id,
        "assistant",
        historyText,
        "Bot",
      );
    }

    if (stickerFileId) {
      const stickerExtra: Parameters<Context["reply"]>[1] = {};
      if (input.messageThreadId) {
        stickerExtra.message_thread_id = input.messageThreadId;
      }
      if (chunks.length === 0 && replyExtra?.reply_parameters) {
        stickerExtra.reply_parameters = replyExtra.reply_parameters;
      }
      const sentSticker = await ctx.api.sendSticker(
        input.chatId,
        stickerFileId,
        Object.keys(stickerExtra).length > 0 ? stickerExtra : undefined,
      );
      rememberMessageRef(
        input.convKey,
        sentSticker.message_id,
        "assistant",
        `[sticker: ${stickerEmoji}]`,
        "Bot",
      );
    }

    recordReply(false);
    logEvent("reply_sent", {
      ...turnLog,
      chunkCount: chunks.length,
      replyChars: replyBody.length,
      sticker: stickerEmoji ?? undefined,
      skipUserHistory: Boolean(input.skipUserHistory),
    });

    scheduleMemoryPersistence({
      userId: input.userId,
      groupChatId: input.groupChatId,
      input: { ...input.memoryInput, assistantReply: historyText },
    });
  } catch (err) {
    logEventError("reply_failed", err, turnLog);
    const detail: ErrorLogInput = {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      chatId: input.chatId,
      userId: input.userId ?? undefined,
    };
    recordError(detail);
    const msg =
      err instanceof Error ? err.message : "Something went wrong";
    const errReplyExtra = buildReplyExtra(ctx, {
      replyToMessageId: input.replyToMessageId,
      messageThreadId: input.messageThreadId,
    });
    await replyHtml(
      ctx,
      `Sorry, I could not get a response from Ollama.\n\n<code>${escapeHtml(msg)}</code>`,
      errReplyExtra,
    ).catch(async () => {
      await replyHtml(
        ctx,
        "Sorry, I could not get a response from Ollama.",
        errReplyExtra,
      ).catch((e) => console.error("Failed to send fallback reply:", e));
    });
  } finally {
    stopTyping();
  }
}
