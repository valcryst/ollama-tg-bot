import type { Message, User } from "@grammyjs/types";
import type { KnownUserRecord } from "../db/known-users.js";

export const ASSISTANT_ROLE = "assistant";

/** Role key stored in DB: user:username:userId */
export function userRoleTag(user: User | undefined): string | null {
  if (!user?.id) return null;
  return userRoleTagFromParts(
    String(user.id),
    user.username,
    user.first_name,
  );
}

export function userRoleTagFromKnown(record: KnownUserRecord): string {
  return userRoleTagFromParts(
    record.userId,
    record.username,
    record.firstName,
  );
}

export function userRoleTagFromParts(
  userId: string,
  username?: string | null,
  firstName?: string | null,
): string {
  const tagName = sanitizeTagPart(
    username?.toLowerCase() ?? firstName?.toLowerCase() ?? "unknown",
  );
  return `user:${tagName}:${userId}`;
}

export function parseUserRole(role: string): { username: string; userId: string } | null {
  if (!role.startsWith("user:")) return null;
  const parts = role.split(":");
  if (parts.length < 3) return null;
  const userId = parts[parts.length - 1];
  const username = parts.slice(1, -1).join(":");
  if (!userId) return null;
  return { username, userId };
}

export function extractParticipantUserIds(
  roles: string[],
  extraUserIds: string[] = [],
): string[] {
  const ids = new Set<string>();
  for (const role of roles) {
    const parsed = parseUserRole(role);
    if (parsed) ids.add(parsed.userId);
  }
  for (const id of extraUserIds) {
    if (id) ids.add(id);
  }
  return [...ids];
}

export function formatSaidContent(userTag: string, text: string): string {
  return `[${userTag} said]: ${text.trim()}`;
}

export function formatRepliedContent(
  userTag: string,
  replyToTag: string,
  text: string,
): string {
  return `[${userTag} replied to ${replyToTag}]: ${text.trim()}`;
}

const ASSISTANT_SAID_PREFIX = /^\[assistant said\]\s*:?\s*/i;
const STICKER_HISTORY_LINE = /^\[sticker:\s*[^\]]+\]\s*$/i;
const ECHOED_USER_HISTORY_PREFIX =
  /^\[(?:user:[^\]]+(?:\s+(?:said|replied to[^\]]*|sent \w+))?|compressed)\]\s*:\s*/i;

/** Stored assistant rows use an envelope; strip before sending to the model. */
export function stripAssistantHistoryEnvelope(text: string): string {
  return stripStickerHistoryLines(text.replace(ASSISTANT_SAID_PREFIX, "")).trim();
}

/** Remove internal history metadata if the model echoes it in a user-facing reply. */
export function stripEchoedHistoryMarkup(text: string): string {
  let result = text.trim().replace(ASSISTANT_SAID_PREFIX, "");
  result = result.replace(ECHOED_USER_HISTORY_PREFIX, "");
  return stripStickerHistoryLines(result).trim();
}

function stripStickerHistoryLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !STICKER_HISTORY_LINE.test(line.trim()))
    .join("\n");
}

export function resolveReplyTargetTag(
  message: Message,
  botId?: number,
): string | null {
  const replied = message.reply_to_message;
  if (!replied) return null;
  if (botId != null && replied.from?.id === botId) return ASSISTANT_ROLE;
  return userRoleTag(replied.from);
}

export function buildTextHistoryContent(
  user: User | undefined,
  message: Message,
  text: string,
  botId?: number,
): string | null {
  const userTag = userRoleTag(user);
  if (!userTag || !text.trim()) return null;

  const replyTo = resolveReplyTargetTag(message, botId);
  if (replyTo) {
    return formatRepliedContent(userTag, replyTo, text);
  }
  return formatSaidContent(userTag, text);
}

export type MediaKind = "sticker" | "image";

export function mediaKindForMessage(
  message: Message,
  sticker = false,
): MediaKind {
  if (sticker || message.sticker) return "sticker";
  return "image";
}

/** History line after vision: [user:… sent sticker]: … or [user:… replied to … with image]: … */
export function buildMediaHistoryContent(
  user: User | undefined,
  message: Message,
  mediaKind: MediaKind,
  visionDescription: string,
  botId?: number,
  packEmoji?: string | null,
): string | null {
  const userTag = userRoleTag(user);
  if (!userTag || !visionDescription.trim()) return null;

  const replyTo = resolveReplyTargetTag(message, botId);
  const prefix = replyTo
    ? `[${userTag} replied to ${replyTo} with ${mediaKind}]`
    : `[${userTag} sent ${mediaKind}]`;
  let body = visionDescription.trim();
  if (mediaKind === "sticker" && packEmoji) {
    body = `${body}. it represents emoji ${packEmoji}`;
  }
  return `${prefix}: ${body}`;
}

/** Passive group logging — text only. Media is recorded when the bot replies (with vision). */
export function buildPassiveHistoryContent(
  message: Message,
  user: User | undefined,
  text: string,
  botId?: number,
): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  return buildTextHistoryContent(user, message, trimmed, botId);
}

function sanitizeTagPart(value: string): string {
  return value.replace(/[:[\]]/g, "_").trim() || "unknown";
}
