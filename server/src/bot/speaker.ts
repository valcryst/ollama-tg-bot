import type { User } from "@grammyjs/types";

export interface CurrentSpeaker {
  userId: string;
  label: string;
}

export function formatSpeakerLabel(user: User): string {
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ");
  return user.username ? `${name} (@${user.username})` : name;
}

export function currentSpeakerFromUser(
  user: User | undefined,
): CurrentSpeaker | null {
  if (!user?.id) return null;
  return { userId: String(user.id), label: formatSpeakerLabel(user) };
}

