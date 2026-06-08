import { tickMoodCooldown } from "./db/mood.js";
import { logEvent, logEventError } from "./event-log.js";
import { logInfo } from "./logging.js";

const MOOD_COOLDOWN_TICK_MS = 60_000;

let timer: ReturnType<typeof setInterval> | null = null;

function runTick(): void {
  try {
    const changed = tickMoodCooldown();
    if (changed) {
      logEvent("mood_cooldown_tick", { changed: true });
    }
  } catch (err) {
    logEventError("mood_cooldown_tick_failed", err);
  }
}

export function startMoodCooldownWorker(): void {
  if (timer) return;
  runTick();
  timer = setInterval(runTick, MOOD_COOLDOWN_TICK_MS);
  logInfo(`Mood cooldown worker started (every ${MOOD_COOLDOWN_TICK_MS / 1000}s)`);
}

export function stopMoodCooldownWorker(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
