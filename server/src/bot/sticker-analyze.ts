import { chatComplete } from "../llm/client.js";
import type { ChatMessage } from "../llm/client.js";
import { logEventError } from "../event-log.js";
import { isReplyThreadContext } from "./replies.js";
import {
  formatStickerCatalogForAnalyze,
  getStickerCatalogState,
} from "./sticker-catalog.js";

const STICKER_CHECK_NUM_PREDICT = 96;

const STICKER_TAG = "STICKER";
const STICKER_VALUE_MAX_LEN = 32;

const STICKER_BLOCK = new RegExp(
  `\\[${STICKER_TAG}\\]\\s*([\\s\\S]*?)\\s*\\[\\/${STICKER_TAG}\\]`,
  "i",
);

export interface StickerReplyRoll {
  chance: number;
  roll: number | null;
  hit: boolean;
}

export function rollStickerReplyChance(chance: number): StickerReplyRoll {
  if (chance <= 0) return { chance, roll: null, hit: false };
  if (chance >= 100) return { chance, roll: null, hit: true };
  const roll = Math.random() * 100;
  return { chance, roll, hit: roll < chance };
}

function buildStickerAnalyzerSystem(): string | null {
  const catalogSection = formatStickerCatalogForAnalyze();
  if (!catalogSection) return null;

  return (
    `You pick the best-matching Telegram sticker for a bot's text reply, based on emotional tone and context.\n\n` +
    `${catalogSection}\n\n` +
    `Output ONLY:\n\n` +
    `[${STICKER_TAG}]\n` +
    `<emoji or number>\n` +
    `[/${STICKER_TAG}]\n\n` +
    `Always pick the sticker that best fits the reply's mood, humor, or reaction — even if the fit is subtle.\n` +
    `Use the pack emoji exactly, or the sticker number from the list.`
  );
}

function parseStickerChoice(raw: string): string | null {
  const match = raw.match(STICKER_BLOCK);
  if (!match?.[1]) return null;
  const value = match[1].trim();
  if (!value || /^(none|no|skip|-)$/i.test(value)) return null;
  if (value.length > STICKER_VALUE_MAX_LEN || value.includes("\n")) return null;
  return value;
}

export interface StickerAnalyzeInput {
  userMessage: string;
  botReply: string;
  replyContext?: string | null;
  traceTurnId?: number;
}

/**
 * Ask the model which sticker best fits the bot's reply emotionally.
 */
export async function analyzeStickerForReply(
  input: StickerAnalyzeInput,
): Promise<string | null> {
  if (!getStickerCatalogState().loaded) return null;

  const system = buildStickerAnalyzerSystem();
  if (!system) return null;

  const botReply = input.botReply.trim();
  if (!botReply) return null;

  const replyContext = input.replyContext?.trim() ?? "";
  let content = `Bot reply to evaluate:\n${botReply}`;
  if (isReplyThreadContext(replyContext)) {
    content += `\n\nConversation context:\n${replyContext}`;
  } else {
    if (input.userMessage.trim()) {
      content += `\n\nUser message that prompted this reply:\n${input.userMessage.trim()}`;
    }
    if (replyContext) {
      content += `\n\nQuoted reply context:\n${replyContext}`;
    }
  }

  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content },
  ];

  try {
    const raw = await chatComplete(messages, {
      numPredict: STICKER_CHECK_NUM_PREDICT,
      auxiliary: true,
      traceTurnId: input.traceTurnId,
      traceLabel: "sticker pick",
    });
    return parseStickerChoice(raw);
  } catch (err) {
    logEventError("sticker_analyze_failed", err);
    return null;
  }
}
