import type { Api } from "grammy";
import { findKnownUserByUsername } from "../db/known-users.js";

const USERNAME_RE = /^[a-z0-9_]{5,32}$/i;

export function normalizeTelegramUsername(input: string): string | null {
  const username = input.trim().replace(/^@/, "").toLowerCase();
  if (!username) return null;
  if (!USERNAME_RE.test(username)) return null;
  return username;
}

/** Resolve @username to a numeric Telegram user id via Bot API and known contacts. */
export async function resolveOwnerUsername(
  api: Api,
  input: string,
): Promise<string> {
  const username = normalizeTelegramUsername(input);
  if (!username) {
    throw new Error(
      "Invalid Telegram username (use 5–32 letters, numbers, or underscores)",
    );
  }

  const known = findKnownUserByUsername(username);
  if (known) return known.userId;

  try {
    const chat = await api.getChat(`@${username}`);
    if (chat.type === "private" && "id" in chat) {
      return String(chat.id);
    }
  } catch {
    // Bot API only resolves some chats by @username; fall through.
  }

  throw new Error(
    `Could not resolve @${username}. Ask them to send any message to the bot (e.g. /start), then save again.`,
  );
}
