import type { DatabaseSync } from "node:sqlite";
import { normalizeFactText } from "./memory-facts.js";

const MAX_FACTS_PER_GROUP = 64;

let db: DatabaseSync;

export function bindGroupMemoryDatabase(database: DatabaseSync): void {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS group_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id TEXT NOT NULL,
      fact TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_group_facts_group
      ON group_facts (group_id, id);
  `);
}

export interface GroupFactRecord {
  id: number;
  groupId: string;
  fact: string;
  createdAt: string;
}

export function getGroupFacts(groupId: string): string[] {
  return listGroupFacts(groupId).map((r) => r.fact);
}

export function listAllGroupFacts(): GroupFactRecord[] {
  const rows = db
    .prepare(
      `SELECT id, group_id, fact, created_at FROM group_facts
       ORDER BY group_id ASC, id ASC`,
    )
    .all() as unknown as {
    id: number;
    group_id: string;
    fact: string;
    created_at: number;
  }[];

  return rows.map(rowToGroupFactRecord);
}

export function listGroupFacts(groupId: string): GroupFactRecord[] {
  const rows = db
    .prepare(
      `SELECT id, group_id, fact, created_at FROM group_facts
       WHERE group_id = ?
       ORDER BY id ASC`,
    )
    .all(groupId) as unknown as {
    id: number;
    group_id: string;
    fact: string;
    created_at: number;
  }[];

  return rows.map(rowToGroupFactRecord);
}

function rowToGroupFactRecord(r: {
  id: number;
  group_id: string;
  fact: string;
  created_at: number;
}): GroupFactRecord {
  return {
    id: r.id,
    groupId: r.group_id,
    fact: r.fact,
    createdAt: new Date(r.created_at * 1000).toISOString(),
  };
}

export function getGroupFactById(id: number): GroupFactRecord | null {
  const row = db
    .prepare(
      `SELECT id, group_id, fact, created_at FROM group_facts WHERE id = ?`,
    )
    .get(id) as
    | { id: number; group_id: string; fact: string; created_at: number }
    | undefined;
  return row ? rowToGroupFactRecord(row) : null;
}

export function deleteGroupFactById(id: number): boolean {
  const result = db.prepare(`DELETE FROM group_facts WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function createGroupFact(
  groupId: string,
  fact: string,
): GroupFactRecord | null {
  const normalized = normalizeFactText(fact);
  if (!normalized) return null;

  const existing = new Set(
    getGroupFacts(groupId).map((f) => f.toLowerCase()),
  );
  if (existing.has(normalized.toLowerCase())) {
    const row = db
      .prepare(
        `SELECT id, group_id, fact, created_at FROM group_facts
         WHERE group_id = ? AND lower(fact) = lower(?)`,
      )
      .get(groupId, normalized) as
      | { id: number; group_id: string; fact: string; created_at: number }
      | undefined;
    return row ? rowToGroupFactRecord(row) : null;
  }

  const result = db
    .prepare(`INSERT INTO group_facts (group_id, fact) VALUES (?, ?)`)
    .run(groupId, normalized);
  pruneGroupFacts(groupId);
  return getGroupFactById(Number(result.lastInsertRowid));
}

export function updateGroupFactById(
  id: number,
  fact: string,
): GroupFactRecord | "duplicate" | null {
  const normalized = normalizeFactText(fact);
  if (!normalized) return null;

  const current = getGroupFactById(id);
  if (!current) return null;

  const duplicate = db
    .prepare(
      `SELECT 1 FROM group_facts
       WHERE group_id = ? AND lower(fact) = lower(?) AND id != ?`,
    )
    .get(current.groupId, normalized, id);
  if (duplicate) return "duplicate";

  db.prepare(`UPDATE group_facts SET fact = ? WHERE id = ?`).run(
    normalized,
    id,
  );
  return getGroupFactById(id);
}

export function clearGroupFactsForGroup(groupId: string): number {
  const result = db
    .prepare(`DELETE FROM group_facts WHERE group_id = ?`)
    .run(groupId);
  return Number(result.changes);
}

export function addGroupFacts(groupId: string, facts: string[]): number {
  const existing = new Set(
    getGroupFacts(groupId).map((f) => f.toLowerCase()),
  );
  const insert = db.prepare(
    `INSERT INTO group_facts (group_id, fact) VALUES (?, ?)`,
  );
  let added = 0;

  for (const fact of facts) {
    const normalized = fact.trim();
    if (normalized.length < 2 || normalized.length > 500) continue;
    const key = normalized.toLowerCase();
    if (existing.has(key)) continue;
    existing.add(key);
    insert.run(groupId, normalized);
    added++;
  }

  pruneGroupFacts(groupId);
  return added;
}

export function clearGroupMemory(groupId: string): void {
  db.prepare(`DELETE FROM group_facts WHERE group_id = ?`).run(groupId);
}

function pruneGroupFacts(groupId: string): void {
  db.prepare(
    `DELETE FROM group_facts
     WHERE group_id = ? AND id NOT IN (
       SELECT id FROM group_facts
       WHERE group_id = ?
       ORDER BY id DESC
       LIMIT ?
     )`,
  ).run(groupId, groupId, MAX_FACTS_PER_GROUP);
}

export function formatGroupMemoryForPrompt(facts: string[]): string {
  if (facts.length === 0) {
    return "No stored facts yet about this group.";
  }
  return facts.map((f) => `- ${f}`).join("\n");
}
