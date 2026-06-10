import { getSettings } from "./db/database.js";
import {
  COMPRESSED_ROLE,
  getHistoryForCompression,
  historyTotalChars,
  replaceHistory,
  type StoredMessage,
} from "./db/history.js";
import { logEvent, logEventError } from "./event-log.js";
import { chatComplete } from "./ollama/client.js";
import type { ChatMessage } from "./ollama/client.js";
import { getResolvedHistoryLimits } from "./settings-runtime.js";

const HISTORY_COMPRESS_NUM_PREDICT = 512;

const HISTORY_COMPRESS_SYSTEM = `You compress Telegram chat history into one short narrative paragraph.

Use participant tags exactly like [user:username:id] and [assistant said] for the bot.
Mention replies ("replied to"), media ("sent an image which depicts..."), and key topics.
Output ONLY the summary text - no markdown, no labels.`;

const inFlight = new Set<string>();
let compressionQueue: Promise<void> = Promise.resolve();

export function historyNeedsCompression(chatKey: string): boolean {
  const settings = getSettings();
  const limits = getResolvedHistoryLimits(settings);
  const history = getHistoryForCompression(chatKey);
  if (history.length < 2) return false;
  if (history.length === 1 && history[0].role === COMPRESSED_ROLE) {
    return historyTotalChars(history) > limits.historyMaxChars;
  }

  const total = historyTotalChars(history);
  if (total > limits.historyMaxChars) return true;

  return (
    history.length >= limits.historyMaxMessages * 2 &&
    total > limits.historyMaxChars * 0.75
  );
}

export function scheduleHistoryCompression(chatKey: string): void {
  const key = `history:${chatKey}`;
  enqueueCompression(key, () => compressHistoryIfNeeded(chatKey), (err) =>
    logEventError("history_compression_failed", err, { convKey: chatKey }),
  );
}

function enqueueCompression(
  key: string,
  task: () => Promise<void>,
  onError: (err: unknown) => void,
): void {
  if (inFlight.has(key)) return;
  inFlight.add(key);
  compressionQueue = compressionQueue
    .catch(() => {})
    .then(task)
    .catch(onError)
    .finally(() => inFlight.delete(key));
}

async function compressHistoryIfNeeded(chatKey: string): Promise<void> {
  if (!historyNeedsCompression(chatKey)) return;

  const settings = getSettings();
  const history = getHistoryForCompression(chatKey);
  if (history.length === 0) return;

  const limits = getResolvedHistoryLimits(settings);
  const maxSummaryChars = Math.max(
    400,
    Math.floor(limits.historyMaxChars * 0.85),
  );

  const transcript = history.map((m) => m.content.trim()).join("\n");
  const messages: ChatMessage[] = [
    { role: "system", content: HISTORY_COMPRESS_SYSTEM },
    {
      role: "user",
      content:
        `Character budget: about ${maxSummaryChars} characters.\n\n` +
        `History to compress into one paragraph:\n${transcript}`,
    },
  ];

  const raw = await chatComplete(messages, {
    numPredict: HISTORY_COMPRESS_NUM_PREDICT,
    auxiliary: true,
    verboseLabel: "history compression",
  });
  const summaryBody = clampSummaryText(raw, maxSummaryChars);
  if (!summaryBody) return;

  const compressed: StoredMessage[] = [
    { role: COMPRESSED_ROLE, content: summaryBody },
  ];

  replaceHistory(chatKey, compressed);
  logEvent("history_compressed", {
    convKey: chatKey,
    messageCount: history.length,
    resultCount: 1,
  });
}

function clampSummaryText(raw: string, maxChars: number): string {
  let text = raw.trim();
  text = text.replace(/^\[REPLY\][\s\S]*?\[\/REPLY\]/i, "").trim();
  if (!text) return "";
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut}...`;
}
