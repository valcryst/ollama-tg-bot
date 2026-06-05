let db: import("node:sqlite").DatabaseSync;

const MAX_ENTRIES = 100;

export interface ErrorLogRecord {
  id: number;
  message: string;
  chatId: string | null;
  userId: string | null;
  createdAt: string;
}

export interface ErrorLogInput {
  message: string;
  stack?: string;
  chatId?: number;
  userId?: string;
}

export function bindErrorLogDatabase(database: import("node:sqlite").DatabaseSync): void {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS error_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      message TEXT NOT NULL,
      stack TEXT,
      chat_id TEXT,
      user_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
}

export function appendErrorLog(input: ErrorLogInput): void {
  db.prepare(
    `INSERT INTO error_log (message, stack, chat_id, user_id)
     VALUES (?, ?, ?, ?)`,
  ).run(
    input.message.slice(0, 2000),
    input.stack?.slice(0, 4000) ?? null,
    input.chatId != null ? String(input.chatId) : null,
    input.userId ?? null,
  );

  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM error_log`)
    .get() as { n: number };
  const excess = row.n - MAX_ENTRIES;
  if (excess > 0) {
    db.prepare(
      `DELETE FROM error_log WHERE id IN (
         SELECT id FROM error_log ORDER BY id ASC LIMIT ?
       )`,
    ).run(excess);
  }
}

export function clearErrorLog(): number {
  const result = db.prepare(`DELETE FROM error_log`).run();
  return Number(result.changes);
}

export function listRecentErrors(limit = 20): ErrorLogRecord[] {
  const rows = db
    .prepare(
      `SELECT id, message, chat_id, user_id, created_at
       FROM error_log
       ORDER BY id DESC
       LIMIT ?`,
    )
    .all(limit) as unknown as {
    id: number;
    message: string;
    chat_id: string | null;
    user_id: string | null;
    created_at: number;
  }[];

  return rows.map((r) => ({
    id: r.id,
    message: r.message,
    chatId: r.chat_id,
    userId: r.user_id,
    createdAt: new Date(r.created_at * 1000).toISOString(),
  }));
}
