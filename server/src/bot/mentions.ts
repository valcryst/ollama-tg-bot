import type { Message, MessageEntity } from "@grammyjs/types";
import { formatSpeakerLabel } from "./speaker.js";
import { sliceEntity } from "./addressed.js";

interface ResolvedMention {
  key: string;
  visible: string;
  description: string;
}

export interface MentionContext {
  botId?: number;
  botUsername?: string;
  senderId?: number;
  senderUsername?: string;
}

/** Append who @mentions refer to so the model can answer about other users. */
export function enrichTextWithUserMentions(
  text: string,
  message: Message | undefined,
  context: MentionContext = {},
): string {
  const trimmed = text.trim();
  if (!trimmed || !message) return text;

  const mentions = collectUserMentions(message, context);
  if (mentions.length === 0) return text;

  const lines = mentions.map(
    (m) => `• ${m.visible} → ${m.description}`,
  );
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

function collectUserMentions(
  message: Message,
  context: MentionContext,
): ResolvedMention[] {
  const { text, entities } = messageTextAndEntities(message);
  if (!text) return [];

  const { botId, botUsername, senderId, senderUsername } = context;
  const botUser = botUsername?.toLowerCase();
  const senderUser = senderUsername?.toLowerCase();
  const seen = new Set<string>();
  const mentions: ResolvedMention[] = [];

  for (const entity of entities) {
    if (entity.type === "text_mention") {
      const user = entity.user;
      if (botId != null && user.id === botId) continue;
      if (senderId != null && user.id === senderId) continue;

      const key = `id:${user.id}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const visible = sliceEntity(text, entity.offset, entity.length);
      mentions.push({
        key,
        visible: `"${visible}"`,
        description: formatSpeakerLabel(user),
      });
      continue;
    }

    if (entity.type === "mention") {
      const raw = sliceEntity(text, entity.offset, entity.length);
      const username = raw.replace(/^@/, "").toLowerCase();
      if (!username) continue;
      if (botUser && username === botUser) continue;
      if (senderUser && username === senderUser) continue;

      const key = `@${username}`;
      if (seen.has(key)) continue;
      seen.add(key);

      mentions.push({
        key,
        visible: raw,
        description: "Telegram username (display name not attached to this mention)",
      });
    }
  }

  return mentions;
}
