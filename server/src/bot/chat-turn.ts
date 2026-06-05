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
import { parseStructuredResponse } from "../response-format.js";
import { sanitizeModelOutput } from "../ollama/sanitize.js";
import { prepareTelegramHtml } from "../telegram/html.js";
import {
  formatTavilyContext,
  formatTavilyFailure,
  isTavilyConfigured,
  tavilySearch,
} from "../tavily/client.js";
import { analyzeSearchNeed } from "./search-analyze.js";
import {
  buildChatMessages,
  recordExchange,
  type CurrentSpeaker,
} from "./conversation.js";
import { scheduleMemoryPersistence } from "../memory-extract.js";
import type { MemoryExtractInput } from "../memory-extract.js";

export type ChatTurnMemoryInput = Omit<MemoryExtractInput, "assistantReply">;
import { getOwnerUserId, getOwnerUsername } from "./owner.js";
import { replyParameters } from "./replies.js";
import { resolveGroupActivityKey } from "./group-activity.js";

const TYPING_REFRESH_MS = 4000;

export interface ChatTurnInput {
  convKey: string;
  chatId: number;
  userId: string | null;
  groupChatId: string | null;
  inGroup: boolean;
  currentUser: ChatMessage;
  historyLabel: string;
  userMemoryFacts: string[];
  groupMemoryFacts: string[];
  generalMemoryFacts: string[];
  memoryInput: ChatTurnMemoryInput;
  currentSpeaker?: CurrentSpeaker | null;
  currentSpeakerIsOwner?: boolean;
  replyContext?: string | null;
  groupActivityContext?: string | null;
  usedVision?: boolean;
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

/** Run Ollama, reply in Telegram, update history/memory refs. */
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

  try {
    let webSearchContext: string | null = null;
    if (isTavilyConfigured()) {
      const decision = await analyzeSearchNeed({
        userMessage: input.currentUser.content,
        replyContext: input.replyContext,
      });
      if (decision.needsSearch && decision.query) {
        try {
          const payload = await tavilySearch(decision.query);
          webSearchContext = formatTavilyContext(decision.query, payload);
          console.log(
            `Tavily: ${payload.results.length} source(s)` +
              (payload.answer ? ", with summary" : "") +
              ` for "${decision.query}"`,
          );
        } catch (err) {
          console.error("Tavily search failed:", err);
          webSearchContext = formatTavilyFailure(decision.query, err);
        }
      }
    }

    const messages = buildChatMessages(
      settings.customSystemPrompt,
      input.convKey,
      input.currentUser,
      input.userMemoryFacts,
      input.replyContext,
      {
        isGroupChat: input.inGroup,
        groupMemoryFacts: input.groupMemoryFacts,
        generalMemoryFacts: input.generalMemoryFacts,
        currentSpeaker: input.currentSpeaker,
        currentSpeakerIsOwner: input.currentSpeakerIsOwner,
        webSearchContext,
        groupActivityContext: input.groupActivityContext,
        ownerUserId: getOwnerUserId(),
        ownerUsername: getOwnerUsername(),
      },
    );

    const modelOutput = await chatComplete(messages);
    let { reply: replyBody } = parseStructuredResponse(modelOutput);

    if (!replyBody.trim()) {
      replyBody = sanitizeModelOutput(modelOutput) || modelOutput.trim();
    }
    if (!replyBody.trim()) {
      throw new Error("Model response had no [REPLY] content");
    }

    const reply = prepareTelegramHtml(replyBody);
    recordExchange(input.convKey, input.historyLabel, replyBody);
    const chunks = splitMessage(reply);

    const replyExtra = buildReplyExtra(ctx, {
      replyToMessageId: input.replyToMessageId,
      messageThreadId: input.messageThreadId,
    });

    for (let i = 0; i < chunks.length; i++) {
      if (i > 0) {
        await ctx.api.sendChatAction(input.chatId, "typing");
      }
      const sent = await replyHtml(ctx, chunks[i], replyExtra);
      const refKey = input.inGroup
        ? (resolveGroupActivityKey(ctx) ?? input.convKey)
        : input.convKey;
      rememberMessageRef(
        refKey,
        sent.message_id,
        "assistant",
        replyBody,
        input.inGroup ? "Bot" : null,
      );
    }

    recordReply(input.usedVision ?? false);

    scheduleMemoryPersistence({
      userId: input.userId,
      groupChatId: input.groupChatId,
      input: { ...input.memoryInput, assistantReply: replyBody },
    });
  } catch (err) {
    console.error("Chat turn error:", err);
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
