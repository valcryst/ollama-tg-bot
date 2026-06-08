import type { Settings } from "./db/database.js";

export interface HistoryLimits {
  historyMaxMessages: number;
  historyMaxChars: number;
  historyMaxReplyChars: number;
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
    `Keep every [REPLY] within your output budget (~${maxTokens} tokens, ` +
    `about ${maxChars} characters). Be shorter when a brief answer is enough.`;

  const formatHint =
    `Up to ~${maxChars} characters (~${maxTokens} tokens), ` +
    `Telegram HTML (<b> <i> <code> only).`;

  return { maxTokens, maxChars, systemHint, formatHint };
}

/** Derive chat history caps from Ollama context and reply token settings. */
export function getHistoryLimits(settings: Settings): HistoryLimits {
  const { numCtx, numPredict } = settings;

  const historyTokenBudget = Math.max(
    256,
    Math.floor((numCtx - numPredict) * 0.45),
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
  };
}

export function getOllamaChatOptions(
  settings: Settings,
  overrides?: { numPredict?: number },
) {
  return {
    num_predict: overrides?.numPredict ?? settings.numPredict,
    num_ctx: settings.numCtx,
    temperature: settings.temperature,
    top_p: 0.9,
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
  ];

  const failed = checks.find(([, ok]) => !ok);
  if (failed) throw new Error(failed[0]);
}
