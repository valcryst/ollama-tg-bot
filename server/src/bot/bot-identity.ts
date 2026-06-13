import type { UserFromGetMe } from "grammy/types";

const GENERIC_ALIAS_BLOCKLIST = new Set(["bot", "the", "and"]);

export interface BotIdentity {
  username: string;
  /** Lowercase strings that may refer to the bot in free text. */
  aliases: string[];
}

let identity: BotIdentity | null = null;

export function setBotIdentity(me: UserFromGetMe, username: string): void {
  identity = buildBotIdentity(me, username);
}

export function getBotIdentity(): BotIdentity {
  if (!identity) {
    throw new Error("Bot identity not initialized");
  }
  return identity;
}

function buildBotIdentity(me: UserFromGetMe, username: string): BotIdentity {
  const aliases = new Set<string>();
  const userLower = username.toLowerCase();
  aliases.add(userLower);

  if (userLower.endsWith("bot") && userLower.length > 5) {
    aliases.add(userLower.slice(0, -3).replace(/_+$/, ""));
  }

  const underscored = username.replace(/_/g, " ").trim();
  if (underscored.toLowerCase() !== userLower) {
    aliases.add(underscored.toLowerCase());
  }

  for (const part of splitCamelCase(username)) {
    const p = part.toLowerCase();
    if (p.length >= 3 && !GENERIC_ALIAS_BLOCKLIST.has(p)) aliases.add(p);
  }

  const spaced = usernameSpacedVariant(username);
  if (spaced) aliases.add(spaced);

  const first = me.first_name?.trim();
  if (first && first.length >= 3) {
    aliases.add(first.toLowerCase());
  }

  const fullName = [me.first_name, me.last_name].filter(Boolean).join(" ").trim();
  if (fullName.length >= 3) {
    aliases.add(fullName.toLowerCase());
  }

  return {
    username,
    aliases: [...aliases].sort((a, b) => b.length - a.length),
  };
}

function splitCamelCase(value: string): string[] {
  return value
    .replace(/_/g, "")
    .split(/(?<=[a-z])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function usernameSpacedVariant(username: string): string | null {
  const parts = splitCamelCase(username.replace(/_/g, "")).filter(
    (p) => p.length >= 2 && !GENERIC_ALIAS_BLOCKLIST.has(p.toLowerCase()),
  );
  if (parts.length < 2) return null;
  return parts.join(" ").toLowerCase();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when free text likely names the bot (not only @username). */
export function messageReferencesBotByName(
  text: string,
  bot: BotIdentity = getBotIdentity(),
): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;

  for (const alias of bot.aliases) {
    if (alias.length < 3 || GENERIC_ALIAS_BLOCKLIST.has(alias)) continue;

    const re = new RegExp(`(?:^|[^\\w@])${escapeRegex(alias)}(?:[^\\w]|$)`, "i");
    if (re.test(trimmed)) return true;
  }

  return false;
}

/** Remove @username and spoken name aliases from the user prompt. */
export function stripBotAddressing(
  text: string,
  bot: BotIdentity = getBotIdentity(),
): string {
  let out = text.trim();
  if (!out) return out;

  if (bot.username) {
    const escaped = bot.username.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(`@${escaped}\\s*`, "gi"), " ");
  }

  for (const alias of bot.aliases) {
    if (alias.length < 3) continue;
    const re = new RegExp(
      `(?:^|[^\\w@])${escapeRegex(alias)}(?:[^\\w]|$)`,
      "gi",
    );
    out = out.replace(re, " ");
  }

  return out.replace(/\s{2,}/g, " ").trim();
}
