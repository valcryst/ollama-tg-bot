import type { Api, Context } from "grammy";

const TYPING_REFRESH_MS = 3500;

/** Telegram's internal id for the General forum topic. */
export const TELEGRAM_GENERAL_TOPIC_ID = 1;

export type TypingThreadParams = { message_thread_id?: number };

/**
 * Params for sendChatAction. Forum General-topic messages omit message_thread_id,
 * but typing only appears when message_thread_id=1 is sent explicitly.
 * sendMessage must omit thread id for General — see buildReplyExtra.
 */
export function resolveTypingThreadParams(
  chat: { type?: string; is_forum?: boolean } | undefined,
  messageThreadId?: number,
): TypingThreadParams {
  if (messageThreadId != null) {
    return { message_thread_id: messageThreadId };
  }
  if (chat?.type === "supergroup" && chat.is_forum) {
    return { message_thread_id: TELEGRAM_GENERAL_TOPIC_ID };
  }
  return {};
}

/** sendMessage omits General-topic thread id; sendChatAction requires it. */
export function messageThreadExtra(
  params: TypingThreadParams,
): TypingThreadParams | undefined {
  if (!params.message_thread_id) return undefined;
  if (params.message_thread_id === TELEGRAM_GENERAL_TOPIC_ID) return undefined;
  return params;
}

export function startTypingIndicator(
  api: Api,
  chatId: number,
  threadParams: TypingThreadParams = {},
): () => void {
  const refresh = () => {
    void api.sendChatAction(chatId, "typing", threadParams).catch(() => {});
  };

  refresh();
  const timer = setInterval(refresh, TYPING_REFRESH_MS);
  return () => clearInterval(timer);
}

export function startTypingForMessage(ctx: Context): (() => void) | null {
  const chatId = ctx.chat?.id;
  if (!chatId) return null;
  return startTypingIndicator(
    ctx.api,
    chatId,
    resolveTypingThreadParams(ctx.chat, ctx.message?.message_thread_id),
  );
}
