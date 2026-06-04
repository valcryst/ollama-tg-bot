import type { Context } from "grammy";
import { chatComplete } from "../ollama/client.js";
import type { ChatMessage } from "../ollama/client.js";
import {
  getBotIdentity,
  messageReferencesBotByName,
  type BotIdentity,
} from "./bot-identity.js";
import { isMessageForBot } from "./addressed.js";
import { stripNonBotMentions } from "./mentions.js";
import { stickerHistoryLabel } from "./stickers.js";

const ADDRESS_CHECK_NUM_PREDICT = 96;

const ANALYZER_SYSTEM = `You decide whether a group-chat message is directed at a specific Telegram bot and should receive a reply.

Output ONLY:

[ADDRESS]
yes
[/ADDRESS]

or

[ADDRESS]
no
[/ADDRESS]

Say yes when someone:
- Uses the bot's name, username, or a clear nickname or variation
- Asks the bot a question or for its opinion
- Clearly expects the assistant to respond (even without @mention)

Say no when:
- Humans are chatting among themselves with no request aimed at the bot
- The bot is not referenced and nothing asks an assistant to answer
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
 * Private chats: always true. Groups: @mention/reply/command, name match, then LLM.
 */
export async function isMessageAddressedToBot(ctx: Context): Promise<boolean> {
  if (ctx.chat?.type === "private") return true;

  if (isMessageForBot(ctx)) return true;

  const bot = getBotIdentity();
  const textForNameCheck = stripNonBotMentions(ctx.message, {
    botId: ctx.me?.id,
    botUsername: ctx.me?.username,
  });
  if (textForNameCheck && messageReferencesBotByName(textForNameCheck, bot)) {
    return true;
  }

  const text = messageTextForAddressCheck(ctx);

  return analyzeGroupMessageForBot(ctx, bot, text);
}

async function analyzeGroupMessageForBot(
  ctx: Context,
  bot: BotIdentity,
  text: string,
): Promise<boolean> {
  const chatType = ctx.chat?.type;
  if (chatType !== "group" && chatType !== "supergroup") return false;

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
    });
    const yes = parseAddressDecision(raw);
    if (yes) {
      console.log(
        `Address analyzer: respond in ${chatType} ${ctx.chat?.id} ` +
          `(from ${ctx.from?.id ?? "?"}): ${text.slice(0, 80)}`,
      );
    }
    return yes;
  } catch (err) {
    console.error("Address analyzer failed:", err);
    return false;
  }
}
