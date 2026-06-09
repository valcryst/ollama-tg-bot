import type { Settings } from "./db/database.js";

export const MIN_NUM_PREDICT = 32;
export const MAX_NUM_PREDICT = 2048;
export const NUM_PREDICT_STEP = 32;
export const MIN_THINKING_TOKENS = 32;
export const MIN_REPLY_TOKENS = 32;
export const DEFAULT_THINKING_NUM_PREDICT = 384;
const APPROX_CHARS_PER_TOKEN = 3.5;

export interface HistoryLimits {
  historyMaxMessages: number;
  historyMaxChars: number;
  historyMaxReplyChars: number;
  /** Total num_predict (reply + thinking when thinking is on). */
  numPredict: number;
  thinkingNumPredict: number;
  replyNumPredict: number;
}

export function snapNumPredict(value: number): number {
  const snapped = Math.round(value / NUM_PREDICT_STEP) * NUM_PREDICT_STEP;
  return Math.min(MAX_NUM_PREDICT, Math.max(MIN_NUM_PREDICT, snapped));
}

export function clampThinkingSplit(
  total: number,
  thinking: number,
): { total: number; thinking: number } {
  const snappedTotal = snapNumPredict(total);
  let snappedThinking = snapNumPredict(thinking);
  snappedThinking = Math.min(
    snappedTotal - MIN_REPLY_TOKENS,
    Math.max(MIN_THINKING_TOKENS, snappedThinking),
  );
  return { total: snappedTotal, thinking: snappedThinking };
}

export function defaultThinkingForTotal(total: number): number {
  const snappedTotal = snapNumPredict(total);
  return Math.min(
    DEFAULT_THINKING_NUM_PREDICT,
    Math.max(MIN_THINKING_TOKENS, snappedTotal - MIN_REPLY_TOKENS),
  );
}

export function getThinkingNumPredict(settings: Settings): number {
  if (!settings.thinkingEnabled) return 0;
  return settings.thinkingNumPredict;
}

export function getReplyNumPredict(settings: Settings): number {
  if (!settings.thinkingEnabled) return settings.numPredict;
  return settings.numPredict - getThinkingNumPredict(settings);
}

/** Ollama num_predict for a request (total generation budget). */
export function getEffectiveNumPredict(
  settings: Settings,
  options?: { baseNumPredict?: number },
): number {
  return snapNumPredict(options?.baseNumPredict ?? settings.numPredict);
}

/** Normalize token budget fields after settings changes. */
export function normalizeTokenBudget(settings: Settings): Settings {
  const numPredict = snapNumPredict(settings.numPredict);
  if (!settings.thinkingEnabled) {
    return { ...settings, numPredict };
  }
  const split = clampThinkingSplit(numPredict, settings.thinkingNumPredict);
  return {
    ...settings,
    numPredict: split.total,
    thinkingNumPredict: split.thinking,
  };
}

export interface ReplyLengthGuidance {
  maxTokens: number;
  maxChars: number;
  systemHint: string;
  formatHint: string;
}

/** Reply brevity instructions derived from reply token budget. */
export function getReplyLengthGuidance(settings: Settings): ReplyLengthGuidance {
  const maxTokens = getReplyNumPredict(settings);
  const { historyMaxReplyChars } = getHistoryLimits(settings);
  const maxChars = historyMaxReplyChars;

  const systemHint =
    `Your output budget (~${maxTokens} tokens, about ${maxChars} characters) is a maximum — ` +
    `you are NOT required to use it. Reply as short as the context warrants: a word, a line, ` +
    `or a terse reaction is fine when enough. Never pad or elaborate just to fill the budget.`;

  const formatHint =
    `Maximum ~${maxChars} characters (~${maxTokens} tokens) — use only what you need; shorter is fine. ` +
    `Plain text is the default. You may use Telegram HTML (<b> <i> <code> only) for occasional emphasis when it helps — you do not have to use tags at all.`;

  return { maxTokens, maxChars, systemHint, formatHint };
}

/** Derive chat history caps from Ollama context and generation token settings. */
export function getHistoryLimits(settings: Settings): HistoryLimits {
  const { numCtx } = settings;
  const normalized = normalizeTokenBudget(settings);
  const thinkingNumPredict = getThinkingNumPredict(normalized);
  const replyNumPredict = getReplyNumPredict(normalized);

  const historyTokenBudget = Math.max(
    256,
    Math.floor((numCtx - normalized.numPredict) * 0.45),
  );

  return {
    historyMaxChars: Math.min(
      32000,
      Math.max(500, Math.floor(historyTokenBudget * 3.5)),
    ),
    historyMaxMessages: Math.min(50, Math.max(4, Math.floor(numCtx / 512))),
    historyMaxReplyChars: Math.min(
      4000,
      Math.max(100, Math.floor(replyNumPredict * APPROX_CHARS_PER_TOKEN)),
    ),
    numPredict: normalized.numPredict,
    thinkingNumPredict,
    replyNumPredict,
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

export function getOllamaRequestTimeoutMs(
  settings: Settings,
  _options?: { auxiliary?: boolean },
): number {
  return getChatTimeoutMs(settings);
}

export function validateSettingsFields(settings: Settings): void {
  const normalized = normalizeTokenBudget(settings);
  const isFiniteNumber = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);
  const isBoolean = (value: unknown): value is boolean =>
    typeof value === "boolean";
  const isString = (value: unknown): value is string =>
    typeof value === "string";

  const checks: [string, boolean][] = [
    ["ollamaHost must be a string", isString(settings.ollamaHost)],
    ["model must be a string", isString(settings.model)],
    ["randomReplyEnabled must be true or false", isBoolean(settings.randomReplyEnabled)],
    ["reactToEveryImage must be true or false", isBoolean(settings.reactToEveryImage)],
    ["stickersEnabled must be true or false", isBoolean(settings.stickersEnabled)],
    ["thinkingEnabled must be true or false", isBoolean(settings.thinkingEnabled)],
    ["sendThinkingEnabled must be true or false", isBoolean(settings.sendThinkingEnabled)],
    ["ownerUsername must be a string", isString(settings.ownerUsername)],
    ["ownerUserId must be a string", isString(settings.ownerUserId)],
    ["stickerPackName must be a string", isString(settings.stickerPackName)],
    ["numPredict must be a number", isFiniteNumber(settings.numPredict)],
    ["thinkingNumPredict must be a number", isFiniteNumber(settings.thinkingNumPredict)],
    ["numCtx must be a number", isFiniteNumber(settings.numCtx)],
    ["temperature must be a number", isFiniteNumber(settings.temperature)],
    ["topP must be a number", isFiniteNumber(settings.topP)],
    ["topK must be a number", isFiniteNumber(settings.topK)],
    ["repeatPenalty must be a number", isFiniteNumber(settings.repeatPenalty)],
    ["chatTimeoutSec must be a number", isFiniteNumber(settings.chatTimeoutSec)],
    ["visionMaxDimension must be a number", isFiniteNumber(settings.visionMaxDimension)],
    ["randomReplyChance must be a number", isFiniteNumber(settings.randomReplyChance)],
    ["stickerReplyChance must be a number", isFiniteNumber(settings.stickerReplyChance)],
    ["activePersonalityId must be a number", isFiniteNumber(settings.activePersonalityId)],
    ["moodCooldownMinutes must be a number", isFiniteNumber(settings.moodCooldownMinutes)],
    [
      "numPredict must be 32–2048",
      isFiniteNumber(normalized.numPredict) &&
        normalized.numPredict >= MIN_NUM_PREDICT &&
        normalized.numPredict <= MAX_NUM_PREDICT,
    ],
    [
      "thinkingNumPredict must leave at least 32 tokens for reply",
      !normalized.thinkingEnabled ||
        (isFiniteNumber(normalized.thinkingNumPredict) &&
          normalized.thinkingNumPredict >= MIN_THINKING_TOKENS &&
          normalized.thinkingNumPredict <=
            normalized.numPredict - MIN_REPLY_TOKENS),
    ],
    ["numCtx must be 2048–32768", isFiniteNumber(settings.numCtx) && settings.numCtx >= 2048 && settings.numCtx <= 32768],
    ["temperature must be 0–2", isFiniteNumber(settings.temperature) && settings.temperature >= 0 && settings.temperature <= 2],
    ["topP must be 0.05–1", isFiniteNumber(settings.topP) && settings.topP >= 0.05 && settings.topP <= 1],
    [
      "topK must be 1–200",
      Number.isInteger(settings.topK) &&
        settings.topK >= 1 &&
        settings.topK <= 200,
    ],
    [
      "repeatPenalty must be 0.8–2",
      isFiniteNumber(settings.repeatPenalty) &&
        settings.repeatPenalty >= 0.8 &&
        settings.repeatPenalty <= 2,
    ],
    [
      "chatTimeoutSec must be 30–600",
      isFiniteNumber(settings.chatTimeoutSec) &&
        settings.chatTimeoutSec >= 30 &&
        settings.chatTimeoutSec <= 600,
    ],
    [
      "visionMaxDimension must be 256–2048",
      isFiniteNumber(settings.visionMaxDimension) &&
        settings.visionMaxDimension >= 256 &&
        settings.visionMaxDimension <= 2048,
    ],
    [
      "randomReplyChance must be 0–100",
      isFiniteNumber(settings.randomReplyChance) &&
        settings.randomReplyChance >= 0 &&
        settings.randomReplyChance <= 100,
    ],
    [
      "ownerUsername must be empty or a valid Telegram username",
      isString(settings.ownerUsername) &&
        (settings.ownerUsername.trim() === "" ||
          /^[a-z0-9_]{5,32}$/i.test(settings.ownerUsername.trim())),
    ],
    [
      "ownerUserId must be empty or a numeric Telegram user id",
      isString(settings.ownerUserId) &&
        (settings.ownerUserId.trim() === "" ||
          /^\d{1,20}$/.test(settings.ownerUserId.trim())),
    ],
    [
      "ownerUserId is required when ownerUsername is set",
      isString(settings.ownerUsername) &&
        isString(settings.ownerUserId) &&
        (settings.ownerUsername.trim() === "" ||
          settings.ownerUserId.trim() !== ""),
    ],
    [
      "stickerPackName must be empty or a valid sticker set name",
      isString(settings.stickerPackName) &&
        (settings.stickerPackName.trim() === "" ||
          /^[a-zA-Z0-9_]{1,64}$/.test(settings.stickerPackName.trim())),
    ],
    [
      "stickerPackName is required when stickers are enabled",
      isBoolean(settings.stickersEnabled) &&
        isString(settings.stickerPackName) &&
        (!settings.stickersEnabled || settings.stickerPackName.trim() !== ""),
    ],
    [
      "stickerReplyChance must be 0–100",
      isFiniteNumber(settings.stickerReplyChance) &&
        settings.stickerReplyChance >= 0 &&
        settings.stickerReplyChance <= 100,
    ],
    [
      "activePersonalityId must be a non-negative integer",
      Number.isInteger(settings.activePersonalityId) &&
        settings.activePersonalityId >= 0,
    ],
    [
      "moodCooldownMinutes must be 5–1440",
      isFiniteNumber(settings.moodCooldownMinutes) &&
        settings.moodCooldownMinutes >= 5 &&
        settings.moodCooldownMinutes <= 1440,
    ],
    [
      "sendThinkingEnabled requires thinkingEnabled",
      !settings.sendThinkingEnabled || settings.thinkingEnabled,
    ],
  ];

  const failed = checks.find(([, ok]) => !ok);
  if (failed) throw new Error(failed[0]);
}
