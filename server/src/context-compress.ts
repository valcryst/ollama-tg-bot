import { getSettings } from "./db/database.js";
import { getHistoryLimits } from "./settings-limits.js";
import {
  getGeneralFacts,
  generalMemoryTotalChars,
  replaceGeneralFacts,
} from "./db/general-memory.js";
import {
  getGroupFacts,
  groupMemoryTotalChars,
  replaceGroupFacts,
} from "./db/group-memory.js";
import {
  COMPRESSED_ROLE,
  getHistory,
  historyTotalChars,
  replaceHistory,
  type StoredMessage,
} from "./db/history.js";
import {
  getUserFacts,
  replaceUserFacts,
  userMemoryTotalChars,
} from "./db/user-memory.js";
import { chatComplete } from "./ollama/client.js";
import type { ChatMessage } from "./ollama/client.js";
import { normalizeFactText } from "./db/memory-facts.js";
import { logEvent, logEventError } from "./event-log.js";

const HISTORY_COMPRESS_NUM_PREDICT = 512;
const MEMORY_COMPRESS_NUM_PREDICT = 512;

const MEMORY_COMPRESS_MIN_FACTS = 28;
const MEMORY_COMPRESS_MIN_CHARS = 1800;
const MEMORY_TARGET_MAX_FACTS = 24;

const HISTORY_COMPRESS_SYSTEM = `You compress Telegram chat history into one short narrative paragraph.

Use participant tags exactly like [user:username:id] and [assistant said] for the bot.
Mention replies ("replied to"), media ("sent an image which depicts…"), and key topics.
Output ONLY the summary text — no markdown, no labels.`;

const MEMORY_COMPRESS_SYSTEM = `You merge a list of stored long-term facts into a shorter list without losing durable information.

Rules:
- Combine duplicates and near-duplicates into one clearer line
- Drop ephemeral or redundant items
- Keep facts that would still matter in a future session
- One fact per line inside the block
- If nothing worth keeping, write "none"

Output ONLY:

[FACTS]
fact one
fact two
[/FACTS]`;

const inFlight = new Set<string>();

export function historyNeedsCompression(chatKey: string): boolean {
  const settings = getSettings();
  const limits = getHistoryLimits(settings);
  const history = getHistory(chatKey);
  if (history.length < 2) return false;
  if (history.length === 1 && history[0].role === COMPRESSED_ROLE) {
    return historyTotalChars(history) > limits.historyMaxChars;
  }

  const total = historyTotalChars(history);
  if (total > limits.historyMaxChars) return true;

  return (
    history.length >= limits.historyMaxMessages &&
    total > limits.historyMaxChars * 0.75
  );
}

export function userMemoryNeedsCompression(userId: string): boolean {
  const facts = getUserFacts(userId);
  if (facts.length < MEMORY_COMPRESS_MIN_FACTS) return false;
  return userMemoryTotalChars(facts) >= MEMORY_COMPRESS_MIN_CHARS;
}

export function groupMemoryNeedsCompression(groupId: string): boolean {
  const facts = getGroupFacts(groupId);
  if (facts.length < MEMORY_COMPRESS_MIN_FACTS) return false;
  return groupMemoryTotalChars(facts) >= MEMORY_COMPRESS_MIN_CHARS;
}

export function generalMemoryNeedsCompression(): boolean {
  const facts = getGeneralFacts();
  if (facts.length < MEMORY_COMPRESS_MIN_FACTS) return false;
  return generalMemoryTotalChars(facts) >= MEMORY_COMPRESS_MIN_CHARS;
}

export function scheduleHistoryCompression(chatKey: string): void {
  const key = `history:${chatKey}`;
  if (inFlight.has(key)) return;
  inFlight.add(key);
  void compressHistoryIfNeeded(chatKey)
    .catch((err) => logEventError("history_compression_failed", err, { convKey: chatKey }))
    .finally(() => inFlight.delete(key));
}

export function scheduleUserMemoryCompression(userId: string): void {
  const key = `user:${userId}`;
  if (inFlight.has(key)) return;
  inFlight.add(key);
  void compressUserMemoryIfNeeded(userId)
    .catch((err) => logEventError("user_memory_compression_failed", err, { userId }))
    .finally(() => inFlight.delete(key));
}

export function scheduleGroupMemoryCompression(groupId: string): void {
  const key = `group:${groupId}`;
  if (inFlight.has(key)) return;
  inFlight.add(key);
  void compressGroupMemoryIfNeeded(groupId)
    .catch((err) => logEventError("group_memory_compression_failed", err, { groupId }))
    .finally(() => inFlight.delete(key));
}

export function scheduleGeneralMemoryCompression(): void {
  const key = "general";
  if (inFlight.has(key)) return;
  inFlight.add(key);
  void compressGeneralMemoryIfNeeded()
    .catch((err) => logEventError("general_memory_compression_failed", err))
    .finally(() => inFlight.delete(key));
}

async function compressHistoryIfNeeded(chatKey: string): Promise<void> {
  if (!historyNeedsCompression(chatKey)) return;

  const settings = getSettings();
  const history = getHistory(chatKey);
  if (history.length === 0) return;

  const limits = getHistoryLimits(settings);
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

async function compressUserMemoryIfNeeded(userId: string): Promise<void> {
  if (!userMemoryNeedsCompression(userId)) return;
  const facts = getUserFacts(userId);
  const merged = await compressFactsWithModel(facts, "user");
  if (merged.length === 0) return;
  replaceUserFacts(userId, merged);
  logEvent("user_memory_compressed", {
    userId,
    factCountBefore: facts.length,
    factCountAfter: merged.length,
  });
}

async function compressGroupMemoryIfNeeded(groupId: string): Promise<void> {
  if (!groupMemoryNeedsCompression(groupId)) return;
  const facts = getGroupFacts(groupId);
  const merged = await compressFactsWithModel(facts, "group");
  if (merged.length === 0) return;
  replaceGroupFacts(groupId, merged);
  logEvent("group_memory_compressed", {
    groupId,
    factCountBefore: facts.length,
    factCountAfter: merged.length,
  });
}

async function compressGeneralMemoryIfNeeded(): Promise<void> {
  if (!generalMemoryNeedsCompression()) return;
  const facts = getGeneralFacts();
  const merged = await compressFactsWithModel(facts, "general");
  if (merged.length === 0) return;
  replaceGeneralFacts(merged);
  logEvent("general_memory_compressed", {
    factCountBefore: facts.length,
    factCountAfter: merged.length,
  });
}

async function compressFactsWithModel(
  facts: string[],
  kind: "user" | "group" | "general",
): Promise<string[]> {
  const lines = facts.map((f) => `- ${f}`).join("\n");
  const messages: ChatMessage[] = [
    { role: "system", content: MEMORY_COMPRESS_SYSTEM },
    {
      role: "user",
      content:
        `Target: at most ${MEMORY_TARGET_MAX_FACTS} facts.\n` +
        `Kind: ${kind} long-term memory.\n\n` +
        `Current facts:\n${lines}`,
    },
  ];

  const raw = await chatComplete(messages, {
    numPredict: MEMORY_COMPRESS_NUM_PREDICT,
    auxiliary: true,
    verboseLabel: `${kind} memory compression`,
  });
  return parseFactsBlock(raw).slice(0, MEMORY_TARGET_MAX_FACTS);
}

function clampSummaryText(raw: string, maxChars: number): string {
  let text = raw.trim();
  text = text.replace(/^\[REPLY\][\s\S]*?\[\/REPLY\]/i, "").trim();
  if (!text) return "";
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut}…`;
}

const FACTS_BLOCK = /\[FACTS\]\s*([\s\S]*?)\s*\[\/FACTS\]/i;

function parseFactsBlock(raw: string): string[] {
  const match = raw.match(FACTS_BLOCK);
  const block = (match?.[1] ?? raw).trim();
  if (!block || /^none$/i.test(block)) return [];

  const out: string[] = [];
  const seen = new Set<string>();

  for (const line of block.split("\n")) {
    const cleaned = line.replace(/^[-*•]\s*/, "").trim();
    const normalized = normalizeFactText(cleaned);
    if (!normalized) continue;
    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }

  return out;
}
