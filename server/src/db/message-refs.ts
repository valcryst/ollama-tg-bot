import type { DatabaseSync } from "node:sqlite";

const MAX_REFS_PER_CHAT = 80;

export type MessageRefRole = "user" | "assistant";

export interface MessageRef {
  role: MessageRefRole;
  content: string;
}

let db: DatabaseSync;

export function bindMessageRefsDatabase(database: DatabaseSync): void {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_refs (
      chat_key TEXT NOT NULL,
      telegram_message_id INTEGER NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (chat_key, telegram_message_id)
    );
    CREATE INDEX IF NOT EXISTS idx_message_refs_chat_created
      ON message_refs (chat_key, created_at);
    CREATE INDEX IF NOT EXISTS idx_message_refs_message_id
      ON message_refs (telegram_message_id);
  `);
}

function baseChatKey(chatKey: string): string | null {
  const colon = chatKey.indexOf(":");
  return colon > 0 ? chatKey.slice(0, colon) : null;
}

export function rememberMessageRef(
  chatKey: string,
  telegramMessageId: number,
  role: MessageRefRole,
  content: string,
): void {
  const trimmed = content.trim();
  if (!trimmed || telegramMessageId < 1) return;

  const stored =
    trimmed.length > 1200 ? `${trimmed.slice(0, 1200)}…` : trimmed;

  const insert = db.prepare(
    `INSERT INTO message_refs (chat_key, telegram_message_id, role, content)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(chat_key, telegram_message_id) DO UPDATE SET
       role = excluded.role,
       content = excluded.content,
       created_at = unixepoch()`,
  );
  insert.run(chatKey, telegramMessageId, role, stored);
  pruneMessageRefs(chatKey);

  const baseKey = baseChatKey(chatKey);
  if (baseKey && baseKey !== chatKey) {
    insert.run(baseKey, telegramMessageId, role, stored);
    pruneMessageRefs(baseKey);
  }
}

export function getMessageRef(
  chatKey: string,
  telegramMessageId: number,
): MessageRef | null {
  const row = db
    .prepare(
      `SELECT role, content FROM message_refs
       WHERE chat_key = ? AND telegram_message_id = ?`,
    )
    .get(chatKey, telegramMessageId) as
    | { role: MessageRefRole; content: string }
    | undefined;

  return row ?? null;
}

export interface MessageRefMatch {
  chatKey: string;
  role: MessageRefRole;
  content: string;
}

/** Find a stored ref by chat id (includes forum topic keys). */
export function findMessageRefInChat(
  chatId: number,
  telegramMessageId: number,
): MessageRefMatch | null {
  const chatKey = String(chatId);
  const row = db
    .prepare(
      `SELECT chat_key, role, content FROM message_refs
       WHERE telegram_message_id = ?
         AND (chat_key = ? OR chat_key LIKE ?)
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(telegramMessageId, chatKey, `${chatId}:%`) as
    | { chat_key: string; role: MessageRefRole; content: string }
    | undefined;

  if (!row) return null;
  return {
    chatKey: row.chat_key,
    role: row.role,
    content: row.content,
  };
}

function pruneMessageRefs(chatKey: string): void {
  db.prepare(
    `DELETE FROM message_refs
     WHERE chat_key = ? AND telegram_message_id NOT IN (
       SELECT telegram_message_id FROM message_refs
       WHERE chat_key = ?
       ORDER BY created_at DESC
       LIMIT ?
     )`,
  ).run(chatKey, chatKey, MAX_REFS_PER_CHAT);
}
