/** Keep in sync with server/src/settings-limits.ts getHistoryLimits(). */
export function deriveHistoryLimits(
  numCtx: number,
  numPredict: number,
): {
  historyMaxMessages: number;
  historyMaxChars: number;
  historyMaxReplyChars: number;
} {
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
