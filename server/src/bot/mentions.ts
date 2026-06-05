import type { Message, MessageEntity } from "@grammyjs/types";
import {
  findKnownUserByUsername,
  findKnownUsersMentionedInText,
  formatKnownUserLabel,
  getKnownUserById,
  type KnownUserRecord,
} from "../db/known-users.js";
import { getUserFacts } from "../db/user-memory.js";
import { userRoleTagFromKnown } from "./history-format.js";
import { formatSpeakerLabel } from "./speaker.js";
import { sliceEntity } from "./addressed.js";

export interface MentionedKnownUser {
  userId: string;
  visible: string;
  description: string;
  isKnown: boolean;
}

export interface MentionContext {
  botId?: number;
  botUsername?: string;
  senderId?: number;
  senderUsername?: string;
}

/** Resolve @mentions and name references against known_users. */
export function resolveMentionedKnownUsers(
  text: string,
  message: Message | undefined,
  context: MentionContext = {},
): MentionedKnownUser[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return collectMentionedKnownUsers(trimmed, message, context);
}

/** Passive history / transcript: append a compact mention footer. */
export function enrichTextWithUserMentions(
  text: string,
  message: Message | undefined,
  context: MentionContext = {},
): string {
  const mentions = resolveMentionedKnownUsers(text, message, context);
  if (mentions.length === 0) return text;

  const lines = mentions.map((m) => `• ${m.visible} → ${m.description}`);
  return (
    `${text.trim()}\n\n` +
    `[Mentioned Telegram users in this message:\n${lines.join("\n")}]`
  );
}

/**
 * Prominent latest-turn block — model must use this when asked who someone is.
 */
export function formatMentionedUsersContext(
  mentions: MentionedKnownUser[],
): string | null {
  const known = mentions.filter((m) => m.isKnown);
  if (known.length === 0) return null;

  const lines = [
    "[MENTIONED USERS — people referenced in this message]",
    "If the speaker asks who they are, identify them from here. Do not claim you lack this information.",
  ];

  for (const m of known) {
    lines.push(`• ${m.visible} → ${m.description}`);
    const facts = getUserFacts(m.userId);
    if (facts.length > 0) {
      for (const fact of facts) {
        lines.push(`  - ${fact}`);
      }
    } else {
      lines.push(
        "  - (no extra stored facts — use their Telegram name/username above)",
      );
    }
  }

  return lines.join("\n");
}

/** Remove @mentions of people other than the bot (for name-based address detection). */
export function stripNonBotMentions(
  message: Message | undefined,
  context: Pick<MentionContext, "botId" | "botUsername"> = {},
): string {
  if (!message) return "";

  const { text, entities } = messageTextAndEntities(message);
  if (!text) return "";

  const { botId, botUsername } = context;
  let out = text;

  for (const entity of [...entities].sort((a, b) => b.offset - a.offset)) {
    if (entity.type !== "mention" && entity.type !== "text_mention") continue;
    if (isBotMentionEntity(entity, text, botId, botUsername)) continue;
    out =
      out.slice(0, entity.offset) +
      " " +
      out.slice(entity.offset + entity.length);
  }

  return out.replace(/\s{2,}/g, " ").trim();
}

function collectMentionedKnownUsers(
  text: string,
  message: Message | undefined,
  context: MentionContext,
): MentionedKnownUser[] {
  const { botId, botUsername, senderId, senderUsername } = context;
  const excludeUserIds = [
    senderId != null ? String(senderId) : null,
    botId != null ? String(botId) : null,
  ].filter((id): id is string => Boolean(id));

  const seen = new Set<string>();
  const mentions: MentionedKnownUser[] = [];

  const addRecord = (record: KnownUserRecord, visible: string) => {
    if (seen.has(record.userId)) return;
    seen.add(record.userId);
    mentions.push({
      userId: record.userId,
      visible,
      description: formatKnownMentionDescription(record),
      isKnown: true,
    });
  };

  if (message) {
    for (const entityMention of collectEntityMentions(message, context)) {
      if (seen.has(entityMention.userId)) continue;
      seen.add(entityMention.userId);
      mentions.push(entityMention);
    }
  }

  const plainTextMatches = findKnownUsersMentionedInText(text, {
    excludeUserIds: [...excludeUserIds, ...seen],
    botUsername,
  });
  for (const record of plainTextMatches) {
    const visible = pickVisibleReference(text, record);
    addRecord(record, visible);
  }

  return mentions;
}

function formatKnownMentionDescription(record: KnownUserRecord): string {
  return (
    `${formatKnownUserLabel(record)}, Telegram id ${record.userId}, ` +
    `history tag ${userRoleTagFromKnown(record)}`
  );
}

function pickVisibleReference(text: string, record: KnownUserRecord): string {
  if (record.username) {
    const atPattern = new RegExp(
      `@${record.username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "i",
    );
    const atMatch = text.match(atPattern);
    if (atMatch) return atMatch[0];
  }
  const first = record.firstName?.trim();
  if (first) {
    const namePattern = new RegExp(
      `\\b${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`,
      "i",
    );
    const nameMatch = text.match(namePattern);
    if (nameMatch) return `"${nameMatch[0]}"`;
  }
  return `"${formatKnownUserLabel(record)}"`;
}

function collectEntityMentions(
  message: Message,
  context: MentionContext,
): MentionedKnownUser[] {
  const { text, entities } = messageTextAndEntities(message);
  if (!text) return [];

  const { botId, botUsername, senderId, senderUsername } = context;
  const botUser = botUsername?.toLowerCase();
  const senderUser = senderUsername?.toLowerCase();
  const mentions: MentionedKnownUser[] = [];

  for (const entity of entities) {
    if (entity.type === "text_mention") {
      const user = entity.user;
      if (botId != null && user.id === botId) continue;
      if (senderId != null && user.id === senderId) continue;

      const visible = `"${sliceEntity(text, entity.offset, entity.length)}"`;
      const known = getKnownUserById(String(user.id));
      if (known) {
        mentions.push({
          userId: known.userId,
          visible,
          description: formatKnownMentionDescription(known),
          isKnown: true,
        });
      } else {
        mentions.push({
          userId: String(user.id),
          visible,
          description: formatSpeakerLabel(user),
          isKnown: false,
        });
      }
      continue;
    }

    if (entity.type === "mention") {
      const raw = sliceEntity(text, entity.offset, entity.length);
      const username = raw.replace(/^@/, "").toLowerCase();
      if (!username) continue;
      if (botUser && username === botUser) continue;
      if (senderUser && username === senderUser) continue;

      const known = findKnownUserByUsername(username);
      if (known) {
        mentions.push({
          userId: known.userId,
          visible: raw,
          description: formatKnownMentionDescription(known),
          isKnown: true,
        });
      } else {
        mentions.push({
          userId: `@${username}`,
          visible: raw,
          description:
            "Telegram username (person not in known_users yet — they may not have messaged the bot)",
          isKnown: false,
        });
      }
    }
  }

  return mentions;
}

function messageTextAndEntities(message: Message): {
  text: string;
  entities: MessageEntity[];
} {
  if (message.text != null) {
    return { text: message.text, entities: message.entities ?? [] };
  }
  if (message.caption != null) {
    return { text: message.caption, entities: message.caption_entities ?? [] };
  }
  return { text: "", entities: [] };
}

function isBotMentionEntity(
  entity: MessageEntity,
  text: string,
  botId?: number,
  botUsername?: string,
): boolean {
  if (entity.type === "text_mention") {
    return botId != null && entity.user.id === botId;
  }
  if (entity.type === "mention") {
    const raw = sliceEntity(text, entity.offset, entity.length);
    const username = raw.replace(/^@/, "").toLowerCase();
    const botUser = botUsername?.toLowerCase();
    return !!botUser && username === botUser;
  }
  return false;
}
