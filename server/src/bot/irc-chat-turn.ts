/**
 * IRC chat turn — LLM reply pipeline for IRC training mode.
 *
 * Simplified compared to the Telegram chat turn: no link fetch, web search,
 * mood evaluation, stickers, or HTML formatting. Calls the same LLM client
 * and reply extraction functions used by the Telegram path.
 */
import type { ChatMessage } from "../llm/client.js";
import { chatCompleteDetailed } from "../llm/client.js";
import { extractTelegramReply } from "../response-format.js";
import { getActivePersonalityPrompt } from "../db/personalities.js";
import { getSettings, recordError } from "../db/database.js";
import { getHistory, historyToChatMessages } from "../db/history.js";
import { buildSystemPrompt, type ParticipantFacts } from "../prompts.js";
import { recordExchange } from "./conversation.js";
import { logEvent, logEventError } from "../event-log.js";
import { getOwnerUserId, getOwnerUsername } from "./owner.js";

/**
 * Input for an IRC chat turn.
 */
export interface IrcTurnInput {
  /** IRC channel the message was sent to. */
  channel: string;
  /** Sender nickname. */
  nick: string;
  /** Message text. */
  text: string;
}

/**
 * Result of an IRC chat turn.
 */
export interface IrcTurnResult {
  /** Extracted [REPLY] text, ready for IRC delivery. */
  reply: string;
}

/** Monotonic turn counter for IRC messages. */
let ircTurnCounter = 0;

/**
 * Build a conversation key scoped to an IRC user within a channel.
 *
 * Format: `irc:<channel>:<nick>` — isolates history per user.
 */
function ircConversationKey(channel: string, nick: string): string {
  return `irc:${channel}:${nick}`;
}

/**
 * Build system prompt + history messages for an IRC turn.
 *
 * Returns the full message array ready for {@link chatCompleteDetailed},
 * plus the text that should be recorded in history.
 */
function buildIrcMessages(
  channel: string,
  nick: string,
  text: string,
): { messages: ChatMessage[]; userHistoryContent: string } {
  const settings = getSettings();
  const convKey = ircConversationKey(channel, nick);
  const customPrompt = getActivePersonalityPrompt();
  const storedHistory = getHistory(convKey);
  const historyMessages = historyToChatMessages(storedHistory);
  const userHistoryContent = text.trim();

  // Use full buildSystemPrompt (same as Telegram) to keep prompt parity.
  const system = buildSystemPrompt({
    settings,
    customPrompt,
    generalMemoryFacts: [],
    groupMemoryFacts: [],
    participantFacts: ([] as ParticipantFacts[]),
    knownChatUsers: [],
    isGroupChat: false,
    ownerUserId: getOwnerUserId(),
    ownerUsername: getOwnerUsername(),
    mood: null,
  });

  return {
    messages: [
      { role: "system", content: system },
      ...historyMessages,
      { role: "user", content: userHistoryContent },
    ],
    userHistoryContent,
  };
}

/**
 * Process one IRC message through the LLM pipeline.
 *
 * Builds history, calls the LLM, extracts the [REPLY], records the
 * exchange, and returns the reply text. Errors are logged to the event
 * log and error table; the caller receives a fallback reply.
 */
export async function runIrcTurn(input: IrcTurnInput): Promise<IrcTurnResult> {
  const turnNumber = ++ircTurnCounter;
  const { channel, nick, text } = input;
  const convKey = ircConversationKey(channel, nick);

  const turnLog = {
    turnId: turnNumber,
    channel,
    nick,
    convKey,
  };

  try {
    logEvent("irc_turn_started", turnLog);

    const { messages, userHistoryContent } = buildIrcMessages(
      channel,
      nick,
      text,
    );

    logEvent("llm_reply_started", { ...turnLog, mode: "irc" });
    const { raw: modelOutput } = await chatCompleteDetailed(messages, {
      think: false,
      traceTurnId: turnNumber,
      traceLabel: "irc reply",
    });

    const replyBody = extractTelegramReply(modelOutput);
    const hasReply = replyBody.trim().length > 0;

    recordExchange(convKey, `user:${nick}`, userHistoryContent, replyBody);
    logEvent("irc_turn_done", {
      ...turnLog,
      replyChars: replyBody.length,
      hasReply,
    });

    return {
      reply: hasReply ? replyBody.trim() : "[no reply generated]",
    };
  } catch (err) {
    logEventError("irc_turn_failed", err, turnLog);

    const message = err instanceof Error ? err.message : String(err);
    recordError({
      message,
      stack: err instanceof Error ? err.stack : undefined,
      chatId: 0,
      userId: nick,
    });

    return { reply: `Error: ${message}` };
  }
}
