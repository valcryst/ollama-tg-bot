import type { Settings } from "./api";
import {
  DEFAULT_THINKING_NUM_PREDICT,
  MIN_NUM_CTX,
  MIN_REPLY_TOKENS,
  MIN_THINKING_TOKENS,
  NUM_CTX_GENERATION_HEADROOM,
  NUM_CTX_STEP,
  clampThinkingSplit,
  defaultThinkingForTotal,
  deriveHistoryLimits,
  maxNumPredictForContext,
  minNumCtxForPredict,
  snapNumCtx,
  snapNumPredict,
  type DerivedHistoryLimits,
} from "./tokenBudget";

export type ModelConfigField =
  | "numCtx"
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
    | "numCtx"
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
  minNumCtx: number;
  maxNumPredict: number;
};

export type ModelConfigUpdateResult =
  | { ok: true; settings: Settings }
  | { ok: false; settings: Settings; issue: ModelConfigIssue };

function normalizeModelFields(settings: Settings): Settings {
  const numCtx = snapNumCtx(settings.numCtx);
  const maxPredict = maxNumPredictForContext(numCtx);
  const numPredict = snapNumPredict(Math.min(settings.numPredict, maxPredict));

  if (!settings.thinkingEnabled) {
    return {
      ...settings,
      numCtx,
      numPredict,
      sendThinkingEnabled: false,
    };
  }

  const split = clampThinkingSplit(numPredict, settings.thinkingNumPredict);
  return {
    ...settings,
    numCtx,
    numPredict: split.total,
    thinkingNumPredict: split.thinking,
    sendThinkingEnabled: settings.sendThinkingEnabled,
  };
}

export function analyzeModelConfig(settings: Settings): ModelConfigAnalysis {
  const normalized = normalizeModelFields(settings);
  const derived = deriveHistoryLimits(
    normalized.numCtx,
    normalized.numPredict,
    normalized.thinkingEnabled,
    normalized.thinkingNumPredict,
  );
  const minNumCtx = minNumCtxForPredict(normalized.numPredict);
  const maxNumPredict = maxNumPredictForContext(normalized.numCtx);
  const issues: ModelConfigIssue[] = [];

  if (settings.numCtx < minNumCtx) {
    issues.push({
      field: "numCtx",
      severity: "error",
      message:
        `Context must be at least ${minNumCtx} for the generation budget ` +
        `(${normalized.numPredict} tokens + ${NUM_CTX_GENERATION_HEADROOM} prompt headroom). ` +
        `Lower generation tokens first, or raise context.`,
    });
  }

  if (settings.numPredict > maxNumPredict) {
    issues.push({
      field: "numPredict",
      severity: "error",
      message:
        `Generation budget cannot exceed ${maxNumPredict} with context ${normalized.numCtx}. ` +
        `Raise context first.`,
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
    minNumCtx,
    maxNumPredict,
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
  patch: ModelConfigPatch,
): ModelConfigUpdateResult {
  let next: Settings = { ...settings, ...patch };

  if (patch.numCtx != null) {
    const numCtx = snapNumCtx(patch.numCtx);
    const minCtx = minNumCtxForPredict(next.numPredict);
    if (numCtx < minCtx) {
      return {
        ok: false,
        settings,
        issue: {
          field: "numCtx",
          severity: "error",
          message:
            `Cannot set context to ${numCtx}: it must be at least ${minCtx} ` +
            `for the current generation budget (${snapNumPredict(next.numPredict)} + ` +
            `${NUM_CTX_GENERATION_HEADROOM} headroom). Lower generation tokens first.`,
        },
      };
    }
    next.numCtx = numCtx;
  }

  if (patch.numPredict != null || patch.thinkingNumPredict != null) {
    const maxPredict = maxNumPredictForContext(next.numCtx);
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
            `with context ${next.numCtx}. Raise context first.`,
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

  next = normalizeModelFields(next);
  return { ok: true, settings: next };
}

export const MODEL_CONFIG_GROUPS = [
  {
    id: "context",
    title: "1. Context window",
    description:
      "Set num_ctx first. It must cover chat history, the system prompt, and the generation budget below.",
  },
  {
    id: "generation",
    title: "2. Generation budget",
    description:
      "num_predict caps total output per reply. With thinking mode, the slider splits that single Ollama budget.",
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
      "Ollama generation parameters for all model calls, including background passes.",
  },
  {
    id: "timeout",
    title: "5. Request timeout",
    description: "How long to wait for Ollama before failing the turn.",
  },
] as const;

export function numCtxHint(minNumCtx: number, maxNumPredict: number): string {
  return (
    `Ollama context window (step ${NUM_CTX_STEP}). Minimum ${minNumCtx} with the ` +
    `current generation budget. Generation max with this context: ${maxNumPredict}.`
  );
}

export function numPredictHint(maxNumPredict: number, numCtx: number): string {
  return (
    `Hard cap on generated tokens per reply. Maximum ${maxNumPredict} until ` +
    `context is above ${numCtx + NUM_CTX_GENERATION_HEADROOM}.`
  );
}

export { DEFAULT_THINKING_NUM_PREDICT, MIN_NUM_CTX, NUM_CTX_STEP };
