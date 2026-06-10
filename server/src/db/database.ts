import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "../config.js";
import { bindHistoryDatabase, configureHistoryAccess } from "./history.js";
import { bindGeneralMemoryDatabase } from "./general-memory.js";
import { bindGroupMemoryDatabase } from "./group-memory.js";
import { bindUserMemoryDatabase } from "./user-memory.js";
import {
  appendErrorLog,
  bindErrorLogDatabase,
  clearErrorLog,
} from "./error-log.js";
import { bindKnownUsersDatabase } from "./known-users.js";
import { bindDataBrowserDatabase } from "./data-browser.js";
import {
  bindPersonalitiesDatabase,
  configurePersonalityAccess,
  getPersonalityById,
} from "./personalities.js";
import {
  invalidateModelContextCache,
  refreshModelContextCache,
} from "../llm/model-context-cache.js";
import { getResolvedSettings } from "../settings-runtime.js";
import {
  normalizeTokenBudget,
  validateSettingsFields,
} from "../settings-limits.js";
import { bindMoodDatabase, configureMoodAccess } from "./mood.js";

export interface Settings {
  apiBaseUrl: string;
  model: string;
  /** Id of the personality whose prompt is layered on the base system prompt (0 = none). */
  activePersonalityId: number;
  randomReplyEnabled: boolean;
  randomReplyChance: number;
  /** In groups, comment on photos/image files even when not addressed to the bot. */
  reactToEveryImage: boolean;
  /** Max tokens LLM may generate per reply (lower = faster). */
  numPredict: number;
  /** Context window size sent to LLM. */
  numCtx: number;
  temperature: number;
  /** Nucleus sampling — lower = more focused (LLM top_p). */
  topP: number;
  /** Limits candidate tokens per step (LLM top_k). */
  topK: number;
  /** Penalizes repeated tokens (LLM repeat_penalty). */
  repeatPenalty: number;
  /** LLM request timeout in seconds. */
  chatTimeoutSec: number;
  /** Longest edge for vision images (pixels). */
  visionMaxDimension: number;
  /** Telegram @username of the bot owner (empty = not set). */
  ownerUsername: string;
  /** Resolved numeric user id for ownerUsername (set by the server). */
  ownerUserId: string;
  /** Send stickers from a configured Telegram sticker set. */
  stickersEnabled: boolean;
  /** Telegram sticker set name (e.g. HotCherry or MyPack_by_botname). */
  stickerPackName: string;
  /** How often the model should include a sticker (0–100). */
  stickerReplyChance: number;
  /** Minutes of inactivity until mood returns to the active personality's defaults. */
  moodCooldownMinutes: number;
  /** Enable LLM thinking mode for reasoning models (separate chain-of-thought). */
  thinkingEnabled: boolean;
  /** Target thinking slice of generation token (soft; LLM shares one generation budget). */
  thinkingNumPredict: number;
  /** Send model thinking to Telegram as a message before the reply (replies only). */
  sendThinkingEnabled: boolean;
}

export interface Stats {
  messagesReceived: number;
  messagesReplied: number;
  visionRequests: number;
  errors: number;
  lastActivityAt: string | null;
}

const DEFAULT_SETTINGS: Settings = {
  apiBaseUrl: "",
  model: "gpt-4o-mini",
  activePersonalityId: 0,
  randomReplyEnabled: false,
  randomReplyChance: 5,
  reactToEveryImage: false,
  numPredict: 512,
  numCtx: 4096,
  temperature: 0.7,
  topP: 0.9,
  topK: 40,
  repeatPenalty: 1.1,
  chatTimeoutSec: 120,
  visionMaxDimension: 768,
  ownerUsername: "",
  ownerUserId: "",
  stickersEnabled: false,
  stickerPackName: "",
  stickerReplyChance: 70,
  moodCooldownMinutes: 120,
  thinkingEnabled: false,
  thinkingNumPredict: 384,
  sendThinkingEnabled: false,
};

let db: DatabaseSync;

export function initDatabase(): void {
  const dir = path.dirname(config.databasePath);
  fs.mkdirSync(dir, { recursive: true });

  db = new DatabaseSync(config.databasePath);
  db.exec("PRAGMA journal_mode = WAL");

  db.exec(`
    DROP TABLE IF EXISTS message_refs;
    DROP TABLE IF EXISTS group_activity;

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

  bindPersonalitiesDatabase(db);
  configurePersonalityAccess(getSettings);
  bindHistoryDatabase(db);
  bindUserMemoryDatabase(db);
  bindGroupMemoryDatabase(db);
  bindGeneralMemoryDatabase(db);
  bindErrorLogDatabase(db);
  bindKnownUsersDatabase(db);
  bindDataBrowserDatabase(db);
  bindMoodDatabase(db);
  configureHistoryAccess(getResolvedSettings);
  configureMoodAccess(getSettings);
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
    apiBaseUrl: getSetting<string>("apiBaseUrl"),
    model: getSetting<string>("model"),
    activePersonalityId: getSetting<number>("activePersonalityId"),
    randomReplyEnabled: getSetting<boolean>("randomReplyEnabled"),
    randomReplyChance: getSetting<number>("randomReplyChance"),
    reactToEveryImage: getSetting<boolean>("reactToEveryImage"),
    numPredict: getSetting<number>("numPredict"),
    numCtx: getSetting<number>("numCtx"),
    temperature: getSetting<number>("temperature"),
    topP: getSetting<number>("topP"),
    topK: getSetting<number>("topK"),
    repeatPenalty: getSetting<number>("repeatPenalty"),
    chatTimeoutSec: getSetting<number>("chatTimeoutSec"),
    visionMaxDimension: getSetting<number>("visionMaxDimension"),
    ownerUsername: getSetting<string>("ownerUsername"),
    ownerUserId: getSetting<string>("ownerUserId"),
    stickersEnabled: getSetting<boolean>("stickersEnabled"),
    stickerPackName: getSetting<string>("stickerPackName"),
    stickerReplyChance: getSetting<number>("stickerReplyChance"),
    moodCooldownMinutes: getSetting<number>("moodCooldownMinutes"),
    thinkingEnabled: getSetting<boolean>("thinkingEnabled"),
    thinkingNumPredict: getSetting<number>("thinkingNumPredict"),
    sendThinkingEnabled: getSetting<boolean>("sendThinkingEnabled"),
  };
}

export function updateSettings(partial: Partial<Settings>): Settings {
  const current = getSettings();
  const { numCtx: _ignoredCtx, ...rest } = partial;
  const next = { ...current, ...rest };
  if (partial.ownerUsername !== undefined) {
    const raw = partial.ownerUsername.trim();
    next.ownerUsername =
      raw === "" ? "" : raw.replace(/^@/, "").toLowerCase();
  }
  if (partial.ownerUserId !== undefined) {
    next.ownerUserId = partial.ownerUserId.trim();
  }
  if (partial.stickerPackName !== undefined) {
    next.stickerPackName = partial.stickerPackName.trim().replace(/^@/, "");
  }
  if (partial.topK !== undefined) {
    next.topK = Math.round(partial.topK);
  }
  if (partial.model !== undefined || partial.apiBaseUrl !== undefined) {
    invalidateModelContextCache();
  }

  const normalized = normalizeTokenBudget(next);
  const resolved = getResolvedSettings(normalized);
  validateSettingsFields(resolved);

  if (resolved.activePersonalityId > 0 && !getPersonalityById(resolved.activePersonalityId)) {
    throw new Error("activePersonalityId does not match a saved personality");
  }

  for (const key of Object.keys(resolved) as (keyof Settings)[]) {
    setSetting(key, resolved[key]);
  }

  void refreshModelContextCache(resolved.model, resolved.apiBaseUrl);
  return resolved;
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

export function clearErrors(): number {
  const deleted = clearErrorLog();
  db.prepare("UPDATE stats SET value = 0 WHERE key = 'errors'").run();
  return deleted;
}

function touchActivity(): void {
  db.prepare(
    "INSERT INTO stats_meta (key, value) VALUES ('lastActivityAt', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(new Date().toISOString());
}
