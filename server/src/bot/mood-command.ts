import { getSettings } from "../db/database.js";
import { getEffectiveMood, getMoodStateView, tickMoodCooldown } from "../db/mood.js";
import {
  getActivePersonalityMoodDefaults,
  getPersonalityById,
  resolveActivePersonalityId,
} from "../db/personalities.js";
import { MOOD_KEYS } from "../mood.js";

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatTraitLine(
  key: string,
  current: number,
  defaultValue: number,
): string {
  const marker = current !== defaultValue ? "•" : "·";
  return `${marker} <code>${key}</code>: ${current}/5 <i>(default ${defaultValue})</i>`;
}

export function buildMoodCommandReply(): string {
  tickMoodCooldown();

  const settings = getSettings();
  const defaults = getActivePersonalityMoodDefaults();
  const current = getEffectiveMood();
  const state = getMoodStateView();
  const activeId = resolveActivePersonalityId(settings.activePersonalityId);
  const activeName = activeId ? getPersonalityById(activeId)?.name : null;

  const lines = ["<b>Mood</b> (global)"];

  if (activeName) {
    lines.push(`Defaults from character: <b>${escapeHtml(activeName)}</b>`);
  } else {
    lines.push("Defaults: base values (no active character)");
  }

  lines.push("");
  for (const key of MOOD_KEYS) {
    lines.push(formatTraitLine(key, current[key], defaults[key]));
  }

  if (state?.updatedAt) {
    const when = new Date(state.updatedAt);
    const label = Number.isNaN(when.getTime())
      ? state.updatedAt
      : when.toLocaleString();
    lines.push(`\nLast interaction: ${escapeHtml(label)}`);
  } else {
    lines.push("\nNo mood recorded yet — defaults apply.");
  }

  lines.push(
    `Cooldown: ${settings.moodCooldownMinutes} min to full default drift`,
  );

  return lines.join("\n");
}
