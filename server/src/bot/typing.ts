import type { Api } from "grammy";

const TYPING_REFRESH_MS = 3500;

export function startTypingIndicator(
  api: Api,
  chatId: number,
  messageThreadId?: number,
): () => void {
  const extra = messageThreadId ? { message_thread_id: messageThreadId } : {};
  const refresh = () => {
    void api.sendChatAction(chatId, "typing", extra).catch(() => {});
  };

  refresh();
  const timer = setInterval(refresh, TYPING_REFRESH_MS);
  return () => clearInterval(timer);
}
