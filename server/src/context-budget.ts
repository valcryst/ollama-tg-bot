import { getVramAvailableGb } from "./config.js";
import type { OllamaModel } from "./ollama/client.js";
import {
  ABSOLUTE_MAX_NUM_CTX,
  MIN_NUM_CTX,
  NUM_CTX_GENERATION_HEADROOM,
  snapNumCtx,
  snapNumPredict,
} from "./settings-limits.js";
import type { Settings } from "./db/database.js";

function minRequiredCtxForPredict(numPredict: number): number {
  return snapNumCtx(snapNumPredict(numPredict) + NUM_CTX_GENERATION_HEADROOM);
}

/** Ollama default context tiers by VRAM (https://docs.ollama.com/context-length). */
const VRAM_TIER_4K = 4096;
const VRAM_TIER_32K = 32768;
const VRAM_TIER_256K = ABSOLUTE_MAX_NUM_CTX;

export interface ModelContextInput {
  name: string;
  sizeBytes?: number;
  parameterSize?: string;
  /** Native context length from the model definition, if known. */
  modelMaxCtx?: number;
}

export type ContextBudgetLimiter =
  | "vram_tier"
  | "kv_headroom"
  | "model_max"
  | "generation_floor"
  | "min_floor";

export interface ContextBudget {
  effectiveNumCtx: number;
  vramGb: number;
  modelName: string;
  modelWeightGb: number | null;
  modelMaxCtx: number | null;
  vramTierCtx: number;
  limitedBy: ContextBudgetLimiter;
  notes: string[];
}

export function vramTierContextTokens(vramGb: number): number {
  if (vramGb < 24) return VRAM_TIER_4K;
  if (vramGb < 48) return VRAM_TIER_32K;
  return VRAM_TIER_256K;
}

export function parseParameterSizeGb(parameterSize?: string): number | null {
  if (!parameterSize?.trim()) return null;
  const match = parameterSize.trim().match(/^([\d.]+)\s*([bmk])?b?$/i);
  if (!match) return null;

  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;

  const unit = (match[2] ?? "b").toLowerCase();
  const billions =
    unit === "m" ? value / 1_000 : unit === "k" ? value / 1_000_000 : value;

  /** Rough Q4 weight estimate: ~0.65 GB per billion parameters. */
  return billions * 0.65;
}

export function estimateModelWeightGb(model: ModelContextInput): number | null {
  if (model.sizeBytes != null && model.sizeBytes > 0) {
    return model.sizeBytes / 1024 ** 3;
  }
  return parseParameterSizeGb(model.parameterSize);
}

/**
 * Estimate KV-cache context from leftover VRAM after model weights.
 * Calibrated loosely from ~0.5 GB per 8k context for a 7B Q4 model.
 */
function contextFromKvHeadroom(vramGb: number, weightGb: number): number {
  const headroomGb = Math.max(0, vramGb * 0.9 - weightGb);
  if (headroomGb < 0.5) return VRAM_TIER_4K;

  const kvGbPer8k = Math.max(0.12, (weightGb / 7) * 0.5);
  const estimated = Math.floor((headroomGb / kvGbPer8k) * 8192);
  return snapNumCtx(Math.min(ABSOLUTE_MAX_NUM_CTX, estimated));
}

export function modelContextInputFromTags(
  modelName: string,
  entry?: OllamaModel | null,
): ModelContextInput {
  return {
    name: modelName,
    sizeBytes: entry?.size,
    parameterSize: entry?.details?.parameter_size,
    modelMaxCtx: entry?.modelMaxCtx,
  };
}

export function extractModelMaxCtx(modelInfo: Record<string, unknown>): number | null {
  let max: number | null = null;
  for (const [key, value] of Object.entries(modelInfo)) {
    if (!/\.context_length$/i.test(key)) continue;
    const n = typeof value === "number" ? value : Number(value);
    if (Number.isFinite(n) && n > 0) {
      max = max == null ? n : Math.max(max, n);
    }
  }
  return max;
}

export function calculateContextBudget(
  vramGb: number,
  model: ModelContextInput,
  minRequiredCtx = MIN_NUM_CTX,
): ContextBudget {
  const notes: string[] = [];
  const vramTierCtx = vramTierContextTokens(vramGb);
  let target = vramTierCtx;
  let limitedBy: ContextBudgetLimiter = "vram_tier";
  notes.push(
    `VRAM tier (${vramGb} GB): baseline ${vramTierCtx.toLocaleString()} tokens.`,
  );

  const weightGb = estimateModelWeightGb(model);
  if (weightGb != null) {
    const kvCtx = contextFromKvHeadroom(vramGb, weightGb);
    if (kvCtx < target) {
      target = kvCtx;
      limitedBy = "kv_headroom";
      notes.push(
        `Model weights ~${weightGb.toFixed(1)} GB — KV headroom caps context at ${kvCtx.toLocaleString()} tokens.`,
      );
    } else {
      notes.push(`Model weights ~${weightGb.toFixed(1)} GB — tier baseline fits in VRAM.`);
    }
  } else {
    notes.push("Model size unknown — using VRAM tier baseline only.");
  }

  const modelMaxCtx = model.modelMaxCtx ?? null;
  if (modelMaxCtx != null) {
    const capped = snapNumCtx(Math.min(target, modelMaxCtx));
    if (capped < target) {
      target = capped;
      limitedBy = "model_max";
    }
    notes.push(`Model native maximum: ${modelMaxCtx.toLocaleString()} tokens.`);
  }

  const minFloor = snapNumCtx(Math.max(MIN_NUM_CTX, minRequiredCtx));
  if (target < minFloor) {
    target = minFloor;
    limitedBy =
      minRequiredCtx > MIN_NUM_CTX ? "generation_floor" : "min_floor";
    notes.push(
      `Raised to ${target.toLocaleString()} to fit generation budget (${minRequiredCtx} tokens incl. ${NUM_CTX_GENERATION_HEADROOM} headroom).`,
    );
  }

  target = snapNumCtx(Math.min(ABSOLUTE_MAX_NUM_CTX, target));

  return {
    effectiveNumCtx: target,
    vramGb,
    modelName: model.name,
    modelWeightGb: weightGb,
    modelMaxCtx,
    vramTierCtx,
    limitedBy,
    notes,
  };
}

export function getEffectiveNumCtx(
  settings: Settings,
  model: ModelContextInput,
): number {
  const minCtx = minRequiredCtxForPredict(settings.numPredict);
  return calculateContextBudget(getVramAvailableGb(), model, minCtx)
    .effectiveNumCtx;
}

export function buildContextBudget(
  settings: Settings,
  model: ModelContextInput,
): ContextBudget {
  const minCtx = minRequiredCtxForPredict(settings.numPredict);
  return calculateContextBudget(getVramAvailableGb(), model, minCtx);
}

