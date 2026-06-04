import type { DatabaseSync } from "node:sqlite";
import { normalizeFactText } from "./memory-facts.js";

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

  return rows.map(rowToUserFactRecord);
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

  return rows.map(rowToUserFactRecord);
}

function rowToUserFactRecord(r: {
  id: number;
  user_id: string;
  fact: string;
  created_at: number;
}): UserFactRecord {
  return {
    id: r.id,
    userId: r.user_id,
    fact: r.fact,
    createdAt: new Date(r.created_at * 1000).toISOString(),
  };
}

export function getUserFactById(id: number): UserFactRecord | null {
  const row = db
    .prepare(
      `SELECT id, user_id, fact, created_at FROM user_facts WHERE id = ?`,
    )
    .get(id) as
    | { id: number; user_id: string; fact: string; created_at: number }
    | undefined;
  return row ? rowToUserFactRecord(row) : null;
}

export function deleteUserFactById(id: number): boolean {
  const result = db.prepare(`DELETE FROM user_facts WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function createUserFact(
  userId: string,
  fact: string,
): UserFactRecord | null {
  const normalized = normalizeFactText(fact);
  if (!normalized) return null;

  const existing = new Set(
    getUserFacts(userId).map((f) => f.toLowerCase()),
  );
  if (existing.has(normalized.toLowerCase())) {
    const row = db
      .prepare(
        `SELECT id, user_id, fact, created_at FROM user_facts
         WHERE user_id = ? AND lower(fact) = lower(?)`,
      )
      .get(userId, normalized) as
      | { id: number; user_id: string; fact: string; created_at: number }
      | undefined;
    return row ? rowToUserFactRecord(row) : null;
  }

  const result = db
    .prepare(`INSERT INTO user_facts (user_id, fact) VALUES (?, ?)`)
    .run(userId, normalized);
  pruneUserFacts(userId);
  return getUserFactById(Number(result.lastInsertRowid));
}

export function updateUserFactById(
  id: number,
  fact: string,
): UserFactRecord | "duplicate" | null {
  const normalized = normalizeFactText(fact);
  if (!normalized) return null;

  const current = getUserFactById(id);
  if (!current) return null;

  const duplicate = db
    .prepare(
      `SELECT 1 FROM user_facts
       WHERE user_id = ? AND lower(fact) = lower(?) AND id != ?`,
    )
    .get(current.userId, normalized, id);
  if (duplicate) return "duplicate";

  db.prepare(`UPDATE user_facts SET fact = ? WHERE id = ?`).run(
    normalized,
    id,
  );
  return getUserFactById(id);
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

export function userMemoryTotalChars(facts: string[]): number {
  return facts.reduce((n, f) => n + f.length, 0);
}

/** Replace all facts for a user (e.g. after LLM merge/compression). */
export function replaceUserFacts(userId: string, facts: string[]): void {
  clearUserMemory(userId);
  if (facts.length > 0) addUserFacts(userId, facts);
}
