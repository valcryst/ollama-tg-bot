export type EventFields = Record<
  string,
  string | number | boolean | null | undefined
>;

function formatValue(value: string | number | boolean): string {
  if (typeof value === "string") {
    if (/[\s"=]/.test(value)) return JSON.stringify(value);
    return value;
  }
  return String(value);
}

/** Structured lifecycle log — events only, no message content or DB payloads. */
export function logEvent(event: string, fields: EventFields = {}): void {
  const parts = [`event=${event}`];
  for (const [key, value] of Object.entries(fields)) {
    if (value == null || value === "") continue;
    parts.push(`${key}=${formatValue(value)}`);
  }
  console.log(`[bot] ${parts.join(" ")}`);
}

export function logEventError(
  event: string,
  err: unknown,
  fields: EventFields = {},
): void {
  const message = err instanceof Error ? err.message : String(err);
  logEvent(event, { ...fields, error: message });
  if (err instanceof Error && err.stack) {
    console.error(err.stack);
  }
}
