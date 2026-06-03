import type { Settings } from "./db/database.js";

export function getOllamaChatOptions(settings: Settings) {
  return {
    num_predict: settings.numPredict,
    num_ctx: settings.numCtx,
    temperature: settings.temperature,
    top_p: 0.9,
  };
}

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
      "historyMaxMessages must be 0–50",
      settings.historyMaxMessages >= 0 && settings.historyMaxMessages <= 50,
    ],
    [
      "historyMaxChars must be 500–32000",
      settings.historyMaxChars >= 500 && settings.historyMaxChars <= 32000,
    ],
    [
      "historyMaxReplyChars must be 100–4000",
      settings.historyMaxReplyChars >= 100 && settings.historyMaxReplyChars <= 4000,
    ],
    [
      "visionMaxDimension must be 256–2048",
      settings.visionMaxDimension >= 256 && settings.visionMaxDimension <= 2048,
    ],
    [
      "randomReplyChance must be 0–100",
      settings.randomReplyChance >= 0 && settings.randomReplyChance <= 100,
    ],
  ];

  const failed = checks.find(([, ok]) => !ok);
  if (failed) throw new Error(failed[0]);
}
