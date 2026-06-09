/** Keep in sync with server/src/context-budget.ts */

import {
  ABSOLUTE_MAX_NUM_CTX,
  MIN_NUM_CTX,
  minNumCtxForPredict,
  snapNumCtx,
  snapNumPredict,
} from "./tokenBudget";

export type ContextBudgetLimiter =
  | "vram_tier"
  | "kv_headroom"
  | "model_max"
  | "generation_floor"
  | "min_floor";

export interface ModelContextInput {
  name: string;
  sizeBytes?: number;
  parameterSize?: string;
  modelMaxCtx?: number;
}

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

const VRAM_TIER_4K = 4096;
const VRAM_TIER_32K = 32768;

export function vramTierContextTokens(vramGb: number): number {
  if (vramGb < 24) return VRAM_TIER_4K;
  if (vramGb < 48) return VRAM_TIER_32K;
  return ABSOLUTE_MAX_NUM_CTX;
}

function parseParameterSizeGb(parameterSize?: string): number | null {
  if (!parameterSize?.trim()) return null;
  const match = parameterSize.trim().match(/^([\d.]+)\s*([bmk])?b?$/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = (match[2] ?? "b").toLowerCase();
  const billions =
    unit === "m" ? value / 1_000 : unit === "k" ? value / 1_000_000 : value;
  return billions * 0.65;
}

function estimateModelWeightGb(model: ModelContextInput): number | null {
  if (model.sizeBytes != null && model.sizeBytes > 0) {
    return model.sizeBytes / 1024 ** 3;
  }
  return parseParameterSizeGb(model.parameterSize);
}

function contextFromKvHeadroom(vramGb: number, weightGb: number): number {
  const headroomGb = Math.max(0, vramGb * 0.9 - weightGb);
  if (headroomGb < 0.5) return VRAM_TIER_4K;
  const kvGbPer8k = Math.max(0.12, (weightGb / 7) * 0.5);
  const estimated = Math.floor((headroomGb / kvGbPer8k) * 8192);
  return snapNumCtx(Math.min(ABSOLUTE_MAX_NUM_CTX, estimated));
}

export function modelContextFromTags(
  modelName: string,
  entry?: {
    size?: number;
    modelMaxCtx?: number;
    details?: { parameter_size?: string };
  } | null,
): ModelContextInput {
  return {
    name: modelName,
    sizeBytes: entry?.size,
    parameterSize: entry?.details?.parameter_size,
    modelMaxCtx: entry?.modelMaxCtx,
  };
}

export function calculateContextBudget(
  vramGb: number,
  model: ModelContextInput,
  numPredict: number,
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

  const minRequiredCtx = minNumCtxForPredict(snapNumPredict(numPredict));
  const minFloor = snapNumCtx(Math.max(MIN_NUM_CTX, minRequiredCtx));
  if (target < minFloor) {
    target = minFloor;
    limitedBy =
      minRequiredCtx > MIN_NUM_CTX ? "generation_floor" : "min_floor";
    notes.push(
      `Raised to ${target.toLocaleString()} to fit generation budget.`,
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
