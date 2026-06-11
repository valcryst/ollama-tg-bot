import type { Context } from "grammy";

type SendMessageExtra = Exclude<
  Parameters<Context["api"]["sendMessage"]>[2],
  undefined
>;

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function splitMessage(text: string, maxLen = 3800): string[] {
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

/** Send backend-returned reasoning without storing it in chat history. */
export async function sendThinkingMessages(
  ctx: Context,
  chatId: number,
  thinking: string,
  extra?: SendMessageExtra,
): Promise<number> {
  const trimmed = thinking.trim();
  if (!trimmed) return 0;

  const chunks = splitMessage(trimmed);
  for (let i = 0; i < chunks.length; i++) {
    const prefix =
      chunks.length > 1 ? `Reasoning ${i + 1}/${chunks.length}:\n` : "Reasoning:\n";
    await ctx.api.sendMessage(chatId, `<i>${escapeHtml(prefix + chunks[i])}</i>`, {
      parse_mode: "HTML",
      ...extra,
    });
  }
  return chunks.length;
}
