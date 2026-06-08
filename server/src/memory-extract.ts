import {
  scheduleGeneralMemoryCompression,
  scheduleGroupMemoryCompression,
  scheduleUserMemoryCompression,
} from "./context-compress.js";
import { addGeneralFacts } from "./db/general-memory.js";
import { addGroupFacts } from "./db/group-memory.js";
import { addUserFacts } from "./db/user-memory.js";
import { chatComplete } from "./ollama/client.js";
import type { ChatMessage } from "./ollama/client.js";
import { parseStructuredResponse } from "./response-format.js";
import { logEvent, logEventError } from "./event-log.js";

const MEMORY_EXTRACT_NUM_PREDICT = 384;

const EXTRACTOR_SYSTEM = `You extract durable facts worth storing long-term from a single Telegram chat turn.

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

[MEMORY] = new facts about the current speaker only (name, preferences, role, timezone, how they want to be addressed). One fact per line. "none" if nothing new. In group chats, never store other members' traits here.

[GROUP_MEMORY] = new facts about the group/chat itself (purpose of the group, rules, recurring topics, in-jokes, what this chat is for). Not facts about individual users. "none" if nothing new or not a group chat.

[GENERAL_MEMORY] = new facts that apply across all chats: glossary terms, definitions, project/domain facts, standing instructions not tied to one person or group. "none" if nothing new.

Decide on your own — the user does not need to say "remember". Store facts that would still matter in a future session.

Store when the user shares:
- who they are, preferences, standing instructions
- what this group is for, norms, ongoing context
- definitions, acronyms, or knowledge meant for every conversation
- corrections to prior assumptions

Do NOT store:
- greetings, jokes, sarcasm, or the assistant's own banter
- one-off questions, transient moods, or message meta ("user replied to…")
- facts already listed under "Already stored"
- duplicates rephrased slightly
- user-specific traits in [GENERAL_MEMORY] or group-only context in [GENERAL_MEMORY]`;

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
): Promise<MemoryExtractResult> {
  const userBlock = formatStored("user", input.existingUserFacts);
  const groupBlock = input.isGroupChat
    ? formatStored("group", input.existingGroupFacts)
    : "Not a group chat — always write none in [GROUP_MEMORY].";
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
      verboseLabel: "memory extract",
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
  if (facts.length === 0) return `(none yet for this ${kind})`;
  return facts.map((f) => `- ${f}`).join("\n");
}

export interface MemoryPersistContext {
  input: MemoryExtractInput;
  userId: string | null;
  groupChatId: string | null;
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
  });
}

async function persistMemories(ctx: MemoryPersistContext): Promise<void> {
  logEvent("memory_extract_started", {
    userId: ctx.userId,
    groupId: ctx.groupChatId,
    isGroupChat: ctx.input.isGroupChat,
  });

  const extracted = await extractMemoriesFromTurn(ctx.input);
  let anyUpdated = false;

  if (ctx.userId) {
    const userNew = newFactsOnly(ctx.input.existingUserFacts, extracted.userFacts);
    if (userNew.length > 0) {
      addUserFacts(ctx.userId, userNew);
      scheduleUserMemoryCompression(ctx.userId);
      logEvent("memory_updated", {
        scope: "user",
        userId: ctx.userId,
        factCount: userNew.length,
      });
      anyUpdated = true;
    }
  }
  if (ctx.groupChatId) {
    const groupNew = newFactsOnly(
      ctx.input.existingGroupFacts,
      extracted.groupFacts,
    );
    if (groupNew.length > 0) {
      addGroupFacts(ctx.groupChatId, groupNew);
      scheduleGroupMemoryCompression(ctx.groupChatId);
      logEvent("memory_updated", {
        scope: "group",
        groupId: ctx.groupChatId,
        factCount: groupNew.length,
      });
      anyUpdated = true;
    }
  }

  const generalNew = newFactsOnly(
    ctx.input.existingGeneralFacts,
    extracted.generalFacts,
  );
  if (generalNew.length > 0) {
    addGeneralFacts(generalNew);
    scheduleGeneralMemoryCompression();
    logEvent("memory_updated", {
      scope: "general",
      factCount: generalNew.length,
    });
    anyUpdated = true;
  }

  if (!anyUpdated) {
    logEvent("memory_extract_no_changes", {
      userId: ctx.userId,
      groupId: ctx.groupChatId,
    });
  }
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
