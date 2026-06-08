import type { DatabaseSync } from "node:sqlite";
import {
  applyMoodCooldown,
  DEFAULT_MOOD_VALUES,
  moodValuesEqual,
  normalizeMoodValues,
  type MoodValues,
} from "../mood.js";
import type { Settings } from "./database.js";
import { getActivePersonalityMoodDefaults } from "./personalities.js";

const MOOD_ANCHOR_KEY = "moodAnchor";
const MOOD_VALUES_KEY = "moodValues";
const MOOD_UPDATED_AT_KEY = "moodUpdatedAt";

let db: DatabaseSync;
let readSettings: () => Settings = () => {
  throw new Error("Mood module not initialized");
};

export interface MoodState {
  values: MoodValues;
  updatedAt: string;
}

export interface MoodStateView extends MoodState {
  effectiveValues: MoodValues;
}

export function bindMoodDatabase(database: DatabaseSync): void {
  db = database;
}

export function configureMoodAccess(getSettings: () => Settings): void {
  readSettings = getSettings;
}

function moodDefaults(): MoodValues {
  return getActivePersonalityMoodDefaults();
}

function moodCooldownMinutes(): number {
  return readSettings().moodCooldownMinutes;
}

function readMeta(key: string): string | null {
  const row = db
    .prepare("SELECT value FROM stats_meta WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

function writeMeta(key: string, value: string): void {
  db.prepare(
    "INSERT INTO stats_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, value);
}

function deleteMeta(key: string): void {
  db.prepare("DELETE FROM stats_meta WHERE key = ?").run(key);
}

function parseMoodJson(
  json: string | null,
  fallback: MoodValues,
): MoodValues | null {
  if (!json) return null;
  try {
    return normalizeMoodValues(
      JSON.parse(json) as Partial<Record<string, unknown>>,
      fallback,
    );
  } catch {
    return null;
  }
}

function getMoodAnchorState(): { anchor: MoodValues; updatedAt: string } | null {
  const updatedAt = readMeta(MOOD_UPDATED_AT_KEY);
  if (!updatedAt) return null;

  const defaults = moodDefaults();
  const anchorJson = readMeta(MOOD_ANCHOR_KEY) ?? readMeta(MOOD_VALUES_KEY);
  const anchor = parseMoodJson(anchorJson, defaults);
  if (!anchor) return null;

  return { anchor, updatedAt };
}

/** Apply linear cooldown from the last interaction anchor and persist decayed values. */
export function tickMoodCooldown(): boolean {
  const anchorState = getMoodAnchorState();
  if (!anchorState) return false;

  const defaults = moodDefaults();
  const decayed = applyMoodCooldown(
    anchorState.anchor,
    defaults,
    anchorState.updatedAt,
    moodCooldownMinutes(),
  );

  const current = parseMoodJson(readMeta(MOOD_VALUES_KEY), defaults);
  if (current && moodValuesEqual(current, decayed)) return false;

  writeMeta(MOOD_VALUES_KEY, JSON.stringify(decayed));
  return true;
}

export function getMoodState(): MoodState | null {
  const anchorState = getMoodAnchorState();
  if (!anchorState) return null;

  const values = parseMoodJson(readMeta(MOOD_VALUES_KEY), moodDefaults());
  if (!values) return null;

  return { values, updatedAt: anchorState.updatedAt };
}

/** Current mood kept up to date by the background cooldown worker. */
export function getEffectiveMood(): MoodValues {
  const defaults = moodDefaults();
  const current = parseMoodJson(readMeta(MOOD_VALUES_KEY), defaults);
  if (current) return current;
  return { ...defaults };
}

export function getMoodStateView(): MoodStateView | null {
  const anchorState = getMoodAnchorState();
  if (!anchorState) return null;

  const values = parseMoodJson(readMeta(MOOD_VALUES_KEY), moodDefaults());
  if (!values) return null;

  return {
    values,
    updatedAt: anchorState.updatedAt,
    effectiveValues: applyMoodCooldown(
      anchorState.anchor,
      moodDefaults(),
      anchorState.updatedAt,
      moodCooldownMinutes(),
    ),
  };
}

export function saveMoodState(values: MoodValues): MoodState {
  const normalized = normalizeMoodValues(values, moodDefaults());
  const updatedAt = new Date().toISOString();
  const encoded = JSON.stringify(normalized);

  writeMeta(MOOD_ANCHOR_KEY, encoded);
  writeMeta(MOOD_VALUES_KEY, encoded);
  writeMeta(MOOD_UPDATED_AT_KEY, updatedAt);

  return { values: normalized, updatedAt };
}

export function resetMoodState(): boolean {
  const hadValues = readMeta(MOOD_VALUES_KEY) != null;
  deleteMeta(MOOD_ANCHOR_KEY);
  deleteMeta(MOOD_VALUES_KEY);
  deleteMeta(MOOD_UPDATED_AT_KEY);
  return hadValues;
}
