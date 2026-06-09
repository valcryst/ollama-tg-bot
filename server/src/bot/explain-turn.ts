import type { Api, Context } from "grammy";
import type { ChatMessage } from "../ollama/client.js";
import { chatCompleteDetailed } from "../ollama/client.js";
import {
  getSettings,
  recordError,
  recordReply,
  type ErrorLogInput,
} from "../db/database.js";
import {
  getPersonalityById,
  resolveActivePersonalityId,
} from "../db/personalities.js";
import { getHistory, historyToChatMessages } from "../db/history.js";
import { extractTelegramReply } from "../response-format.js";
import {
  hasVisibleTelegramReply,
  prepareTelegramHtml,
} from "../telegram/html.js";
import { buildExplainSystemPrompt } from "../prompts.js";
import { sendThinkingMessages } from "./send-thinking.js";
import { recordExchange } from "./conversation.js";
import { replyParameters } from "./replies.js";
import { logEvent, logEventError } from "../event-log.js";

const TYPING_REFRESH_MS = 4000;

export interface ExplainTurnInput {
  convKey: string;
  chatId: number;
  userId: string | null;
  groupChatId: string | null;
  inGroup: boolean;
  question: string;
  userRole: string | null;
  userMemoryFacts: string[];
  groupMemoryFacts: string[];
  generalMemoryFacts: string[];
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
  options?: { messageThreadId?: number },
): Parameters<Context["reply"]>[1] {
  const extra: Parameters<Context["reply"]>[1] = {};
  if (options?.messageThreadId) {
    extra.message_thread_id = options.messageThreadId;
  }
  const replyParams = replyParameters(ctx);
  if (replyParams) extra.reply_parameters = replyParams;
  return Object.keys(extra).length > 0 ? extra : undefined;
}

export async function runExplainTurn(
  ctx: Context,
  input: ExplainTurnInput,
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
    logEvent("explain_turn_started", turnLog);

    const activeId = resolveActivePersonalityId(settings.activePersonalityId);
    const activePersonality = activeId ? getPersonalityById(activeId) : null;

    const system = buildExplainSystemPrompt({
      settings,
      activePersonalityName: activePersonality?.name ?? null,
      activePersonalityPrompt: activePersonality?.prompt ?? null,
      generalMemoryFacts: input.generalMemoryFacts,
      groupMemoryFacts: input.groupMemoryFacts,
      userMemoryFacts: input.userMemoryFacts,
      isGroupChat: input.inGroup,
    });

    const history = historyToChatMessages(getHistory(input.convKey));
    const latestContent = `Question: ${input.question.trim()}`;
    const messages: ChatMessage[] = [
      { role: "system", content: system },
      ...history,
      { role: "user", content: latestContent },
    ];

    logEvent("ollama_reply_started", { ...turnLog, mode: "explain" });
    const { raw: modelOutput, thinking } = await chatCompleteDetailed(messages, {
      think: true,
      verboseLabel: "explain",
      verboseLayout: {
        system,
        history,
        latest: latestContent,
      },
    });
    logEvent("ollama_reply_done", {
      ...turnLog,
      mode: "explain",
      outputChars: modelOutput.length,
    });

    const replyBody = extractTelegramReply(modelOutput, {
      thinkingMode: settings.thinkingEnabled,
    });
    if (!hasVisibleTelegramReply(replyBody)) {
      throw new Error("Model response had no [REPLY] content");
    }

    const userHistoryContent = `[explain] ${input.question.trim()}`;
    recordExchange(
      input.convKey,
      input.userRole,
      userHistoryContent,
      replyBody,
    );

    const reply = prepareTelegramHtml(replyBody);
    const chunks = splitMessage(reply);
    const replyExtra = buildReplyExtra(ctx, {
      messageThreadId: input.messageThreadId,
    });

    if (settings.thinkingEnabled && settings.sendThinkingEnabled && thinking) {
      const thinkingChunks = await sendThinkingMessages(
        ctx,
        input.chatId,
        thinking,
        input.messageThreadId,
      );
      if (thinkingChunks > 0) {
        logEvent("thinking_sent", {
          ...turnLog,
          mode: "explain",
          chunkCount: thinkingChunks,
          thinkingChars: thinking.length,
        });
      }
    }

    for (let i = 0; i < chunks.length; i++) {
      if (i > 0) {
        await ctx.api.sendChatAction(input.chatId, "typing");
      }
      await replyHtml(ctx, chunks[i], replyExtra);
    }

    recordReply(false);
    logEvent("reply_sent", {
      ...turnLog,
      mode: "explain",
      chunkCount: chunks.length,
      replyChars: replyBody.length,
    });
  } catch (err) {
    logEventError("explain_failed", err, turnLog);
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
      messageThreadId: input.messageThreadId,
    });
    await replyHtml(
      ctx,
      `Sorry, I could not get an explanation from Ollama.\n\n<code>${escapeHtml(msg)}</code>`,
      errReplyExtra,
    ).catch(async () => {
      await replyHtml(
        ctx,
        "Sorry, I could not get an explanation from Ollama.",
        errReplyExtra,
      ).catch((e) => console.error("Failed to send explain fallback reply:", e));
    });
  } finally {
    stopTyping();
  }
}
