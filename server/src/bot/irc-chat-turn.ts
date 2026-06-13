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
import { getHistory, historyToChatMessages, clearHistory } from "../db/history.js";
import { buildSystemPrompt, type ParticipantFacts } from "../prompts.js";
import { recordExchange } from "./conversation.js";
import { logEvent, logEventError } from "../event-log.js";
import { getOwnerUserId, getOwnerUsername } from "./owner.js";
import { clearUserMemory } from "../db/user-memory.js";
import { buildMoodCommandReply } from "./mood-command.js";

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
 * Check whether an IRC nick matches the configured bot owner.
 */
function isIrcOwner(nick: string): boolean {
  const ownerUser = getOwnerUsername();
  const ownerId = getOwnerUserId();
  if (ownerUser && nick.toLowerCase() === ownerUser.toLowerCase()) return true;
  if (ownerId && nick === ownerId) return true;
  return false;
}

/**
 * Parsed IRC command extracted from a message.
 */
interface ParsedIrcCommand {
  /** Command name without prefix (e.g. "help", "reset"). */
  name: string;
  /** Everything after the command name, trimmed. */
  args: string;
}

/**
 * Try to parse a message as an IRC command.
 * Recognises both `!command` and `/command` prefixes.
 *
 * @returns Parsed command, or null if the message is not a command.
 */
function parseIrcCommand(text: string): ParsedIrcCommand | null {
  const trimmed = text.trim();
  const match = /^[!/]([a-zA-Z0-9_]+)(?:\s+(.*))?$/s.exec(trimmed);
  if (!match) return null;
  return { name: (match[1] ?? "").toLowerCase(), args: (match[2] ?? "").trim() };
}

/**
 * Handle a recognised IRC command directly, without calling the LLM.
 *
 * @returns Reply text if the command was handled, null if the message
 *          should fall through to the normal LLM pipeline.
 */
function handleIrcCommand(cmd: ParsedIrcCommand, nick: string, convKey: string, channel: string): string | null {
  const settings = getSettings();
  const owner = isIrcOwner(nick);

  switch (cmd.name) {
    case "start":
      return [
        `Hi ${nick}! I'm connected to the LLM.`,
        "",
        `Model: ${settings.model}`,
        `Commands: !help !id !reset !forget !mood !remember`,
        owner ? "You are the configured bot owner." : "",
        "I remember recent messages in this conversation.",
      ]
        .filter(Boolean)
        .join("\n");

    case "help":
      return [
        "Available commands:",
        "  !start     — Welcome message and status",
        "  !id        — Show your identifier",
        "  !reset     — Clear chat history (owner only)",
        "  !forget    — Clear your stored memory",
        "  !mood      — Show current mood (owner only)",
        "  !remember  — Store a fact (owner only, e.g. !remember the sky is blue)",
        "",
        "You can also just chat normally — every message goes to the LLM.",
      ].join("\n");

    case "id":
      return `Your IRC nick: ${nick}\nChannel: ${channel}` +
        (owner ? "\nYou are the configured bot owner." : "");

    case "reset":
      if (!owner) return "Only the bot owner can use !reset.";
      clearHistory(convKey);
      return "Chat history cleared for this conversation.";

    case "forget":
      clearUserMemory(nick);
      return "Your stored memory has been cleared.";

    case "mood":
      if (!owner) return "Only the bot owner can use !mood.";
      try {
        return buildMoodCommandReply();
      } catch (err) {
        return "Sorry, I could not load mood.";
      }

    case "remember":
      if (!owner) return "Only the bot owner can use !remember.";
      if (!cmd.args) return "Usage: !remember <fact to store>";
      // Fall through to LLM — the fact is passed as the message text.
      return null;

    default:
      // Unknown command — let the LLM handle it naturally.
      return null;
  }
}

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
  const { channel, nick } = input;
  let text = input.text;
  const convKey = ircConversationKey(channel, nick);

  const turnLog = {
    turnId: turnNumber,
    channel,
    nick,
    convKey,
  };

  // Check for !command or /command before hitting the LLM.
  const cmd = parseIrcCommand(text);
  if (cmd) {
    const cmdReply = handleIrcCommand(cmd, nick, convKey, channel);
    if (cmdReply !== null) {
      logEvent("irc_command_handled", { ...turnLog, command: cmd.name });
      return { reply: cmdReply };
    }
    // Command wants fall-through (e.g. !remember) — use the args as text.
    text = cmd.args || text;
  }

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
