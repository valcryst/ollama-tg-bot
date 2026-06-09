import type { Api, Context } from "grammy";

const MAX_MESSAGE_CHARS = 4000;

function splitText(text: string, maxLen = MAX_MESSAGE_CHARS): string[] {
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

function formatThinkingChunk(chunk: string, part: number, total: number): string {
  const title =
    total > 1 ? `<b>Thinking (${part}/${total})</b>` : "<b>Thinking</b>";
  return `${title}\n<pre>${escapeHtml(chunk)}</pre>`;
}

async function sendHtmlMessage(
  api: Api,
  chatId: number,
  text: string,
  extra?: { message_thread_id?: number },
): Promise<void> {
  try {
    await api.sendMessage(chatId, text, {
      parse_mode: "HTML",
      ...extra,
    });
  } catch {
    await api.sendMessage(chatId, text, extra);
  }
}

/** Send thinking to Telegram without storing it in chat history. */
export async function sendThinkingMessages(
  ctx: Context,
  chatId: number,
  thinking: string,
  messageThreadId?: number,
): Promise<number> {
  const trimmed = thinking.trim();
  if (!trimmed) return 0;

  const extra = messageThreadId
    ? { message_thread_id: messageThreadId }
    : undefined;
  const chunks = splitText(trimmed);
  for (let i = 0; i < chunks.length; i++) {
    if (i > 0) {
      await ctx.api.sendChatAction(chatId, "typing", extra).catch(() => {});
    }
    await sendHtmlMessage(
      ctx.api,
      chatId,
      formatThinkingChunk(chunks[i], i + 1, chunks.length),
      extra,
    );
  }
  return chunks.length;
}
