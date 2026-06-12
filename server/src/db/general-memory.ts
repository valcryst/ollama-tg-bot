import type { DatabaseSync } from "node:sqlite";
import { normalizeFactText } from "./memory-facts.js";

const MAX_GENERAL_FACTS = 128;

let db: DatabaseSync;

export function bindGeneralMemoryDatabase(database: DatabaseSync): void {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS general_facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fact TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_general_facts_id
      ON general_facts (id);
  `);
}

export interface GeneralFactRecord {
  id: number;
  fact: string;
  createdAt: string;
}

export function getGeneralFacts(): string[] {
  return listGeneralFacts().map((r) => r.fact);
}

export function listGeneralFacts(): GeneralFactRecord[] {
  const rows = db
    .prepare(
      `SELECT id, fact, created_at FROM general_facts ORDER BY id ASC`,
    )
    .all() as unknown as {
    id: number;
    fact: string;
    created_at: number;
  }[];

  return rows.map(rowToGeneralFactRecord);
}

function rowToGeneralFactRecord(r: {
  id: number;
  fact: string;
  created_at: number;
}): GeneralFactRecord {
  return {
    id: r.id,
    fact: r.fact,
    createdAt: new Date(r.created_at * 1000).toISOString(),
  };
}

export function getGeneralFactById(id: number): GeneralFactRecord | null {
  const row = db
    .prepare(`SELECT id, fact, created_at FROM general_facts WHERE id = ?`)
    .get(id) as
    | { id: number; fact: string; created_at: number }
    | undefined;
  return row ? rowToGeneralFactRecord(row) : null;
}

function notifyGeneralMemoryChanged(): void {
  void import("../live-events.js").then(({ emitDataUpdated, emitMemoryUpdated }) => {
    emitMemoryUpdated("general");
    emitDataUpdated(["general_facts"]);
  });
}

export function deleteGeneralFactById(id: number): boolean {
  const result = db.prepare(`DELETE FROM general_facts WHERE id = ?`).run(id);
  if (result.changes > 0) notifyGeneralMemoryChanged();
  return result.changes > 0;
}

export function createGeneralFact(fact: string): GeneralFactRecord | null {
  const normalized = normalizeFactText(fact);
  if (!normalized) return null;

  const existing = new Set(
    getGeneralFacts().map((f) => f.toLowerCase()),
  );
  if (existing.has(normalized.toLowerCase())) {
    const row = db
      .prepare(
        `SELECT id, fact, created_at FROM general_facts
         WHERE lower(fact) = lower(?)`,
      )
      .get(normalized) as
      | { id: number; fact: string; created_at: number }
      | undefined;
    return row ? rowToGeneralFactRecord(row) : null;
  }

  const result = db
    .prepare(`INSERT INTO general_facts (fact) VALUES (?)`)
    .run(normalized);
  pruneGeneralFacts();
  notifyGeneralMemoryChanged();
  return getGeneralFactById(Number(result.lastInsertRowid));
}

export function updateGeneralFactById(
  id: number,
  fact: string,
): GeneralFactRecord | "duplicate" | null {
  const normalized = normalizeFactText(fact);
  if (!normalized) return null;

  const current = getGeneralFactById(id);
  if (!current) return null;

  const duplicate = db
    .prepare(
      `SELECT 1 FROM general_facts
       WHERE lower(fact) = lower(?) AND id != ?`,
    )
    .get(normalized, id);
  if (duplicate) return "duplicate";

  db.prepare(`UPDATE general_facts SET fact = ? WHERE id = ?`).run(
    normalized,
    id,
  );
  notifyGeneralMemoryChanged();
  return getGeneralFactById(id);
}

export function addGeneralFacts(facts: string[]): number {
  const existing = new Set(
    getGeneralFacts().map((f) => f.toLowerCase()),
  );
  const insert = db.prepare(`INSERT INTO general_facts (fact) VALUES (?)`);
  let added = 0;

  for (const fact of facts) {
    const normalized = normalizeFactText(fact);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (existing.has(key)) continue;
    existing.add(key);
    insert.run(normalized);
    added++;
  }

  pruneGeneralFacts();
  if (added > 0) notifyGeneralMemoryChanged();
  return added;
}

export function clearAllGeneralFacts(): number {
  const result = db.prepare(`DELETE FROM general_facts`).run();
  const deleted = Number(result.changes);
  if (deleted > 0) notifyGeneralMemoryChanged();
  return deleted;
}

function pruneGeneralFacts(): void {
  db.prepare(
    `DELETE FROM general_facts
     WHERE id NOT IN (
       SELECT id FROM general_facts
       ORDER BY id DESC
       LIMIT ?
     )`,
  ).run(MAX_GENERAL_FACTS);
}

export function formatGeneralMemoryForPrompt(facts: string[]): string {
  if (facts.length === 0) {
    return "No general facts stored yet.";
  }
  return facts.map((f) => `- ${f}`).join("\n");
}
