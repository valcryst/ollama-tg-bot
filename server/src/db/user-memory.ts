import type { DatabaseSync } from "node:sqlite";

const MAX_FACTS_PER_USER = 64;

let db: DatabaseSync;

export function bindUserMemoryDatabase(database: DatabaseSync): void {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      fact TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_user_facts_user
      ON user_facts (user_id, id);
  `);
}

export interface UserFactRecord {
  id: number;
  userId: string;
  fact: string;
  createdAt: string;
}

export function getUserFacts(userId: string): string[] {
  return listUserFacts(userId).map((r) => r.fact);
}

export function listAllUserFacts(): UserFactRecord[] {
  const rows = db
    .prepare(
      `SELECT id, user_id, fact, created_at FROM user_facts
       ORDER BY user_id ASC, id ASC`,
    )
    .all() as unknown as {
    id: number;
    user_id: string;
    fact: string;
    created_at: number;
  }[];

  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    fact: r.fact,
    createdAt: new Date(r.created_at * 1000).toISOString(),
  }));
}

export function listUserFacts(userId: string): UserFactRecord[] {
  const rows = db
    .prepare(
      `SELECT id, user_id, fact, created_at FROM user_facts
       WHERE user_id = ?
       ORDER BY id ASC`,
    )
    .all(userId) as unknown as {
    id: number;
    user_id: string;
    fact: string;
    created_at: number;
  }[];

  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    fact: r.fact,
    createdAt: new Date(r.created_at * 1000).toISOString(),
  }));
}

export function deleteUserFactById(id: number): boolean {
  const result = db.prepare(`DELETE FROM user_facts WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function clearUserFactsForUser(userId: string): number {
  const result = db
    .prepare(`DELETE FROM user_facts WHERE user_id = ?`)
    .run(userId);
  return Number(result.changes);
}

export function addUserFacts(userId: string, facts: string[]): number {
  const existing = new Set(
    getUserFacts(userId).map((f) => f.toLowerCase()),
  );
  const insert = db.prepare(
    `INSERT INTO user_facts (user_id, fact) VALUES (?, ?)`,
  );
  let added = 0;

  for (const fact of facts) {
    const normalized = fact.trim();
    if (normalized.length < 2 || normalized.length > 500) continue;
    const key = normalized.toLowerCase();
    if (existing.has(key)) continue;
    existing.add(key);
    insert.run(userId, normalized);
    added++;
  }

  pruneUserFacts(userId);
  return added;
}

export function clearUserMemory(userId: string): void {
  db.prepare(`DELETE FROM user_facts WHERE user_id = ?`).run(userId);
}

function pruneUserFacts(userId: string): void {
  db.prepare(
    `DELETE FROM user_facts
     WHERE user_id = ? AND id NOT IN (
       SELECT id FROM user_facts
       WHERE user_id = ?
       ORDER BY id DESC
       LIMIT ?
     )`,
  ).run(userId, userId, MAX_FACTS_PER_USER);
}

export function formatUserMemoryForPrompt(facts: string[]): string {
  if (facts.length === 0) {
    return "No stored facts yet about this user.";
  }
  return facts.map((f) => `- ${f}`).join("\n");
}
