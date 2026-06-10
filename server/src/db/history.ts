import type { DatabaseSync } from "node:sqlite";
import type { ChatMessage } from "../llm/client.js";
import { stripAssistantHistoryEnvelope } from "../bot/history-format.js";
import type { Settings } from "./database.js";
import { getHistoryLimits } from "../settings-limits.js";
export const ASSISTANT_ROLE = "assistant";
export const COMPRESSED_ROLE = "compressed";
const HISTORY_RETENTION_MULTIPLIER = 2;

let readSettings: () => Settings = () => {
  throw new Error("History module not initialized");
};

export function configureHistoryAccess(getSettings: () => Settings): void {
  readSettings = getSettings;
}

export interface StoredMessage {
  role: string;
  content: string;
}

export function isCompressedRole(role: string): boolean {
  return role === COMPRESSED_ROLE;
}

let db: DatabaseSync;

export function bindHistoryDatabase(database: DatabaseSync): void {
  db = database;
  const existing = db
    .prepare(
      `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'chat_messages'`,
    )
    .get() as { sql: string } | undefined;

  const needsReset =
    existing?.sql.includes("CHECK (role IN ('user', 'assistant'))") ?? false;

  if (needsReset) {
    db.exec(`DROP TABLE IF EXISTS chat_messages`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_key TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_chat_messages_key_id
      ON chat_messages (chat_key, id);
  `);
}

export interface ConversationKeyOptions {
  threadId?: number;
}

/** Chat id for DM or group. Forum topics share the group key (no thread suffix). */
export function conversationKey(
  chatId: number,
  _options?: ConversationKeyOptions,
): string {
  return String(chatId);
}

export function threadIdFromChatKey(
  chatKey: string,
  chatId: number,
): number | undefined {
  const parts = chatKey.split(":");
  if (parts[0] !== String(chatId) || parts.length < 2) return undefined;
  const threadId = Number(parts[1]);
  return Number.isInteger(threadId) && threadId > 0 ? threadId : undefined;
}

export function getHistory(chatKey: string): StoredMessage[] {
  const { historyMaxMessages } = getHistoryLimits(readSettings());
  const rows = selectLatestHistoryRows(chatKey, historyMaxMessages);
  if (rows.some((m) => isCompressedRole(m.role))) return rows.reverse();

  const compressed = db
    .prepare(
      `SELECT role, content FROM chat_messages
       WHERE chat_key = ? AND role = ?
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get(chatKey, COMPRESSED_ROLE) as StoredMessage | undefined;

  if (!compressed) return rows.reverse();

  return [
    compressed,
    ...rows.slice(0, Math.max(0, historyMaxMessages - 1)).reverse(),
  ];
}

export function getHistoryForCompression(chatKey: string): StoredMessage[] {
  const { historyMaxMessages } = getHistoryLimits(readSettings());
  const limit = historyMaxMessages * HISTORY_RETENTION_MULTIPLIER;
  const rows = selectLatestHistoryRows(chatKey, limit);
  if (rows.some((m) => isCompressedRole(m.role))) return rows.reverse();

  const compressed = db
    .prepare(
      `SELECT role, content FROM chat_messages
       WHERE chat_key = ? AND role = ?
       ORDER BY id DESC
       LIMIT 1`,
    )
    .get(chatKey, COMPRESSED_ROLE) as StoredMessage | undefined;

  return compressed ? [compressed, ...rows.reverse()] : rows.reverse();
}

export function appendMessage(
  chatKey: string,
  role: string,
  content: string,
): void {
  const trimmed = content.trim();
  if (!trimmed) return;

  let stored = trimmed;
  if (role === ASSISTANT_ROLE) {
    const { historyMaxReplyChars } = getHistoryLimits(readSettings());
    if (stored.length > historyMaxReplyChars) {
      stored = `${stored.slice(0, historyMaxReplyChars)}…`;
    }
  }

  db.prepare(
    `INSERT INTO chat_messages (chat_key, role, content) VALUES (?, ?, ?)`,
  ).run(chatKey, role, stored);

  pruneHistory(chatKey);
}

export function clearHistory(chatKey: string): void {
  db.prepare(`DELETE FROM chat_messages WHERE chat_key = ?`).run(chatKey);
}

export function historyTotalChars(history: StoredMessage[]): number {
  return history.reduce((n, m) => n + m.content.length, 0);
}

export function replaceHistory(
  chatKey: string,
  messages: StoredMessage[],
): void {
  db.exec("BEGIN IMMEDIATE");
  try {
    clearHistory(chatKey);
    const insert = db.prepare(
      `INSERT INTO chat_messages (chat_key, role, content) VALUES (?, ?, ?)`,
    );
    for (const msg of messages) {
      const trimmed = msg.content.trim();
      if (!trimmed) continue;
      insert.run(chatKey, msg.role, trimmed);
    }
    pruneHistory(chatKey);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

function pruneHistory(chatKey: string): void {
  const { historyMaxMessages } = getHistoryLimits(readSettings());
  const retentionLimit = historyMaxMessages * HISTORY_RETENTION_MULTIPLIER;
  db.prepare(
    `DELETE FROM chat_messages
     WHERE chat_key = ? AND role != ? AND id NOT IN (
       SELECT id FROM chat_messages
       WHERE chat_key = ?
       ORDER BY id DESC
       LIMIT ?
     )`,
  ).run(chatKey, COMPRESSED_ROLE, chatKey, retentionLimit);
}

function selectLatestHistoryRows(
  chatKey: string,
  limit: number,
): StoredMessage[] {
  return db
    .prepare(
      `SELECT role, content FROM chat_messages
       WHERE chat_key = ?
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(chatKey, limit) as unknown as StoredMessage[];
}

export function trimForContext(
  history: StoredMessage[],
): StoredMessage[] {
  const { historyMaxChars } = getHistoryLimits(readSettings());
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
    role: m.role === ASSISTANT_ROLE ? "assistant" : "user",
    content: isCompressedRole(m.role)
      ? `[compressed]: ${m.content}`
      : m.role === ASSISTANT_ROLE
        ? stripAssistantHistoryEnvelope(m.content)
        : m.content,
  }));
}

export function appendAssistantMessage(
  chatKey: string,
  assistantText: string,
): void {
  appendMessage(
    chatKey,
    ASSISTANT_ROLE,
    `[assistant said]: ${assistantText.trim()}`,
  );
}
