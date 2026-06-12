import { getBot, getBotUsername } from "./bot/index.js";
import { getVramAvailableGb } from "./config.js";
import { getSettings, getStats } from "./db/database.js";
import { listRecentErrors } from "./db/error-log.js";
import { getMoodStateView } from "./db/mood.js";
import {
  getActivePersonalityMoodDefaults,
  getPersonalityById,
  resolveActivePersonalityId,
} from "./db/personalities.js";
import { ensureModelContextCache } from "./llm/model-context-cache.js";
import { MOOD_TRAIT_HINTS } from "./mood.js";
import { buildBaseSystemPrompt } from "./prompts.js";
import { processStartedAt } from "./process-info.js";
import {
  getContextBudgetForSettings,
  getResolvedHistoryLimits,
  getResolvedSettings,
} from "./settings-runtime.js";

export function buildStatsPayload() {
  const stats = getStats();
  let botRunning = false;
  try {
    getBot();
    botRunning = true;
  } catch {
    botRunning = false;
  }

  return {
    ...stats,
    botUsername: getBotUsername() || null,
    botRunning,
    uptimeSeconds: Math.floor(
      (Date.now() - processStartedAt.getTime()) / 1000,
    ),
    startedAt: processStartedAt.toISOString(),
    recentErrors: listRecentErrors(20),
  };
}

export function buildMoodPayload() {
  const settings = getSettings();
  const activePersonalityId = resolveActivePersonalityId(
    settings.activePersonalityId,
  );
  const activePersonality = activePersonalityId
    ? getPersonalityById(activePersonalityId)
    : null;

  return {
    defaults: getActivePersonalityMoodDefaults(),
    activePersonalityId,
    activePersonalityName: activePersonality?.name ?? null,
    cooldownMinutes: settings.moodCooldownMinutes,
    traitHints: MOOD_TRAIT_HINTS,
    current: getMoodStateView(),
  };
}

export async function buildSettingsPayload() {
  const settings = getSettings();
  await ensureModelContextCache(settings.model, settings.apiBaseUrl);
  const resolved = getResolvedSettings(settings);
  return {
    ...resolved,
    baseSystemPrompt: buildBaseSystemPrompt(resolved),
    derivedHistoryLimits: getResolvedHistoryLimits(settings),
    contextBudget: getContextBudgetForSettings(settings),
    vramAvailableGb: getVramAvailableGb(),
  };
}
