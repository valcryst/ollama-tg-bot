import type { DatabaseSync } from "node:sqlite";
import type { ChatMessage } from "../ollama/client.js";
import type { Settings } from "./database.js";

let readSettings: () => Settings = () => {
  throw new Error("History module not initialized");
};

export function configureHistoryAccess(getSettings: () => Settings): void {
  readSettings = getSettings;
}

export type HistoryRole = "user" | "assistant";

export interface StoredMessage {
  role: HistoryRole;
  content: string;
}

let db: DatabaseSync;

export function bindHistoryDatabase(database: DatabaseSync): void {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_key TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_key_id
      ON chat_messages (chat_key, id);
  `);
}

export function conversationKey(chatId: number, threadId?: number): string {
  return threadId != null ? `${chatId}:${threadId}` : String(chatId);
}

export function getHistory(chatKey: string): StoredMessage[] {
  const { historyMaxMessages } = readSettings();
  const rows = db
    .prepare(
      `SELECT role, content FROM chat_messages
       WHERE chat_key = ?
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(chatKey, historyMaxMessages) as unknown as StoredMessage[];

  return rows.reverse();
}

export function appendMessage(
  chatKey: string,
  role: HistoryRole,
  content: string,
): void {
  let trimmed = content.trim();
  if (!trimmed) return;

  const { historyMaxReplyChars } = readSettings();
  if (role === "assistant" && trimmed.length > historyMaxReplyChars) {
    trimmed = `${trimmed.slice(0, historyMaxReplyChars)}…`;
  }

  db.prepare(
    `INSERT INTO chat_messages (chat_key, role, content) VALUES (?, ?, ?)`,
  ).run(chatKey, role, trimmed);

  pruneHistory(chatKey);
}

export function clearHistory(chatKey: string): void {
  db.prepare(`DELETE FROM chat_messages WHERE chat_key = ?`).run(chatKey);
}

function pruneHistory(chatKey: string): void {
  const { historyMaxMessages } = readSettings();
  db.prepare(
    `DELETE FROM chat_messages
     WHERE chat_key = ? AND id NOT IN (
       SELECT id FROM chat_messages
       WHERE chat_key = ?
       ORDER BY id DESC
       LIMIT ?
     )`,
  ).run(chatKey, chatKey, historyMaxMessages);
}

/** Trim from the start until total character count fits the context budget. */
export function trimForContext(
  history: StoredMessage[],
): StoredMessage[] {
  const { historyMaxChars } = readSettings();
  let total = history.reduce((n, m) => n + m.content.length, 0);
  const kept = [...history];

  while (kept.length > 1 && total > historyMaxChars) {
    const removed = kept.shift();
    if (removed) total -= removed.content.length;
  }

  return kept;
}

export function historyToChatMessages(history: StoredMessage[]): ChatMessage[] {
  return trimForContext(history).map((m) => ({
    role: m.role,
    content: m.content,
  }));
}
