import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "../config.js";
import { bindHistoryDatabase, configureHistoryAccess } from "./history.js";
import { bindGroupMemoryDatabase } from "./group-memory.js";
import { bindUserMemoryDatabase } from "./user-memory.js";
import { appendErrorLog, bindErrorLogDatabase } from "./error-log.js";
import { bindMessageRefsDatabase } from "./message-refs.js";
import { validateSettingsFields } from "../settings-limits.js";

export interface Settings {
  ollamaHost: string;
  model: string;
  customSystemPrompt: string;
  randomReplyEnabled: boolean;
  randomReplyChance: number;
  /** Max tokens Ollama may generate per reply (lower = faster). */
  numPredict: number;
  /** Context window size sent to Ollama. */
  numCtx: number;
  temperature: number;
  /** Ollama request timeout in seconds. */
  chatTimeoutSec: number;
  /** Chat history: max messages kept per conversation. */
  historyMaxMessages: number;
  /** Chat history: max total characters in context. */
  historyMaxChars: number;
  /** Max characters stored per bot reply in history. */
  historyMaxReplyChars: number;
  /** Longest edge for vision images (pixels). */
  visionMaxDimension: number;
}

export interface Stats {
  messagesReceived: number;
  messagesReplied: number;
  visionRequests: number;
  errors: number;
  lastActivityAt: string | null;
}

const DEFAULT_SETTINGS: Settings = {
  ollamaHost: "http://host.docker.internal:11434",
  model: "llama3.2",
  customSystemPrompt: "",
  randomReplyEnabled: false,
  randomReplyChance: 5,
  numPredict: 512,
  numCtx: 4096,
  temperature: 0.7,
  chatTimeoutSec: 120,
  historyMaxMessages: 16,
  historyMaxChars: 4000,
  historyMaxReplyChars: 500,
  visionMaxDimension: 768,
};

let db: DatabaseSync;

export function initDatabase(): void {
  const dir = path.dirname(config.databasePath);
  fs.mkdirSync(dir, { recursive: true });

  db = new DatabaseSync(config.databasePath);
  db.exec("PRAGMA journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stats (
      key TEXT PRIMARY KEY,
      value INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS stats_meta (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  const existsSetting = db.prepare(
    "SELECT 1 FROM settings WHERE key = ?",
  );
  const insertSetting = db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?)",
  );

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    if (!existsSetting.get(key)) {
      insertSetting.run(key, JSON.stringify(value));
    }
  }

  const existsStat = db.prepare("SELECT 1 FROM stats WHERE key = ?");
  const insertStat = db.prepare("INSERT INTO stats (key, value) VALUES (?, 0)");

  for (const key of [
    "messagesReceived",
    "messagesReplied",
    "visionRequests",
    "errors",
  ]) {
    if (!existsStat.get(key)) {
      insertStat.run(key);
    }
  }

  migrateLegacySystemPrompt();
  bindHistoryDatabase(db);
  bindUserMemoryDatabase(db);
  bindGroupMemoryDatabase(db);
  bindErrorLogDatabase(db);
  bindMessageRefsDatabase(db);
  configureHistoryAccess(getSettings);
}

function migrateLegacySystemPrompt(): void {
  const hasCustom = db
    .prepare("SELECT 1 FROM settings WHERE key = 'customSystemPrompt'")
    .get();
  if (hasCustom) return;

  const legacy = db
    .prepare("SELECT value FROM settings WHERE key = 'systemPrompt'")
    .get() as { value: string } | undefined;

  const value = legacy
    ? (JSON.parse(legacy.value) as string)
    : DEFAULT_SETTINGS.customSystemPrompt;

  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
    "customSystemPrompt",
    JSON.stringify(value),
  );
}

function getSetting<T>(key: keyof Settings): T {
  const row = db
    .prepare("SELECT value FROM settings WHERE key = ?")
    .get(key) as { value: string } | undefined;
  if (!row) return DEFAULT_SETTINGS[key] as T;
  return JSON.parse(row.value) as T;
}

function setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
  db.prepare(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(key, JSON.stringify(value));
}

export function getSettings(): Settings {
  return {
    ollamaHost: getSetting<string>("ollamaHost"),
    model: getSetting<string>("model"),
    customSystemPrompt: getSetting<string>("customSystemPrompt"),
    randomReplyEnabled: getSetting<boolean>("randomReplyEnabled"),
    randomReplyChance: getSetting<number>("randomReplyChance"),
    numPredict: getSetting<number>("numPredict"),
    numCtx: getSetting<number>("numCtx"),
    temperature: getSetting<number>("temperature"),
    chatTimeoutSec: getSetting<number>("chatTimeoutSec"),
    historyMaxMessages: getSetting<number>("historyMaxMessages"),
    historyMaxChars: getSetting<number>("historyMaxChars"),
    historyMaxReplyChars: getSetting<number>("historyMaxReplyChars"),
    visionMaxDimension: getSetting<number>("visionMaxDimension"),
  };
}

export function updateSettings(partial: Partial<Settings>): Settings {
  const current = getSettings();
  const next = { ...current, ...partial };

  validateSettingsFields(next);

  for (const key of Object.keys(next) as (keyof Settings)[]) {
    setSetting(key, next[key]);
  }
  return next;
}

function incrementStat(key: keyof Stats): void {
  if (key === "lastActivityAt") return;
  db.prepare("UPDATE stats SET value = value + 1 WHERE key = ?").run(key);
}

export function getStats(): Stats {
  const rows = db.prepare("SELECT key, value FROM stats").all() as {
    key: string;
    value: number;
  }[];
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  const lastRow = db
    .prepare("SELECT value FROM stats_meta WHERE key = 'lastActivityAt'")
    .get() as { value: string } | undefined;

  return {
    messagesReceived: map.messagesReceived ?? 0,
    messagesReplied: map.messagesReplied ?? 0,
    visionRequests: map.visionRequests ?? 0,
    errors: map.errors ?? 0,
    lastActivityAt: lastRow?.value ?? null,
  };
}

export function recordMessageReceived(): void {
  incrementStat("messagesReceived");
  touchActivity();
}

export function recordReply(usedVision: boolean): void {
  incrementStat("messagesReplied");
  if (usedVision) incrementStat("visionRequests");
  touchActivity();
}

export interface ErrorLogInput {
  message: string;
  stack?: string;
  chatId?: number;
  userId?: string;
}

export function recordError(detail?: ErrorLogInput): void {
  incrementStat("errors");
  touchActivity();
  if (detail) {
    appendErrorLog(detail);
  }
}

function touchActivity(): void {
  db.prepare(
    "INSERT INTO stats_meta (key, value) VALUES ('lastActivityAt', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(new Date().toISOString());
}
