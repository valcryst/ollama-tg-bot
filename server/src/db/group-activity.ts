import type { DatabaseSync } from "node:sqlite";

const MAX_ACTIVITY_PER_CHAT = 80;

export type GroupActivityRole = "member" | "assistant";

export interface GroupActivityEntry {
  role: GroupActivityRole;
  senderLabel: string;
  content: string;
  telegramMessageId: number;
}

let db: DatabaseSync;

export function bindGroupActivityDatabase(database: DatabaseSync): void {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS group_activity (
      chat_key TEXT NOT NULL,
      telegram_message_id INTEGER NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('member', 'assistant')),
      sender_label TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (chat_key, telegram_message_id)
    );
    CREATE INDEX IF NOT EXISTS idx_group_activity_chat_created
      ON group_activity (chat_key, created_at);
  `);
}

export function recordGroupActivity(
  chatKey: string,
  telegramMessageId: number,
  role: GroupActivityRole,
  senderLabel: string,
  content: string,
): void {
  const trimmed = content.trim();
  if (!trimmed || telegramMessageId < 1 || !senderLabel.trim()) return;

  const stored =
    trimmed.length > 800 ? `${trimmed.slice(0, 800)}…` : trimmed;

  db.prepare(
    `INSERT INTO group_activity
       (chat_key, telegram_message_id, role, sender_label, content)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(chat_key, telegram_message_id) DO UPDATE SET
       role = excluded.role,
       sender_label = excluded.sender_label,
       content = excluded.content,
       created_at = unixepoch()`,
  ).run(chatKey, telegramMessageId, role, senderLabel.trim(), stored);

  pruneGroupActivity(chatKey);
}

export function getRecentGroupActivity(
  chatKey: string,
  limit = 20,
  excludeMessageId?: number,
): GroupActivityEntry[] {
  const capped = Math.min(Math.max(1, limit), 40);
  const rows = db
    .prepare(
      `SELECT role, sender_label, content, telegram_message_id
       FROM group_activity
       WHERE chat_key = ?
         AND (? IS NULL OR telegram_message_id != ?)
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(
      chatKey,
      excludeMessageId ?? null,
      excludeMessageId ?? null,
      capped,
    ) as Array<{
      role: GroupActivityRole;
      sender_label: string;
      content: string;
      telegram_message_id: number;
    }>;

  return rows.reverse().map((row) => ({
    role: row.role,
    senderLabel: row.sender_label,
    content: row.content,
    telegramMessageId: row.telegram_message_id,
  }));
}

function pruneGroupActivity(chatKey: string): void {
  db.prepare(
    `DELETE FROM group_activity
     WHERE chat_key = ? AND telegram_message_id NOT IN (
       SELECT telegram_message_id FROM group_activity
       WHERE chat_key = ?
       ORDER BY created_at DESC
       LIMIT ?
     )`,
  ).run(chatKey, chatKey, MAX_ACTIVITY_PER_CHAT);
}
