import { addGeneralFacts } from "./db/general-memory.js";
import { replaceGroupFacts } from "./db/group-memory.js";
import { replaceUserFacts } from "./db/user-memory.js";
import { logEvent, logEventError } from "./event-log.js";
import { getDebugTrace } from "./debug-trace.js";
import { chatComplete } from "./llm/client.js";
import type { ChatMessage } from "./llm/client.js";
import { parseStructuredResponse } from "./response-format.js";

const MEMORY_EXTRACT_NUM_PREDICT = 384;
const MEMORY_MERGE_NUM_PREDICT = 768;

const EXTRACTOR_SYSTEM = `You extract durable facts, terms, and useful long-term information from one addressed Telegram bot turn.

Output ONLY these blocks (no other text):

[MEMORY]
none
[/MEMORY]
[GROUP_MEMORY]
none
[/GROUP_MEMORY]
[GENERAL_MEMORY]
none
[/GENERAL_MEMORY]

[MEMORY] = new information about the current speaker only: identity, preferences, role, timezone, standing instructions, how they want to be addressed. One item per line. "none" if nothing new. In group chats, never store other members' traits here.

[GROUP_MEMORY] = new information about the group/chat itself: purpose, rules, recurring topics, in-jokes, ongoing shared context, what this chat is for. Not facts about individual users. "none" if nothing new or not a group chat.

[GENERAL_MEMORY] = facts that apply across all chats: glossary terms, definitions, project/domain facts, standing instructions not tied to one person or group. "none" if nothing new.

Decide on your own. The user does not need to say "remember". Store information that would still matter in a future session.

Store when the user shares:
- who they are, preferences, standing instructions
- what this group is for, norms, ongoing context
- definitions, acronyms, terms, or useful domain/project knowledge
- corrections to prior assumptions

Do NOT store:
- greetings, jokes, sarcasm, or the assistant's own banter
- one-off questions, transient moods, or message metadata
- facts already listed under "Already stored"
- duplicates rephrased slightly
- user-specific traits in [GENERAL_MEMORY] or group-only context in [GENERAL_MEMORY]`;

const MEMORY_MERGE_SYSTEM = `You update one long-term memory document for an entity.

Inputs:
- Existing memory for this entity
- Newly extracted durable information

Task:
- Merge new information into the existing memory.
- Preserve all durable details. This must be lossless unless an old detail is a duplicate, contradicted by newer information, or clearly ephemeral.
- Compact wording where possible.
- Keep the result readable as short lines or compact paragraphs.
- Do not invent facts.
- If there is no useful memory left, write "none".

Output ONLY:

[MEMORY]
updated memory text
[/MEMORY]`;

export interface MemoryExtractInput {
  userMessage: string;
  replyContext: string | null;
  assistantReply: string;
  existingUserFacts: string[];
  existingGroupFacts: string[];
  existingGeneralFacts: string[];
  isGroupChat: boolean;
}

export interface MemoryExtractResult {
  userFacts: string[];
  groupFacts: string[];
  generalFacts: string[];
}

export async function extractMemoriesFromTurn(
  input: MemoryExtractInput,
  traceTurnId?: number,
): Promise<MemoryExtractResult> {
  const userBlock = formatStored("user", input.existingUserFacts);
  const groupBlock = input.isGroupChat
    ? formatStored("group", input.existingGroupFacts)
    : "Not a group chat - always write none in [GROUP_MEMORY].";
  const generalBlock = formatStored("general", input.existingGeneralFacts);

  const replyContext = input.replyContext?.trim() ?? "";
  const hasReplyThread = replyContext.includes("[REPLY THREAD");

  let turn: string;
  if (hasReplyThread) {
    turn = `Message context:\n${replyContext}`;
  } else {
    turn = `User message:\n${input.userMessage.trim() || "(non-text message)"}`;
    if (replyContext) {
      turn += `\n\nReplied-to context:\n${replyContext}`;
    }
  }
  turn += `\n\nAssistant reply (for context only, do not store its jokes as facts):\n${input.assistantReply.trim()}`;

  const messages: ChatMessage[] = [
    { role: "system", content: EXTRACTOR_SYSTEM },
    {
      role: "user",
      content:
        `Already stored about this user:\n${userBlock}\n\n` +
        `Already stored about this group:\n${groupBlock}\n\n` +
        `Already stored general knowledge:\n${generalBlock}\n\n` +
        `---\n${turn}`,
    },
  ];

  try {
    const raw = await chatComplete(messages, {
      numPredict: MEMORY_EXTRACT_NUM_PREDICT,
      auxiliary: true,
      think: true,
      traceTurnId,
      traceLabel: "memory extract",
    });
    const parsed = parseStructuredResponse(raw);
    return {
      userFacts: parsed.memoryFacts,
      groupFacts: input.isGroupChat ? parsed.groupMemoryFacts : [],
      generalFacts: parsed.generalMemoryFacts,
    };
  } catch (err) {
    logEventError("memory_extract_failed", err, {
      isGroupChat: input.isGroupChat,
    });
    return { userFacts: [], groupFacts: [], generalFacts: [] };
  }
}

function formatStored(kind: string, facts: string[]): string {
  const content = facts.join("\n").trim();
  if (!content) return `(none yet for this ${kind})`;
  return content;
}

export interface MemoryPersistContext {
  input: MemoryExtractInput;
  userId: string | null;
  groupChatId: string | null;
  turnId?: number;
}

/** Run memory extraction and DB writes without blocking the Telegram reply. */
export function scheduleMemoryPersistence(ctx: MemoryPersistContext): void {
  logEvent("memory_extract_scheduled", {
    userId: ctx.userId,
    groupId: ctx.groupChatId,
    isGroupChat: ctx.input.isGroupChat,
  });
  void persistMemories(ctx).catch((err) => {
    logEventError("memory_persist_failed", err, {
      userId: ctx.userId,
      groupId: ctx.groupChatId,
    });
    if (ctx.turnId != null) {
      getDebugTrace(ctx.turnId)?.updateMemoryResult({
        memoryUpdated: false,
        memoryScopes: [],
        error: err instanceof Error ? err.message : String(err),
      });
    }
  });
}

async function persistMemories(ctx: MemoryPersistContext): Promise<void> {
  logEvent("memory_extract_started", {
    userId: ctx.userId,
    groupId: ctx.groupChatId,
    isGroupChat: ctx.input.isGroupChat,
  });

  const extracted = await extractMemoriesFromTurn(ctx.input, ctx.turnId);
  let anyUpdated = false;
  const updatedScopes: string[] = [];

  if (ctx.userId && extracted.userFacts.length > 0) {
    const merged = await mergeMemoryDocument({
      kind: "user",
      existing: ctx.input.existingUserFacts,
      incoming: extracted.userFacts,
      traceTurnId: ctx.turnId,
    });
    replaceUserFacts(ctx.userId, merged ? [merged] : []);
    logEvent("memory_updated", {
      scope: "user",
      userId: ctx.userId,
      factCount: extracted.userFacts.length,
    });
    anyUpdated = true;
    updatedScopes.push("user");
  }

  if (ctx.groupChatId && extracted.groupFacts.length > 0) {
    const merged = await mergeMemoryDocument({
      kind: "group",
      existing: ctx.input.existingGroupFacts,
      incoming: extracted.groupFacts,
      traceTurnId: ctx.turnId,
    });
    replaceGroupFacts(ctx.groupChatId, merged ? [merged] : []);
    logEvent("memory_updated", {
      scope: "group",
      groupId: ctx.groupChatId,
      factCount: extracted.groupFacts.length,
    });
    anyUpdated = true;
    updatedScopes.push("group");
  }

  const generalNew = newFactsOnly(
    ctx.input.existingGeneralFacts,
    extracted.generalFacts,
  );
  if (generalNew.length > 0) {
    addGeneralFacts(generalNew);
    logEvent("memory_updated", {
      scope: "general",
      factCount: generalNew.length,
    });
    anyUpdated = true;
    updatedScopes.push("general");
  }

  if (ctx.turnId != null) {
    getDebugTrace(ctx.turnId)?.updateMemoryResult({
      memoryUpdated: anyUpdated,
      memoryScopes: updatedScopes,
    });
  }

  if (!anyUpdated) {
    logEvent("memory_extract_no_changes", {
      userId: ctx.userId,
      groupId: ctx.groupChatId,
    });
  }
}

async function mergeMemoryDocument(input: {
  kind: "user" | "group";
  existing: string[];
  incoming: string[];
  traceTurnId?: number;
}): Promise<string> {
  const existing = input.existing.join("\n").trim() || "(none yet)";
  const incoming = input.incoming.map((f) => `- ${f}`).join("\n");
  const messages: ChatMessage[] = [
    { role: "system", content: MEMORY_MERGE_SYSTEM },
    {
      role: "user",
      content:
        `Entity kind: ${input.kind}\n\n` +
        `Existing memory:\n${existing}\n\n` +
        `Newly extracted information:\n${incoming}`,
    },
  ];

  const raw = await chatComplete(messages, {
    numPredict: MEMORY_MERGE_NUM_PREDICT,
    auxiliary: true,
    think: true,
    traceTurnId: input.traceTurnId,
    traceLabel: `${input.kind} memory merge`,
  });

  return parseMemoryBlock(raw);
}

const MEMORY_BLOCK = /\[MEMORY\]\s*([\s\S]*?)\s*\[\/MEMORY\]/i;

function parseMemoryBlock(raw: string): string {
  const block = (raw.match(MEMORY_BLOCK)?.[1] ?? raw).trim();
  if (!block || /^none$/i.test(block)) return "";
  return block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

/** Facts in incoming that are not already stored (case-insensitive). */
export function newFactsOnly(
  existing: string[],
  incoming: string[],
): string[] {
  const keys = new Set(existing.map((f) => f.toLowerCase()));
  const out: string[] = [];
  for (const fact of incoming) {
    const normalized = fact.trim();
    if (normalized.length < 2) continue;
    const key = normalized.toLowerCase();
    if (keys.has(key)) continue;
    keys.add(key);
    out.push(normalized);
  }
  return out;
}
