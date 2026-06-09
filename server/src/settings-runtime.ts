import type { Settings } from "./db/database.js";
import { getSettings } from "./db/database.js";
import {
  buildContextBudget,
  getEffectiveNumCtx,
  type ContextBudget,
} from "./context-budget.js";
import { getModelContextForBudget } from "./ollama/model-context-cache.js";
import {
  getHistoryLimits,
  normalizeTokenBudget,
  type HistoryLimits,
} from "./settings-limits.js";

export function getResolvedSettings(settings: Settings = getSettings()): Settings {
  const normalized = normalizeTokenBudget(settings);
  const model = getModelContextForBudget(
    normalized.model,
    normalized.ollamaHost,
  );
  const numCtx = getEffectiveNumCtx(normalized, model);
  return { ...normalized, numCtx };
}

export function getResolvedHistoryLimits(
  settings: Settings = getSettings(),
): HistoryLimits {
  return getHistoryLimits(getResolvedSettings(settings));
}

export function getContextBudgetForSettings(
  settings: Settings = getSettings(),
): ContextBudget {
  const normalized = normalizeTokenBudget(settings);
  const model = getModelContextForBudget(
    normalized.model,
    normalized.ollamaHost,
  );
  return buildContextBudget(normalized, model);
}
