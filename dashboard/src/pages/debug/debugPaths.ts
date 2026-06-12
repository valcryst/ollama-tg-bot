export function debugChatPath(chatId: string): string {
  return `/debug/${encodeURIComponent(chatId)}`;
}

export function debugMessagePath(chatId: string, messageId: number): string {
  return `/debug/${encodeURIComponent(chatId)}/${messageId}`;
}

export function decodeRouteChatId(chatId: string | undefined): string | null {
  if (!chatId) return null;
  try {
    return decodeURIComponent(chatId);
  } catch {
    return chatId;
  }
}

export function parseRouteMessageId(
  messageId: string | undefined,
): number | null {
  if (!messageId) return null;
  const parsed = Number(messageId);
  if (!Number.isInteger(parsed) || parsed <= 0) return null;
  return parsed;
}
