import type { Context } from "grammy";
import { chatComplete } from "../llm/client.js";
import type { ChatMessage } from "../llm/client.js";
import {
  getBotIdentity,
  messageReferencesBotByName,
  type BotIdentity,
} from "./bot-identity.js";
import { isMessageForBot } from "./addressed.js";
import { stripNonBotMentions } from "./mentions.js";
import { stickerHistoryLabel } from "./stickers.js";
import { logEvent, logEventError } from "../event-log.js";

const ADDRESS_CHECK_NUM_PREDICT = 96;

export type AddressSource =
  | "private"
  | "mention_or_reply"
  | "name"
  | "analyzer"
  | "no_text";

export interface AddressCheckResult {
  addressed: boolean;
  source?: AddressSource;
}

const ANALYZER_SYSTEM = `You decide whether a group-chat message explicitly names a specific Telegram bot and should receive a reply.

Output ONLY:

[ADDRESS]
yes
[/ADDRESS]

or

[ADDRESS]
no
[/ADDRESS]

Say yes only when the message contains a reference to the bot identity:
- The bot's username, first name, full name, nickname, or a clear spelling/case/punctuation variation
- A clear translation/transliteration of the bot's name into another language
- A natural-language call to that named bot, such as "<bot name>, what do you think?"

Say no when:
- Humans are chatting among themselves with no request aimed at the bot
- The bot is not named, even if the message asks a general question or sounds like it wants an assistant
- The message says "bot", "assistant", "AI", or similar generic words without the specific bot name
- It is background banter the bot should not interrupt`;

const ADDRESS_BLOCK = /\[ADDRESS\]\s*([\s\S]*?)\s*\[\/ADDRESS\]/i;

function parseAddressDecision(raw: string): boolean {
  const match = raw.match(ADDRESS_BLOCK);
  const value = (match?.[1] ?? raw).trim().toLowerCase();
  if (!value) return false;
  if (/^no\b/.test(value) || value === "n") return false;
  return /^y(es)?\b/.test(value) || value === "y";
}

export function messageTextForAddressCheck(ctx: Context): string {
  const msg = ctx.message;
  if (!msg) return "";

  const text = (msg.text ?? msg.caption ?? "").trim();
  if (text) return text;

  if (msg.sticker) return stickerHistoryLabel(msg.sticker);
  if (msg.photo?.length) return "[photo]";
  if (msg.document?.mime_type?.startsWith("image/")) {
    return msg.document.file_name
      ? `[image file: ${msg.document.file_name}]`
      : "[image file]";
  }
  if (msg.video) return "[video]";
  if (msg.voice) return "[voice message]";
  if (msg.audio) return "[audio]";
  return "[message]";
}

function formatBotNamesForAnalyzer(bot: BotIdentity): string {
  const labels = new Set<string>();
  labels.add(`@${bot.username}`);
  for (const alias of bot.aliases) {
    if (alias.length >= 3) labels.add(alias);
  }
  return [...labels].join(", ");
}

/**
 * Whether the bot should treat this message as addressed.
 * Private chats: always true. Groups: @mention/reply/command, name match, then LLM name-variant check.
 */
export async function isMessageAddressedToBot(
  ctx: Context,
  turnId?: number,
): Promise<AddressCheckResult> {
  const baseLog = {
    chatId: ctx.chat?.id,
    userId: ctx.from?.id,
    chatType: ctx.chat?.type,
  };

  if (ctx.chat?.type === "private") {
    logEvent("message_addressed", { ...baseLog, source: "private" });
    return { addressed: true, source: "private" };
  }

  if (isMessageForBot(ctx)) {
    logEvent("message_addressed", { ...baseLog, source: "mention_or_reply" });
    return { addressed: true, source: "mention_or_reply" };
  }

  const bot = getBotIdentity();
  const textForNameCheck = stripNonBotMentions(ctx.message, {
    botId: ctx.me?.id,
    botUsername: ctx.me?.username,
  });
  if (textForNameCheck && messageReferencesBotByName(textForNameCheck, bot)) {
    logEvent("message_addressed", { ...baseLog, source: "name" });
    return { addressed: true, source: "name" };
  }

  const text = (ctx.message?.text ?? ctx.message?.caption ?? "").trim();
  if (!text) {
    logEvent("message_address_decision", {
      ...baseLog,
      turnId,
      addressed: false,
      source: "no_text",
    });
    return { addressed: false, source: "no_text" };
  }

  return analyzeGroupMessageForBot(ctx, bot, text, turnId);
}

async function analyzeGroupMessageForBot(
  ctx: Context,
  bot: BotIdentity,
  text: string,
  turnId?: number,
): Promise<AddressCheckResult> {
  const chatType = ctx.chat?.type;
  if (chatType !== "group" && chatType !== "supergroup") {
    return { addressed: false };
  }

  const sender = ctx.from
    ? [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(" ") ||
      ctx.from.username ||
      "Someone"
    : "Someone";

  const messages: ChatMessage[] = [
    { role: "system", content: ANALYZER_SYSTEM },
    {
      role: "user",
      content:
        `Bot identity (names users may use): ${formatBotNamesForAnalyzer(bot)}\n` +
        `Chat type: ${chatType}\n` +
        `Sender: ${sender}\n\n` +
        `Message:\n${text.trim() || "(empty or non-text)"}`,
    },
  ];

  try {
    const raw = await chatComplete(messages, {
      numPredict: ADDRESS_CHECK_NUM_PREDICT,
      auxiliary: true,
      traceTurnId: turnId,
      traceLabel: "address detection",
    });
    const yes = parseAddressDecision(raw);
    if (yes) {
      logEvent("message_addressed", {
        chatId: ctx.chat?.id,
        userId: ctx.from?.id,
        turnId,
        chatType,
        source: "analyzer",
      });
      return { addressed: true, source: "analyzer" };
    }
    logEvent("message_address_decision", {
      chatId: ctx.chat?.id,
      userId: ctx.from?.id,
      turnId,
      chatType,
      addressed: false,
      source: "analyzer",
    });
    return { addressed: false, source: "analyzer" };
  } catch (err) {
    logEventError("address_analyzer_failed", err, {
      chatId: ctx.chat?.id,
      userId: ctx.from?.id,
      chatType,
    });
    return { addressed: false, source: "analyzer" };
  }
}
