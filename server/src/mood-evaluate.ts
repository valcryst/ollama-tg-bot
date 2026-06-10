import { chatComplete } from "./llm/client.js";
import type { ChatMessage } from "./llm/client.js";
import { logEvent, logEventError } from "./event-log.js";
import {
  MOOD_KEYS,
  MOOD_TRAIT_HINTS,
  normalizeMoodValues,
  type MoodValues,
} from "./mood.js";

const MOOD_EVAL_NUM_PREDICT = 192;

const MOOD_BLOCK = /\[MOOD\]\s*([\s\S]*?)\s*\[\/MOOD\]/i;

const MOOD_EVALUATOR_SYSTEM = `You evaluate the bot character's emotional mood for the next reply in a Telegram chat.

Output ONLY:

[MOOD]
irritated: 0
exhausted: 0
amused: 0
curious: 0
contemptuous: 0
gloomy: 0
impatient: 0
pleased: 0
suspicious: 0
[/MOOD]

Each trait is an integer 0–5. Start from the "Current mood" values and adjust based on the latest conversation context.

Trait meanings:
- irritated — sharper, shorter, more hostile
- exhausted — dry, slower, less aggressive
- amused — more playful sarcasm
- curious — asks sharper questions, less mocking
- contemptuous — brutal toward bad ideas
- gloomy — poetic, darker, quieter
- impatient — skips ceremony, gives direct commands
- pleased — rare approval, still not warm
- suspicious — challenges assumptions

Rules:
- Change only traits the context actually warrants; small shifts (±1–2) are normal.
- Do not set everything high at once — pick what fits the moment.
- Output all nine traits every time.`;

export interface MoodEvaluateInput {
  currentMood: MoodValues;
  historyText: string;
  latestTurn: string;
}

function formatCurrentMood(mood: MoodValues): string {
  return MOOD_KEYS.map((key) => `${key}: ${mood[key]}`).join("\n");
}

function parseMoodBlock(raw: string, fallback: MoodValues): MoodValues {
  const match = raw.match(MOOD_BLOCK);
  const body = match?.[1] ?? raw;
  const partial: Partial<Record<string, number>> = {};

  for (const key of MOOD_KEYS) {
    const lineMatch = body.match(
      new RegExp(`^\\s*${key}\\s*[:=]\\s*(\\d+)`, "im"),
    );
    if (lineMatch) {
      partial[key] = Number.parseInt(lineMatch[1], 10);
    }
  }

  if (Object.keys(partial).length === 0) {
    return fallback;
  }

  return normalizeMoodValues(partial, fallback);
}

export async function evaluateMood(
  input: MoodEvaluateInput,
): Promise<MoodValues> {
  const fallback = normalizeMoodValues(input.currentMood);

  const traitGuide = MOOD_KEYS.map(
    (key) => `- ${key}: ${MOOD_TRAIT_HINTS[key]}`,
  ).join("\n");

  const userContent =
    `Current mood (starting point):\n${formatCurrentMood(fallback)}\n\n` +
    `Trait guide:\n${traitGuide}\n\n` +
    `---\nRecent chat:\n${input.historyText.trim() || "(no prior messages)"}\n\n` +
    `Latest turn:\n${input.latestTurn.trim() || "(empty)"}`;

  const messages: ChatMessage[] = [
    { role: "system", content: MOOD_EVALUATOR_SYSTEM },
    { role: "user", content: userContent },
  ];

  try {
    const raw = await chatComplete(messages, {
      numPredict: MOOD_EVAL_NUM_PREDICT,
      auxiliary: true,
      verboseLabel: "mood evaluate",
    });
    const evaluated = parseMoodBlock(raw, fallback);
    logEvent("mood_evaluated", {
      moodSummary: JSON.stringify(evaluated),
    });
    return evaluated;
  } catch (err) {
    logEventError("mood_evaluate_failed", err);
    return fallback;
  }
}
