import type { DatabaseSync } from "node:sqlite";

const MAX_REFS_PER_CHAT = 80;
const MAX_CONTENT_CHARS = 1000;

export type MessageRefRole = "user" | "assistant";

export interface MessageRef {
  role: MessageRefRole;
  content: string;
  senderLabel: string | null;
}

export interface MessageRefEntry {
  role: MessageRefRole;
  senderLabel: string | null;
  content: string;
  telegramMessageId: number;
}

let db: DatabaseSync;

export function bindMessageRefsDatabase(database: DatabaseSync): void {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS message_refs (
      chat_key TEXT NOT NULL,
      telegram_message_id INTEGER NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
      sender_label TEXT,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (chat_key, telegram_message_id)
    );
    CREATE INDEX IF NOT EXISTS idx_message_refs_chat_created
      ON message_refs (chat_key, created_at);
    CREATE INDEX IF NOT EXISTS idx_message_refs_message_id
      ON message_refs (telegram_message_id);
  `);
  migrateMessageRefsSchema();
}

export function rememberMessageRef(
  chatKey: string,
  telegramMessageId: number,
  role: MessageRefRole,
  content: string,
  senderLabel?: string | null,
): void {
  const trimmed = content.trim();
  if (!trimmed || telegramMessageId < 1) return;

  const stored =
    trimmed.length > MAX_CONTENT_CHARS
      ? `${trimmed.slice(0, MAX_CONTENT_CHARS)}…`
      : trimmed;

  db.prepare(
    `INSERT INTO message_refs
       (chat_key, telegram_message_id, role, sender_label, content)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(chat_key, telegram_message_id) DO UPDATE SET
       role = excluded.role,
       sender_label = excluded.sender_label,
       content = excluded.content,
       created_at = unixepoch()`,
  ).run(
    chatKey,
    telegramMessageId,
    role,
    senderLabel?.trim() || null,
    stored,
  );
  pruneMessageRefs(chatKey);
}

export function getMessageRef(
  chatKey: string,
  telegramMessageId: number,
): MessageRef | null {
  const row = db
    .prepare(
      `SELECT role, sender_label, content FROM message_refs
       WHERE chat_key = ? AND telegram_message_id = ?`,
    )
    .get(chatKey, telegramMessageId) as
    | { role: MessageRefRole; sender_label: string | null; content: string }
    | undefined;

  if (!row) return null;
  return {
    role: row.role,
    senderLabel: row.sender_label,
    content: row.content,
  };
}

export interface MessageRefMatch {
  chatKey: string;
  role: MessageRefRole;
  content: string;
  senderLabel: string | null;
}

/** Find a stored ref by chat id (includes forum topic keys). */
export function findMessageRefInChat(
  chatId: number,
  telegramMessageId: number,
): MessageRefMatch | null {
  const chatKey = String(chatId);
  const row = db
    .prepare(
      `SELECT chat_key, role, sender_label, content FROM message_refs
       WHERE telegram_message_id = ?
         AND (chat_key = ? OR chat_key LIKE ?)
       ORDER BY created_at DESC
       LIMIT 1`,
    )
    .get(telegramMessageId, chatKey, `${chatId}:%`) as
    | {
        chat_key: string;
        role: MessageRefRole;
        sender_label: string | null;
        content: string;
      }
    | undefined;

  if (!row) return null;
  return {
    chatKey: row.chat_key,
    role: row.role,
    content: row.content,
    senderLabel: row.sender_label,
  };
}

/** Recent messages for a chat key (group feed or private). */
export function getRecentMessageRefs(
  chatKey: string,
  limit = 20,
  excludeMessageId?: number,
): MessageRefEntry[] {
  const capped = Math.min(Math.max(1, limit), 40);
  const rows = db
    .prepare(
      `SELECT role, sender_label, content, telegram_message_id
       FROM message_refs
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
      role: MessageRefRole;
      sender_label: string | null;
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

function migrateMessageRefsSchema(): void {
  const columns = db
    .prepare(`PRAGMA table_info(message_refs)`)
    .all() as Array<{ name: string }>;
  const names = new Set(columns.map((c) => c.name));

  if (!names.has("sender_label")) {
    db.exec(`ALTER TABLE message_refs ADD COLUMN sender_label TEXT`);
  }

  const hasGroupActivity = db
    .prepare(
      `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'group_activity'`,
    )
    .get();
  if (!hasGroupActivity) return;

  db.exec(`
    INSERT OR IGNORE INTO message_refs
      (chat_key, telegram_message_id, role, sender_label, content, created_at)
    SELECT
      chat_key,
      telegram_message_id,
      CASE role WHEN 'assistant' THEN 'assistant' ELSE 'user' END,
      sender_label,
      content,
      created_at
    FROM group_activity
  `);
  db.exec(`DROP TABLE group_activity`);
  cleanupLegacyDuplicateRefs();
}

/** Drop legacy per-topic duplicates when the group-level ref already exists. */
function cleanupLegacyDuplicateRefs(): void {
  db.exec(`
    DELETE FROM message_refs AS thread
    WHERE thread.chat_key LIKE '-%:%'
      AND thread.chat_key NOT LIKE '%:%:%'
      AND EXISTS (
        SELECT 1 FROM message_refs AS base
        WHERE base.telegram_message_id = thread.telegram_message_id
          AND base.chat_key = substr(thread.chat_key, 1, instr(thread.chat_key, ':') - 1)
      )
  `);
  db.exec(`
    DELETE FROM message_refs AS per_user
    WHERE per_user.chat_key GLOB '-*:*'
      AND per_user.chat_key NOT GLOB '-*:*:*'
      AND EXISTS (
        SELECT 1 FROM message_refs AS feed
        WHERE feed.telegram_message_id = per_user.telegram_message_id
          AND feed.chat_key = substr(per_user.chat_key, 1, instr(per_user.chat_key, ':') - 1)
      )
  `);
  db.exec(`
    DELETE FROM message_refs AS per_user
    WHERE per_user.chat_key GLOB '-*:*:*'
      AND EXISTS (
        SELECT 1 FROM message_refs AS feed
        WHERE feed.telegram_message_id = per_user.telegram_message_id
          AND feed.chat_key = substr(
            per_user.chat_key,
            1,
            instr(per_user.chat_key, ':', instr(per_user.chat_key, ':') + 1) - 1
          )
      )
  `);
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
