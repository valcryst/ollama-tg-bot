/** Keep in sync with server/src/settings-limits.ts */

export const MIN_NUM_PREDICT = 32;
export const MAX_NUM_PREDICT = 8192;
export const NUM_CTX_GENERATION_HEADROOM = 512;
export const MIN_NUM_CTX = 2048;
export const ABSOLUTE_MAX_NUM_CTX = 262144;
export const MAX_NUM_CTX = ABSOLUTE_MAX_NUM_CTX;
export const NUM_CTX_STEP = 512;
export const NUM_PREDICT_STEP = 32;
export const MIN_THINKING_TOKENS = 32;
export const MIN_REPLY_TOKENS = 32;
export const DEFAULT_THINKING_NUM_PREDICT = 384;
const APPROX_CHARS_PER_TOKEN = 3.5;

export function snapNumPredict(value: number): number {
  const snapped = Math.round(value / NUM_PREDICT_STEP) * NUM_PREDICT_STEP;
  return Math.min(MAX_NUM_PREDICT, Math.max(MIN_NUM_PREDICT, snapped));
}

export function snapNumCtx(value: number): number {
  const snapped = Math.round(value / NUM_CTX_STEP) * NUM_CTX_STEP;
  return Math.min(MAX_NUM_CTX, Math.max(MIN_NUM_CTX, snapped));
}

export function maxNumPredictForContext(numCtx: number): number {
  return Math.min(
    MAX_NUM_PREDICT,
    Math.max(
      MIN_NUM_PREDICT,
      snapNumPredict(numCtx - NUM_CTX_GENERATION_HEADROOM),
    ),
  );
}

/** Smallest context window that fits the current generation budget plus prompt headroom. */
export function minNumCtxForPredict(numPredict: number): number {
  return snapNumCtx(snapNumPredict(numPredict) + NUM_CTX_GENERATION_HEADROOM);
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

export function getThinkingNumPredict(
  thinkingEnabled: boolean,
  thinkingNumPredict: number,
): number {
  return thinkingEnabled ? thinkingNumPredict : 0;
}

export function getReplyNumPredict(
  numPredict: number,
  thinkingEnabled: boolean,
  thinkingNumPredict: number,
): number {
  if (!thinkingEnabled) return numPredict;
  return numPredict - getThinkingNumPredict(thinkingEnabled, thinkingNumPredict);
}

export interface DerivedHistoryLimits {
  historyMaxMessages: number;
  historyMaxChars: number;
  historyMaxReplyChars: number;
  numPredict: number;
  thinkingNumPredict: number;
  replyNumPredict: number;
}

export function deriveHistoryLimits(
  numCtx: number,
  numPredict: number,
  thinkingEnabled = false,
  thinkingNumPredict = DEFAULT_THINKING_NUM_PREDICT,
): DerivedHistoryLimits {
  const split = thinkingEnabled
    ? clampThinkingSplit(numPredict, thinkingNumPredict)
    : { total: snapNumPredict(numPredict), thinking: 0 };
  const replyNumPredict = split.total - split.thinking;

  const historyTokenBudget = Math.max(
    256,
    Math.floor((numCtx - split.total) * 0.45),
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
    numPredict: split.total,
    thinkingNumPredict: split.thinking,
    replyNumPredict,
  };
}
