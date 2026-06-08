export const MOOD_KEYS = [
  "irritated",
  "exhausted",
  "amused",
  "curious",
  "contemptuous",
  "gloomy",
  "impatient",
  "pleased",
  "suspicious",
] as const;

export type MoodKey = (typeof MOOD_KEYS)[number];
export type MoodValues = Record<MoodKey, number>;

export const MOOD_TRAIT_HINTS: Record<MoodKey, string> = {
  irritated: "sharper, shorter, more hostile",
  exhausted: "dry, slower, less aggressive",
  amused: "more playful sarcasm",
  curious: "asks sharper questions, less mocking",
  contemptuous: "brutal toward bad ideas",
  gloomy: "poetic, darker, quieter",
  impatient: "skips ceremony, gives direct commands",
  pleased: "rare approval, still not warm",
  suspicious: "challenges assumptions",
};

export const DEFAULT_MOOD_VALUES: MoodValues = {
  irritated: 1,
  exhausted: 0,
  amused: 1,
  curious: 2,
  contemptuous: 1,
  gloomy: 0,
  impatient: 1,
  pleased: 0,
  suspicious: 1,
};

export function moodValuesEqual(a: MoodValues, b: MoodValues): boolean {
  return MOOD_KEYS.every((key) => a[key] === b[key]);
}

export function clampMoodLevel(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(5, Math.max(0, Math.round(value)));
}

export function normalizeMoodValues(
  input: Partial<Record<string, unknown>> | null | undefined,
  fallback: MoodValues = DEFAULT_MOOD_VALUES,
): MoodValues {
  const result = { ...fallback };
  if (!input || typeof input !== "object") return result;
  for (const key of MOOD_KEYS) {
    const raw = input[key];
    if (typeof raw === "number") {
      result[key] = clampMoodLevel(raw);
    }
  }
  return result;
}

/** Drift stored mood toward defaults based on elapsed time since last interaction. */
export function applyMoodCooldown(
  stored: MoodValues,
  defaults: MoodValues,
  updatedAt: string | null,
  cooldownMinutes: number,
  nowMs = Date.now(),
): MoodValues {
  if (!updatedAt || cooldownMinutes <= 0) {
    return { ...stored };
  }

  const updatedMs = Date.parse(updatedAt);
  if (!Number.isFinite(updatedMs)) {
    return { ...stored };
  }

  const elapsed = Math.max(0, nowMs - updatedMs);
  const progress = Math.min(1, elapsed / (cooldownMinutes * 60_000));
  const result = {} as MoodValues;

  for (const key of MOOD_KEYS) {
    const current = stored[key];
    const target = defaults[key];
    result[key] = clampMoodLevel(current + (target - current) * progress);
  }

  return result;
}

export function formatMoodForPrompt(mood: MoodValues): string {
  const lines = MOOD_KEYS.map((key) => {
    const level = mood[key];
    const hint = MOOD_TRAIT_HINTS[key];
    return `- ${key}: ${level}/5 — ${hint}`;
  });
  return (
    `CRITICAL: Current mood is the primary driver of this reply. ` +
    `It is more important than your baseline character, personality instructions, and default tone. ` +
    `When mood and character traits conflict, follow mood — let these levels dictate hostility, warmth, ` +
    `pacing, sarcasm, curiosity, and attitude first.\n\n` +
    `Each trait is 0–5 (0 = off, 5 = strong). Higher traits must visibly shape word choice and behavior. ` +
    `Do not name mood labels in your reply.\n` +
    lines.join("\n")
  );
}
