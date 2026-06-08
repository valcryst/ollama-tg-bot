import type { DatabaseSync } from "node:sqlite";
import {
  DEFAULT_MOOD_VALUES,
  MOOD_KEYS,
  clampMoodLevel,
  normalizeMoodValues,
  type MoodValues,
} from "../mood.js";

export const MAX_PERSONALITIES = 32;
export const MAX_PERSONALITY_NAME_LENGTH = 64;
export const MAX_PERSONALITY_PROMPT_LENGTH = 32000;

let db: DatabaseSync;
let getActivePersonalityId: () => number = () => 0;

export interface PersonalityRecord {
  id: number;
  name: string;
  prompt: string;
  moodDefaults: MoodValues;
  createdAt: string;
  updatedAt: string;
}

export function bindPersonalitiesDatabase(database: DatabaseSync): void {
  db = database;
  db.exec(`
    CREATE TABLE IF NOT EXISTS personalities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_personalities_name
      ON personalities (name COLLATE NOCASE);
  `);

  const columns = db.prepare("PRAGMA table_info(personalities)").all() as {
    name: string;
  }[];
  if (!columns.some((column) => column.name === "mood_defaults")) {
    db.exec(`ALTER TABLE personalities ADD COLUMN mood_defaults TEXT`);
  }
}

export function configurePersonalityAccess(
  getSettingsFn: () => { activePersonalityId: number },
): void {
  getActivePersonalityId = () => getSettingsFn().activePersonalityId;
}

export function normalizePersonalityMoodDefaults(
  raw: Partial<Record<string, unknown>> | null | undefined,
  fallback: MoodValues = DEFAULT_MOOD_VALUES,
): MoodValues {
  const normalized = normalizeMoodValues(raw, fallback);
  for (const key of MOOD_KEYS) {
    const value = normalized[key];
    if (
      !Number.isInteger(value) ||
      value !== clampMoodLevel(value) ||
      value < 0 ||
      value > 5
    ) {
      throw new Error(`moodDefaults.${key} must be an integer 0–5`);
    }
  }
  return normalized;
}

export function normalizePersonalityName(raw: string | undefined): string {
  const name = raw?.trim() ?? "";
  if (!name) throw new Error("Personality name is required");
  if (name.length > MAX_PERSONALITY_NAME_LENGTH) {
    throw new Error(
      `Personality name must be at most ${MAX_PERSONALITY_NAME_LENGTH} characters`,
    );
  }
  return name;
}

export function normalizePersonalityPrompt(raw: string | undefined): string {
  const prompt = raw?.trim() ?? "";
  if (prompt.length > MAX_PERSONALITY_PROMPT_LENGTH) {
    throw new Error(
      `Personality prompt must be at most ${MAX_PERSONALITY_PROMPT_LENGTH} characters`,
    );
  }
  return prompt;
}

function parseMoodDefaultsColumn(raw: string | null | undefined): MoodValues {
  if (!raw?.trim()) return { ...DEFAULT_MOOD_VALUES };
  try {
    return normalizePersonalityMoodDefaults(
      JSON.parse(raw) as Partial<Record<string, unknown>>,
    );
  } catch {
    return { ...DEFAULT_MOOD_VALUES };
  }
}

function rowToPersonality(r: {
  id: number;
  name: string;
  prompt: string;
  mood_defaults?: string | null;
  created_at: number;
  updated_at: number;
}): PersonalityRecord {
  return {
    id: r.id,
    name: r.name,
    prompt: r.prompt,
    moodDefaults: parseMoodDefaultsColumn(r.mood_defaults),
    createdAt: new Date(r.created_at * 1000).toISOString(),
    updatedAt: new Date(r.updated_at * 1000).toISOString(),
  };
}

export function countPersonalities(): number {
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM personalities")
    .get() as { n: number };
  return row.n;
}

export function listPersonalities(): PersonalityRecord[] {
  const rows = db
    .prepare(
      `SELECT id, name, prompt, mood_defaults, created_at, updated_at
       FROM personalities
       ORDER BY id ASC`,
    )
    .all() as {
    id: number;
    name: string;
    prompt: string;
    mood_defaults: string | null;
    created_at: number;
    updated_at: number;
  }[];

  return rows.map(rowToPersonality);
}

export function getPersonalityById(id: number): PersonalityRecord | null {
  const row = db
    .prepare(
      `SELECT id, name, prompt, mood_defaults, created_at, updated_at
       FROM personalities WHERE id = ?`,
    )
    .get(id) as
    | {
        id: number;
        name: string;
        prompt: string;
        mood_defaults: string | null;
        created_at: number;
        updated_at: number;
      }
    | undefined;

  return row ? rowToPersonality(row) : null;
}

export function resolveActivePersonalityId(storedId: number): number {
  if (storedId <= 0) return 0;
  return getPersonalityById(storedId) ? storedId : 0;
}

export function getActivePersonalityPrompt(): string {
  const id = resolveActivePersonalityId(getActivePersonalityId());
  if (!id) return "";
  return getPersonalityById(id)?.prompt ?? "";
}

export function getActivePersonalityMoodDefaults(): MoodValues {
  const id = resolveActivePersonalityId(getActivePersonalityId());
  if (!id) return { ...DEFAULT_MOOD_VALUES };
  return getPersonalityById(id)?.moodDefaults ?? { ...DEFAULT_MOOD_VALUES };
}

function nameTaken(name: string, exceptId?: number): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM personalities
       WHERE name = ? COLLATE NOCASE
       ${exceptId != null ? "AND id != ?" : ""}`,
    )
    .get(...(exceptId != null ? [name, exceptId] : [name]));
  return Boolean(row);
}

export function createPersonality(
  name: string,
  prompt: string,
  moodDefaults: MoodValues = DEFAULT_MOOD_VALUES,
): PersonalityRecord | null {
  if (countPersonalities() >= MAX_PERSONALITIES) return null;
  if (nameTaken(name)) return null;

  const normalizedMood = normalizePersonalityMoodDefaults(moodDefaults);

  const result = db
    .prepare(
      `INSERT INTO personalities (name, prompt, mood_defaults, created_at, updated_at)
       VALUES (?, ?, ?, unixepoch(), unixepoch())`,
    )
    .run(name, prompt, JSON.stringify(normalizedMood));

  const id = Number(result.lastInsertRowid);
  return getPersonalityById(id);
}

export function updatePersonalityById(
  id: number,
  patch: { name?: string; prompt?: string; moodDefaults?: MoodValues },
): PersonalityRecord | "duplicate" | null {
  const existing = getPersonalityById(id);
  if (!existing) return null;

  const nextName =
    patch.name !== undefined ? normalizePersonalityName(patch.name) : existing.name;
  const nextPrompt =
    patch.prompt !== undefined
      ? normalizePersonalityPrompt(patch.prompt)
      : existing.prompt;
  const nextMood =
    patch.moodDefaults !== undefined
      ? normalizePersonalityMoodDefaults(patch.moodDefaults, existing.moodDefaults)
      : existing.moodDefaults;

  if (nextName !== existing.name && nameTaken(nextName, id)) {
    return "duplicate";
  }

  db.prepare(
    `UPDATE personalities
     SET name = ?, prompt = ?, mood_defaults = ?, updated_at = unixepoch()
     WHERE id = ?`,
  ).run(nextName, nextPrompt, JSON.stringify(nextMood), id);

  return getPersonalityById(id);
}

export function deletePersonalityById(id: number): boolean {
  const result = db.prepare("DELETE FROM personalities WHERE id = ?").run(id);
  return result.changes > 0;
}
