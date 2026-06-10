import type { LlmModel } from "./api";

export interface ModelOption {
  value: string;
  label: string;
}

export function formatModelSize(bytes?: number): string {
  if (!bytes) return "";
  const gb = bytes / 1e9;
  return gb >= 1 ? `${gb.toFixed(1)} GB` : `${(bytes / 1e6).toFixed(0)} MB`;
}

export function buildModelOptions(models: LlmModel[]): ModelOption[] {
  return models.map((m) => {
    const size = formatModelSize(m.size);
    const family = m.details?.parameter_size;
    const suffix = [size, family].filter(Boolean).join(" · ");
    return {
      value: m.name,
      label: suffix ? `${m.name} (${suffix})` : m.name,
    };
  });
}

/** Pick a saved model name that exists in the pulled list (handles tag mismatches). */
export function resolveModelSelection(
  models: LlmModel[],
  current: string,
): string {
  if (models.length === 0) return current;
  if (models.some((m) => m.name === current)) return current;

  const base = current.split(":")[0];
  const match = models.find(
    (m) =>
      m.name === current ||
      m.name.startsWith(`${base}:`) ||
      m.name.split(":")[0] === base,
  );
  return match?.name ?? models[0].name;
}
