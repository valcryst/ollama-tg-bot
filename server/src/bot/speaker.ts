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

/** Prefix the model's current turn so it knows who is speaking in a group. */
export function wrapCurrentTurnForGroup(
  content: string,
  speaker: CurrentSpeaker,
): string {
  return (
    `[CURRENT SPEAKER — you must reply ONLY to this person; ` +
    `do not treat other group members' history as if they wrote this message]\n` +
    `Name: ${speaker.label}\n` +
    `Telegram user id: ${speaker.userId}\n` +
    `---\n` +
    content.trim()
  );
}
