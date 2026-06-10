import type { ContextBudget } from "./contextBudgetCalc";
import type { Settings } from "./api";
import {
  DEFAULT_THINKING_NUM_PREDICT,
  MIN_REPLY_TOKENS,
  MIN_THINKING_TOKENS,
  NUM_CTX_GENERATION_HEADROOM,
  clampThinkingSplit,
  defaultThinkingForTotal,
  deriveHistoryLimits,
  maxNumPredictForContext,
  minNumCtxForPredict,
  snapNumPredict,
  type DerivedHistoryLimits,
} from "./tokenBudget";

export type ModelConfigField =
  | "numPredict"
  | "thinkingNumPredict"
  | "thinkingEnabled"
  | "sendThinkingEnabled"
  | "temperature"
  | "topP"
  | "topK"
  | "repeatPenalty"
  | "chatTimeoutSec";

export type ModelConfigIssue = {
  field: ModelConfigField | "model";
  severity: "error" | "warning";
  message: string;
};

export type ModelConfigPatch = Partial<
  Pick<
    Settings,
    | "numPredict"
    | "thinkingNumPredict"
    | "thinkingEnabled"
    | "sendThinkingEnabled"
    | "temperature"
    | "topP"
    | "topK"
    | "repeatPenalty"
    | "chatTimeoutSec"
  >
>;

export type ModelConfigAnalysis = {
  settings: Settings;
  derived: DerivedHistoryLimits;
  issues: ModelConfigIssue[];
  effectiveNumCtx: number;
  minNumCtx: number;
  maxNumPredict: number;
  contextBudget: ContextBudget;
};

export type ModelConfigUpdateResult =
  | { ok: true; settings: Settings }
  | { ok: false; settings: Settings; issue: ModelConfigIssue };

function normalizeModelFields(
  settings: Settings,
  effectiveNumCtx: number,
): Settings {
  const maxPredict = maxNumPredictForContext(effectiveNumCtx);
  const numPredict = snapNumPredict(Math.min(settings.numPredict, maxPredict));

  if (!settings.thinkingEnabled) {
    return {
      ...settings,
      numCtx: effectiveNumCtx,
      numPredict,
      sendThinkingEnabled: false,
    };
  }

  const split = clampThinkingSplit(numPredict, settings.thinkingNumPredict);
  return {
    ...settings,
    numCtx: effectiveNumCtx,
    numPredict: split.total,
    thinkingNumPredict: split.thinking,
    sendThinkingEnabled: settings.sendThinkingEnabled,
  };
}

export function analyzeModelConfig(
  settings: Settings,
  contextBudget: ContextBudget,
): ModelConfigAnalysis {
  const effectiveNumCtx = contextBudget.effectiveNumCtx;
  const normalized = normalizeModelFields(settings, effectiveNumCtx);
  const derived = deriveHistoryLimits(
    effectiveNumCtx,
    normalized.numPredict,
    normalized.thinkingEnabled,
    normalized.thinkingNumPredict,
  );
  const minNumCtx = minNumCtxForPredict(normalized.numPredict);
  const maxNumPredict = maxNumPredictForContext(effectiveNumCtx);
  const issues: ModelConfigIssue[] = [];

  if (effectiveNumCtx < minNumCtx) {
    issues.push({
      field: "numPredict",
      severity: "error",
      message:
        `Generation budget (${normalized.numPredict} tokens) needs at least ` +
        `${minNumCtx} context (${NUM_CTX_GENERATION_HEADROOM} headroom). ` +
        `Lower generation tokens or increase VRAM_AVAILABLE / use a smaller model.`,
    });
  }

  if (settings.numPredict > maxNumPredict) {
    issues.push({
      field: "numPredict",
      severity: "error",
      message:
        `Generation budget cannot exceed ${maxNumPredict} with derived context ` +
        `${effectiveNumCtx}. Lower generation tokens.`,
    });
  }

  if (settings.thinkingEnabled) {
    if (settings.thinkingNumPredict < MIN_THINKING_TOKENS) {
      issues.push({
        field: "thinkingNumPredict",
        severity: "error",
        message: `Thinking slice must be at least ${MIN_THINKING_TOKENS} tokens.`,
      });
    }
    if (derived.replyNumPredict < MIN_REPLY_TOKENS) {
      issues.push({
        field: "thinkingNumPredict",
        severity: "error",
        message: `Reply slice must be at least ${MIN_REPLY_TOKENS} tokens.`,
      });
    }
  }

  if (settings.sendThinkingEnabled && !settings.thinkingEnabled) {
    issues.push({
      field: "sendThinkingEnabled",
      severity: "error",
      message: "Send thinking requires thinking mode.",
    });
  }

  return {
    settings: normalized,
    derived,
    issues,
    effectiveNumCtx,
    minNumCtx,
    maxNumPredict,
    contextBudget,
  };
}

export function hasModelConfigErrors(issues: ModelConfigIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}

export function issuesForField(
  issues: ModelConfigIssue[],
  field: ModelConfigField,
): ModelConfigIssue[] {
  return issues.filter((issue) => issue.field === field);
}

export function applyModelConfigUpdate(
  settings: Settings,
  contextBudget: ContextBudget,
  patch: ModelConfigPatch,
): ModelConfigUpdateResult {
  const effectiveNumCtx = contextBudget.effectiveNumCtx;
  let next: Settings = { ...settings, ...patch };

  if (patch.numPredict != null || patch.thinkingNumPredict != null) {
    const maxPredict = maxNumPredictForContext(effectiveNumCtx);
    const requested = snapNumPredict(patch.numPredict ?? next.numPredict);
    if (requested > maxPredict) {
      return {
        ok: false,
        settings,
        issue: {
          field: "numPredict",
          severity: "error",
          message:
            `Cannot set generation to ${requested}: max is ${maxPredict} ` +
            `with derived context ${effectiveNumCtx}. Lower generation tokens.`,
        },
      };
    }
    if (next.thinkingEnabled) {
      const split = clampThinkingSplit(
        requested,
        patch.thinkingNumPredict ?? next.thinkingNumPredict,
      );
      next.numPredict = split.total;
      next.thinkingNumPredict = split.thinking;
    } else {
      next.numPredict = requested;
    }
  }

  if (patch.thinkingEnabled != null) {
    if (patch.thinkingEnabled && !settings.thinkingEnabled) {
      next.thinkingNumPredict = defaultThinkingForTotal(next.numPredict);
      const split = clampThinkingSplit(
        next.numPredict,
        next.thinkingNumPredict,
      );
      next.numPredict = split.total;
      next.thinkingNumPredict = split.thinking;
    }
    if (!patch.thinkingEnabled) {
      next.sendThinkingEnabled = false;
    }
  }

  if (patch.sendThinkingEnabled && !next.thinkingEnabled) {
    return {
      ok: false,
      settings,
      issue: {
        field: "sendThinkingEnabled",
        severity: "error",
        message: "Enable thinking mode before sending thinking to Telegram.",
      },
    };
  }

  next = normalizeModelFields(next, effectiveNumCtx);
  return { ok: true, settings: next };
}

export const MODEL_CONFIG_GROUPS = [
  {
    id: "context",
    title: "1. Context window (auto)",
    description:
      "context window is derived from VRAM_AVAILABLE, the selected model size, and your generation budget.",
  },
  {
    id: "generation",
    title: "2. Generation budget",
    description:
      "generation token caps total output per reply. With thinking mode, the slider splits that single LLM budget.",
  },
  {
    id: "reasoning",
    title: "3. Reasoning",
    description:
      "For models with chain-of-thought (e.g. Qwen3, DeepSeek-R1). Applies to chat replies and memory extraction.",
  },
  {
    id: "sampling",
    title: "4. Sampling",
    description:
      "LLM generation parameters for all model calls, including background passes.",
  },
  {
    id: "timeout",
    title: "5. Request timeout",
    description: "How long to wait for the LLM before failing the turn.",
  },
] as const;

export function numPredictHint(maxNumPredict: number, effectiveNumCtx: number): string {
  return (
    `Hard cap on generated tokens per reply. Maximum ${maxNumPredict} with ` +
    `derived context ${effectiveNumCtx.toLocaleString()}.`
  );
}

export { DEFAULT_THINKING_NUM_PREDICT };
