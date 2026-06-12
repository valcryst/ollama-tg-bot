import type { DebugChatSummary, MessageReportListItem } from "../../api";

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function statusClass(status: string): string {
  if (status === "processed") return "ok";
  if (status === "processing") return "warn";
  if (status === "error") return "danger";
  return "warn";
}

export function upsertListItem(
  items: MessageReportListItem[],
  next: MessageReportListItem,
): MessageReportListItem[] {
  const idx = items.findIndex((item) => item.id === next.id);
  const merged =
    idx >= 0
      ? [...items.slice(0, idx), next, ...items.slice(idx + 1)]
      : [next, ...items];
  return merged.sort((a, b) => b.id - a.id);
}

export function patchChatSummaries(
  chats: DebugChatSummary[],
  event: {
    chatId: string;
    listItem: MessageReportListItem | null;
  },
): DebugChatSummary[] {
  if (!event.listItem) return chats;

  const idx = chats.findIndex((chat) => chat.chatId === event.chatId);
  if (idx < 0) return chats;

  const chat = chats[idx];
  const next = [...chats];
  const latestMs = Date.parse(event.listItem.createdAt);
  const currentMs = chat.latestAt ? Date.parse(chat.latestAt) : 0;
  next[idx] = {
    ...chat,
    latestAt: latestMs >= currentMs ? event.listItem.createdAt : chat.latestAt,
  };
  return next.sort((a, b) => {
    const aTime = a.latestAt ? Date.parse(a.latestAt) : 0;
    const bTime = b.latestAt ? Date.parse(b.latestAt) : 0;
    return bTime - aTime;
  });
}
