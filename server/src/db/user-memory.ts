import type { DatabaseSync } from "node:sqlite";
import { normalizeFactText } from "./memory-facts.js";

const MAX_MEMORY_CHARS = 12000;

let db: DatabaseSync;

export function bindUserMemoryDatabase(database: DatabaseSync): void {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL UNIQUE,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_user_memories_user
      ON user_memories (user_id);
  `);
}

export interface UserFactRecord {
  id: number;
  userId: string;
  fact: string;
  createdAt: string;
}

export function getUserFacts(userId: string): string[] {
  const content = getUserMemoryContent(userId);
  return content ? [content] : [];
}

export function getUserMemoryContent(userId: string): string {
  const row = db
    .prepare(`SELECT content FROM user_memories WHERE user_id = ?`)
    .get(userId) as { content: string } | undefined;
  return row?.content ?? "";
}

export function listAllUserFacts(): UserFactRecord[] {
  const rows = db
    .prepare(
      `SELECT id, user_id, content, updated_at FROM user_memories
       ORDER BY user_id ASC`,
    )
    .all() as unknown as {
    id: number;
    user_id: string;
    content: string;
    updated_at: number;
  }[];

  return rows.map(rowToUserFactRecord);
}

export function listUserFacts(userId: string): UserFactRecord[] {
  const row = getUserMemoryRecord(userId);
  return row ? [row] : [];
}

function rowToUserFactRecord(r: {
  id: number;
  user_id: string;
  content: string;
  updated_at: number;
}): UserFactRecord {
  return {
    id: r.id,
    userId: r.user_id,
    fact: r.content,
    createdAt: new Date(r.updated_at * 1000).toISOString(),
  };
}

export function getUserFactById(id: number): UserFactRecord | null {
  const row = db
    .prepare(
      `SELECT id, user_id, content, updated_at FROM user_memories WHERE id = ?`,
    )
    .get(id) as
    | { id: number; user_id: string; content: string; updated_at: number }
    | undefined;
  return row ? rowToUserFactRecord(row) : null;
}

function getUserMemoryRecord(userId: string): UserFactRecord | null {
  const row = db
    .prepare(
      `SELECT id, user_id, content, updated_at FROM user_memories
       WHERE user_id = ?`,
    )
    .get(userId) as
    | { id: number; user_id: string; content: string; updated_at: number }
    | undefined;
  return row ? rowToUserFactRecord(row) : null;
}

export function deleteUserFactById(id: number): boolean {
  const result = db.prepare(`DELETE FROM user_memories WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function createUserFact(
  userId: string,
  fact: string,
): UserFactRecord | null {
  const normalized = normalizeFactText(fact);
  if (!normalized) return null;
  const existing = getUserMemoryContent(userId);
  const content = appendUniqueLine(existing, normalized);
  replaceUserMemory(userId, content);
  return getUserMemoryRecord(userId);
}

export function updateUserFactById(
  id: number,
  fact: string,
): UserFactRecord | "duplicate" | null {
  const normalized = normalizeMemoryContent(fact);
  if (!normalized) return null;

  const current = getUserFactById(id);
  if (!current) return null;

  replaceUserMemory(current.userId, normalized);
  return getUserMemoryRecord(current.userId);
}

export function clearUserFactsForUser(userId: string): number {
  const result = db
    .prepare(`DELETE FROM user_memories WHERE user_id = ?`)
    .run(userId);
  return Number(result.changes);
}

export function addUserFacts(userId: string, facts: string[]): number {
  const existing = getUserMemoryContent(userId);
  let content = existing;
  let added = 0;

  for (const fact of facts) {
    const normalized = normalizeFactText(fact);
    if (!normalized) continue;
    const next = appendUniqueLine(content, normalized);
    if (next === content) continue;
    content = next;
    added++;
  }

  if (added > 0) replaceUserMemory(userId, content);
  return added;
}

export function clearUserMemory(userId: string): void {
  db.prepare(`DELETE FROM user_memories WHERE user_id = ?`).run(userId);
}

export function formatUserMemoryForPrompt(facts: string[]): string {
  const content = facts.join("\n").trim();
  if (!content) {
    return "No stored facts yet about this user.";
  }
  return content;
}

export function userMemoryTotalChars(facts: string[]): number {
  return facts.reduce((n, f) => n + f.length, 0);
}

export function replaceUserFacts(userId: string, facts: string[]): void {
  replaceUserMemory(userId, facts.join("\n").trim());
}

export function replaceUserMemory(userId: string, content: string): void {
  const normalized = normalizeMemoryContent(content);
  if (!normalized) {
    clearUserMemory(userId);
    return;
  }
  db.prepare(
    `INSERT INTO user_memories (user_id, content, updated_at)
     VALUES (?, ?, unixepoch())
     ON CONFLICT(user_id) DO UPDATE SET
       content = excluded.content,
       updated_at = excluded.updated_at`,
  ).run(userId, normalized);
}

function appendUniqueLine(existing: string, fact: string): string {
  const lines = existing
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const key = fact.toLowerCase();
  if (lines.some((line) => line.toLowerCase() === key)) {
    return existing.trim();
  }
  return [...lines, fact].join("\n").slice(0, MAX_MEMORY_CHARS);
}

function normalizeMemoryContent(content: unknown): string | null {
  if (typeof content !== "string") return null;
  const normalized = content.trim();
  if (normalized.length < 2) return null;
  return normalized.slice(0, MAX_MEMORY_CHARS);
}
