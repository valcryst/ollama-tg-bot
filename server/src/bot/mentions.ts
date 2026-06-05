import type { Message, MessageEntity } from "@grammyjs/types";
import {
  findKnownUserByUsername,
  findKnownUsersMentionedInText,
  formatKnownUserLabel,
  getKnownUserById,
  type KnownUserRecord,
} from "../db/known-users.js";
import { userRoleTagFromKnown } from "./history-format.js";
import { formatSpeakerLabel } from "./speaker.js";
import { sliceEntity } from "./addressed.js";

interface ResolvedMention {
  userId: string;
  visible: string;
  description: string;
}

export interface MentionContext {
  botId?: number;
  botUsername?: string;
  senderId?: number;
  senderUsername?: string;
}

/** Append who @mentions and name references refer to (from known_users). */
export function enrichTextWithUserMentions(
  text: string,
  message: Message | undefined,
  context: MentionContext = {},
): string {
  const trimmed = text.trim();
  if (!trimmed) return text;

  const mentions = collectMentionedKnownUsers(trimmed, message, context);
  if (mentions.length === 0) return text;

  const lines = mentions.map((m) => `• ${m.visible} → ${m.description}`);
  return (
    `${trimmed}\n\n` +
    `[Mentioned Telegram users in this message:\n${lines.join("\n")}]`
  );
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
): ResolvedMention[] {
  const { botId, botUsername, senderId, senderUsername } = context;
  const excludeUserIds = [
    senderId != null ? String(senderId) : null,
    botId != null ? String(botId) : null,
  ].filter((id): id is string => Boolean(id));

  const seen = new Set<string>();
  const mentions: ResolvedMention[] = [];

  const addRecord = (record: KnownUserRecord, visible: string) => {
    if (seen.has(record.userId)) return;
    seen.add(record.userId);
    mentions.push({
      userId: record.userId,
      visible,
      description: formatKnownMentionDescription(record),
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
): ResolvedMention[] {
  const { text, entities } = messageTextAndEntities(message);
  if (!text) return [];

  const { botId, botUsername, senderId, senderUsername } = context;
  const botUser = botUsername?.toLowerCase();
  const senderUser = senderUsername?.toLowerCase();
  const mentions: ResolvedMention[] = [];

  for (const entity of entities) {
    if (entity.type === "text_mention") {
      const user = entity.user;
      if (botId != null && user.id === botId) continue;
      if (senderId != null && user.id === senderId) continue;

      const visible = `"${sliceEntity(text, entity.offset, entity.length)}"`;
      const known = getKnownUserById(String(user.id)) ?? null;
      if (known) {
        mentions.push({
          userId: known.userId,
          visible,
          description: formatKnownMentionDescription(known),
        });
      } else {
        mentions.push({
          userId: String(user.id),
          visible,
          description: formatSpeakerLabel(user),
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
        });
      } else {
        mentions.push({
          userId: `@${username}`,
          visible: raw,
          description:
            "Telegram username (person not in known_users yet — they may not have messaged the bot)",
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
