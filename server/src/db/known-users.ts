import type { User } from "@grammyjs/types";

let db: import("node:sqlite").DatabaseSync;

export interface KnownUser {
  userId: string;
  username: string | null;
}

export function bindKnownUsersDatabase(
  database: import("node:sqlite").DatabaseSync,
): void {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS known_users (
      user_id TEXT PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      last_name TEXT,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_known_users_username
      ON known_users (username);
  `);
}

export function rememberTelegramUser(user: User | undefined): void {
  if (!user?.id) return;

  db.prepare(
    `INSERT INTO known_users (user_id, username, first_name, last_name, updated_at)
     VALUES (?, ?, ?, ?, unixepoch())
     ON CONFLICT(user_id) DO UPDATE SET
       username = excluded.username,
       first_name = excluded.first_name,
       last_name = excluded.last_name,
       updated_at = unixepoch()`,
  ).run(
    String(user.id),
    user.username?.toLowerCase() ?? null,
    user.first_name ?? null,
    user.last_name ?? null,
  );
}

export function findKnownUserByUsername(
  username: string,
): KnownUser | null {
  const normalized = username.trim().replace(/^@/, "").toLowerCase();
  if (!normalized) return null;

  const row = db
    .prepare(
      `SELECT user_id, username
       FROM known_users
       WHERE lower(username) = ?
       ORDER BY updated_at DESC
       LIMIT 1`,
    )
    .get(normalized) as { user_id: string; username: string | null } | undefined;

  if (!row) return null;
  return { userId: row.user_id, username: row.username };
}
