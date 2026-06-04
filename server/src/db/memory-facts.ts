export const MIN_FACT_LENGTH = 2;
export const MAX_FACT_LENGTH = 500;

export function normalizeFactText(fact: unknown): string | null {
  if (typeof fact !== "string") return null;
  const normalized = fact.trim();
  if (normalized.length < MIN_FACT_LENGTH || normalized.length > MAX_FACT_LENGTH) {
    return null;
  }
  return normalized;
}

export function normalizeEntityId(id: unknown): string | null {
  if (typeof id !== "string") return null;
  const trimmed = id.trim();
  return trimmed.length > 0 ? trimmed : null;
}
