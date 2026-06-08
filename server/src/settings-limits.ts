import type { Settings } from "./db/database.js";

export const MAX_NUM_PREDICT = 2048;

/** Extra num_predict reserved for reasoning when thinking mode is on. */
export const THINKING_NUM_PREDICT_BUMP = 1024;

export interface HistoryLimits {
  historyMaxMessages: number;
  historyMaxChars: number;
  historyMaxReplyChars: number;
  /** num_predict sent to Ollama when thinking is enabled (reply + reasoning). */
  effectiveNumPredict: number;
  /** Reasoning reserve included in effectiveNumPredict (0 when thinking is off). */
  thinkingNumPredictBump: number;
}

export function getThinkingNumPredictBump(settings: Settings): number {
  return settings.thinkingEnabled ? THINKING_NUM_PREDICT_BUMP : 0;
}

/** Ollama num_predict for a request, including the thinking reserve when applicable. */
export function getEffectiveNumPredict(
  settings: Settings,
  options?: { think?: boolean; baseNumPredict?: number },
): number {
  const base = options?.baseNumPredict ?? settings.numPredict;
  const useThinking =
    options?.think !== undefined
      ? options.think && settings.thinkingEnabled
      : settings.thinkingEnabled;
  if (!useThinking) return base;
  return Math.min(
    MAX_NUM_PREDICT,
    base + getThinkingNumPredictBump(settings),
  );
}

export interface ReplyLengthGuidance {
  maxTokens: number;
  maxChars: number;
  systemHint: string;
  formatHint: string;
}

/** Reply brevity instructions derived from num_predict and historyMaxReplyChars. */
export function getReplyLengthGuidance(settings: Settings): ReplyLengthGuidance {
  const maxTokens = settings.numPredict;
  const { historyMaxReplyChars } = getHistoryLimits(settings);
  const maxChars = historyMaxReplyChars;

  const systemHint =
    `Your output budget (~${maxTokens} tokens, about ${maxChars} characters) is a maximum — ` +
    `you are NOT required to use it. Reply as short as the context warrants: a word, a line, ` +
    `or a terse reaction is fine when enough. Never pad or elaborate just to fill the budget.`;

  const formatHint =
    `Maximum ~${maxChars} characters (~${maxTokens} tokens) — use only what you need; ` +
    `shorter is fine. Telegram HTML (<b> <i> <code> only).`;

  return { maxTokens, maxChars, systemHint, formatHint };
}

/** Derive chat history caps from Ollama context and generation token settings. */
export function getHistoryLimits(settings: Settings): HistoryLimits {
  const { numCtx, numPredict } = settings;
  const thinkingNumPredictBump = getThinkingNumPredictBump(settings);
  const effectiveNumPredict = getEffectiveNumPredict(settings, { think: true });

  const historyTokenBudget = Math.max(
    256,
    Math.floor((numCtx - effectiveNumPredict) * 0.45),
  );

  return {
    historyMaxChars: Math.min(
      32000,
      Math.max(500, Math.floor(historyTokenBudget * 3.5)),
    ),
    historyMaxMessages: Math.min(50, Math.max(4, Math.floor(numCtx / 512))),
    historyMaxReplyChars: Math.min(
      4000,
      Math.max(100, Math.floor(numPredict * 0.85)),
    ),
    effectiveNumPredict,
    thinkingNumPredictBump,
  };
}

/** Low temperature for structured side passes (mood, memory, search, etc.). */
export const AUXILIARY_TEMPERATURE = 0.2;

export function getOllamaChatOptions(
  settings: Settings,
  overrides?: { numPredict?: number; auxiliary?: boolean },
) {
  return {
    num_predict: overrides?.numPredict ?? settings.numPredict,
    num_ctx: settings.numCtx,
    temperature: overrides?.auxiliary
      ? AUXILIARY_TEMPERATURE
      : settings.temperature,
    top_p: settings.topP,
    top_k: settings.topK,
    repeat_penalty: settings.repeatPenalty,
  };
}

/** Minimum num_predict for a length-limit retry after an empty response. */
export const LENGTH_RETRY_MIN_PREDICT = 512;

export function getChatTimeoutMs(settings: Settings): number {
  return settings.chatTimeoutSec * 1000;
}

export function validateSettingsFields(settings: Settings): void {
  const checks: [string, boolean][] = [
    ["numPredict must be 32–2048", settings.numPredict >= 32 && settings.numPredict <= 2048],
    ["numCtx must be 2048–32768", settings.numCtx >= 2048 && settings.numCtx <= 32768],
    ["temperature must be 0–2", settings.temperature >= 0 && settings.temperature <= 2],
    ["topP must be 0.05–1", settings.topP >= 0.05 && settings.topP <= 1],
    [
      "topK must be 1–200",
      Number.isInteger(settings.topK) && settings.topK >= 1 && settings.topK <= 200,
    ],
    [
      "repeatPenalty must be 0.8–2",
      settings.repeatPenalty >= 0.8 && settings.repeatPenalty <= 2,
    ],
    [
      "chatTimeoutSec must be 30–600",
      settings.chatTimeoutSec >= 30 && settings.chatTimeoutSec <= 600,
    ],
    [
      "visionMaxDimension must be 256–2048",
      settings.visionMaxDimension >= 256 && settings.visionMaxDimension <= 2048,
    ],
    [
      "randomReplyChance must be 0–100",
      settings.randomReplyChance >= 0 && settings.randomReplyChance <= 100,
    ],
    [
      "ownerUsername must be empty or a valid Telegram username",
      settings.ownerUsername.trim() === "" ||
        /^[a-z0-9_]{5,32}$/i.test(settings.ownerUsername.trim()),
    ],
    [
      "ownerUserId must be empty or a numeric Telegram user id",
      settings.ownerUserId.trim() === "" ||
        /^\d{1,20}$/.test(settings.ownerUserId.trim()),
    ],
    [
      "ownerUserId is required when ownerUsername is set",
      settings.ownerUsername.trim() === "" || settings.ownerUserId.trim() !== "",
    ],
    [
      "stickerPackName must be empty or a valid sticker set name",
      settings.stickerPackName.trim() === "" ||
        /^[a-zA-Z0-9_]{1,64}$/.test(settings.stickerPackName.trim()),
    ],
    [
      "stickerPackName is required when stickers are enabled",
      !settings.stickersEnabled || settings.stickerPackName.trim() !== "",
    ],
    [
      "stickerReplyChance must be 0–100",
      settings.stickerReplyChance >= 0 && settings.stickerReplyChance <= 100,
    ],
    [
      "activePersonalityId must be a non-negative integer",
      Number.isInteger(settings.activePersonalityId) &&
        settings.activePersonalityId >= 0,
    ],
    [
      "moodCooldownMinutes must be 5–1440",
      settings.moodCooldownMinutes >= 5 && settings.moodCooldownMinutes <= 1440,
    ],
    [
      "sendThinkingEnabled requires thinkingEnabled",
      !settings.sendThinkingEnabled || settings.thinkingEnabled,
    ],
  ];

  const failed = checks.find(([, ok]) => !ok);
  if (failed) throw new Error(failed[0]);
}
