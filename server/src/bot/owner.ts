import type { Context } from "grammy";
import { getSettings } from "../db/database.js";
import { resolveUserId } from "./conversation.js";

export function getOwnerUserId(): string | null {
  const id = getSettings().ownerUserId.trim();
  return id.length > 0 ? id : null;
}

export function getOwnerUsername(): string | null {
  const username = getSettings().ownerUsername.trim();
  return username.length > 0 ? username : null;
}

export function isOwnerUserId(userId: string | null | undefined): boolean {
  if (!userId) return false;
  const owner = getOwnerUserId();
  return owner !== null && userId === owner;
}

export function isOwnerUsername(username: string | null | undefined): boolean {
  if (!username) return false;
  const owner = getOwnerUsername();
  return owner !== null && username.toLowerCase() === owner;
}

export function isOwner(ctx: Context): boolean {
  if (isOwnerUserId(resolveUserId(ctx))) return true;
  return isOwnerUsername(ctx.from?.username);
}
