import type { User } from "@grammyjs/types";
import { getSettings, updateSettings } from "../db/database.js";
import { normalizeTelegramUsername } from "./resolve-owner.js";

/** Persist owner user id once the configured @username messages the bot. */
export function tryResolveOwnerFromUser(user: User | undefined): void {
  if (!user?.id || !user.username) return;

  const settings = getSettings();
  const configured = normalizeTelegramUsername(settings.ownerUsername);
  if (!configured || settings.ownerUserId.trim()) return;

  if (user.username.toLowerCase() !== configured) return;

  updateSettings({ ownerUserId: String(user.id) });
}
