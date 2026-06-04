import { getSettings } from "./db/database.js";
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
  getHistory,
  HISTORY_SUMMARY_PREFIX,
  historyTotalChars,
  isHistorySummaryMessage,
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

const HISTORY_COMPRESS_NUM_PREDICT = 512;
const MEMORY_COMPRESS_NUM_PREDICT = 512;

const MEMORY_COMPRESS_MIN_FACTS = 28;
const MEMORY_COMPRESS_MIN_CHARS = 1800;
const MEMORY_TARGET_MAX_FACTS = 24;

const HISTORY_COMPRESS_SYSTEM = `You compress older Telegram chat history into a brief summary for future assistant context.

Preserve: who said what (use names if known), decisions, preferences, open questions, running jokes or topics, unresolved tasks.
Omit: exact wording, greetings, filler, message meta, duplicates.

Output ONLY plain summary text (no markdown, no labels). Stay within the character budget given.`;

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

function keepRecentMessageCount(): number {
  const { historyMaxMessages } = getSettings();
  if (historyMaxMessages <= 2) return 2;
  return Math.max(2, Math.min(8, Math.floor(historyMaxMessages / 2)));
}

export function historyNeedsCompression(chatKey: string): boolean {
  const settings = getSettings();
  const history = getHistory(chatKey);
  if (history.length < 3) return false;

  const total = historyTotalChars(history);
  if (total > settings.historyMaxChars) return true;

  return (
    history.length >= settings.historyMaxMessages &&
    total > settings.historyMaxChars * 0.75
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
    .catch((err) => console.error("History compression failed:", err))
    .finally(() => inFlight.delete(key));
}

export function scheduleUserMemoryCompression(userId: string): void {
  const key = `user:${userId}`;
  if (inFlight.has(key)) return;
  inFlight.add(key);
  void compressUserMemoryIfNeeded(userId)
    .catch((err) => console.error("User memory compression failed:", err))
    .finally(() => inFlight.delete(key));
}

export function scheduleGroupMemoryCompression(groupId: string): void {
  const key = `group:${groupId}`;
  if (inFlight.has(key)) return;
  inFlight.add(key);
  void compressGroupMemoryIfNeeded(groupId)
    .catch((err) => console.error("Group memory compression failed:", err))
    .finally(() => inFlight.delete(key));
}

export function scheduleGeneralMemoryCompression(): void {
  const key = "general";
  if (inFlight.has(key)) return;
  inFlight.add(key);
  void compressGeneralMemoryIfNeeded()
    .catch((err) => console.error("General memory compression failed:", err))
    .finally(() => inFlight.delete(key));
}

async function compressHistoryIfNeeded(chatKey: string): Promise<void> {
  if (!historyNeedsCompression(chatKey)) return;

  const settings = getSettings();
  const history = getHistory(chatKey);
  const keep = keepRecentMessageCount();
  if (history.length <= keep) return;

  const recent = history.slice(-keep);
  let older = history.slice(0, -keep);

  const existingSummaryIdx = older.findIndex((m) =>
    isHistorySummaryMessage(m.content),
  );
  let existingSummary: string | null = null;
  if (existingSummaryIdx >= 0) {
    const summaryMsg = older[existingSummaryIdx];
    existingSummary = summaryMsg.content
      .slice(HISTORY_SUMMARY_PREFIX.length)
      .trim();
    older = older.filter((_, i) => i !== existingSummaryIdx);
  }

  if (older.length === 0) return;

  const maxSummaryChars = Math.max(
    400,
    Math.floor(settings.historyMaxChars * 0.45),
  );

  const transcript = formatTranscript(older);
  let userContent = `Character budget: about ${maxSummaryChars} characters.\n\n`;
  if (existingSummary) {
    userContent +=
      `Existing summary to merge and shorten:\n${existingSummary}\n\n---\n`;
  }
  userContent += `Messages to summarize:\n${transcript}`;

  const messages: ChatMessage[] = [
    { role: "system", content: HISTORY_COMPRESS_SYSTEM },
    { role: "user", content: userContent },
  ];

  const raw = await chatComplete(messages, {
    numPredict: HISTORY_COMPRESS_NUM_PREDICT,
  });
  const summaryBody = clampSummaryText(raw, maxSummaryChars);
  if (!summaryBody) return;

  const compressed: StoredMessage[] = [
    {
      role: "user",
      content: `${HISTORY_SUMMARY_PREFIX}\n${summaryBody}`,
    },
    ...recent,
  ];

  replaceHistory(chatKey, compressed);
  console.log(
    `Compressed history for ${chatKey}: ${history.length} messages → ${compressed.length}`,
  );
}

async function compressUserMemoryIfNeeded(userId: string): Promise<void> {
  if (!userMemoryNeedsCompression(userId)) return;
  const facts = getUserFacts(userId);
  const merged = await compressFactsWithModel(facts, "user");
  if (merged.length === 0) return;
  replaceUserFacts(userId, merged);
  console.log(
    `Compressed user memory ${userId}: ${facts.length} facts → ${merged.length}`,
  );
}

async function compressGroupMemoryIfNeeded(groupId: string): Promise<void> {
  if (!groupMemoryNeedsCompression(groupId)) return;
  const facts = getGroupFacts(groupId);
  const merged = await compressFactsWithModel(facts, "group");
  if (merged.length === 0) return;
  replaceGroupFacts(groupId, merged);
  console.log(
    `Compressed group memory ${groupId}: ${facts.length} facts → ${merged.length}`,
  );
}

async function compressGeneralMemoryIfNeeded(): Promise<void> {
  if (!generalMemoryNeedsCompression()) return;
  const facts = getGeneralFacts();
  const merged = await compressFactsWithModel(facts, "general");
  if (merged.length === 0) return;
  replaceGeneralFacts(merged);
  console.log(
    `Compressed general memory: ${facts.length} facts → ${merged.length}`,
  );
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
  });
  return parseFactsBlock(raw).slice(0, MEMORY_TARGET_MAX_FACTS);
}

function formatTranscript(messages: StoredMessage[]): string {
  return messages
    .map((m) => {
      const label = m.role === "user" ? "User" : "Assistant";
      return `${label}: ${m.content.trim()}`;
    })
    .join("\n\n");
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
