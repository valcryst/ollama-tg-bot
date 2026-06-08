/** Keep in sync with server/src/settings-limits.ts getHistoryLimits(). */

export const MAX_NUM_PREDICT = 2048;
export const THINKING_NUM_PREDICT_BUMP = 1024;

export function getThinkingNumPredictBump(thinkingEnabled: boolean): number {
  return thinkingEnabled ? THINKING_NUM_PREDICT_BUMP : 0;
}

export function getEffectiveNumPredict(
  numPredict: number,
  thinkingEnabled: boolean,
): number {
  if (!thinkingEnabled) return numPredict;
  return Math.min(
    MAX_NUM_PREDICT,
    numPredict + getThinkingNumPredictBump(thinkingEnabled),
  );
}

export function deriveHistoryLimits(
  numCtx: number,
  numPredict: number,
  thinkingEnabled = false,
): {
  historyMaxMessages: number;
  historyMaxChars: number;
  historyMaxReplyChars: number;
  effectiveNumPredict: number;
  thinkingNumPredictBump: number;
} {
  const thinkingNumPredictBump = getThinkingNumPredictBump(thinkingEnabled);
  const effectiveNumPredict = getEffectiveNumPredict(
    numPredict,
    thinkingEnabled,
  );

  const historyTokenBudget = Math.max(
    256,
    Math.floor((numCtx - effectiveNumPredict) * 0.45),
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
    effectiveNumPredict,
    thinkingNumPredictBump,
  };
}
