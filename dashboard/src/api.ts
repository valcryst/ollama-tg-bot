export interface DerivedHistoryLimits {
  historyMaxMessages: number;
  historyMaxChars: number;
  historyMaxReplyChars: number;
  numPredict: number;
}

export interface Settings {
  apiBaseUrl: string;
  model: string;
  activePersonalityId: number;
  baseSystemPrompt?: string;
  randomReplyEnabled: boolean;
  randomReplyChance: number;
  reactToEveryImage: boolean;
  numPredict: number;
  numCtx: number;
  temperature: number;
  topP: number;
  topK: number;
  repeatPenalty: number;
  chatTimeoutSec: number;
  visionMaxDimension: number;
  derivedHistoryLimits?: DerivedHistoryLimits;
  ownerUsername: string;
  ownerUserId: string;
  stickersEnabled: boolean;
  stickerPackName: string;
  stickerReplyChance: number;
  moodCooldownMinutes?: number;
  thinkingEnabled: boolean;
  sendThinkingEnabled: boolean;
  maintenanceModeEnabled: boolean;
  ircTrainingMode: boolean;
  ircServer: string;
  ircChannels: string;
  ircNick: string;
  contextBudget?: ContextBudget;
  vramAvailableGb: number;
}

export interface ContextBudget {
  effectiveNumCtx: number;
  vramGb: number;
  modelName: string;
  modelWeightGb: number | null;
  modelMaxCtx: number | null;
  vramTierCtx: number;
  limitedBy:
    | "vram_tier"
    | "kv_headroom"
    | "model_max"
    | "generation_floor"
    | "min_floor";
  notes: string[];
}

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

export interface MoodState {
  values: MoodValues;
  updatedAt: string;
  effectiveValues: MoodValues;
}

export interface MoodPayload {
  defaults: MoodValues;
  activePersonalityId: number;
  activePersonalityName: string | null;
  cooldownMinutes: number;
  traitHints: Record<MoodKey, string>;
  current: MoodState | null;
}

export type MemoryScope = "user" | "group" | "general";

export interface DashboardDebugEvent {
  chatId: string;
  traceId: number;
  listItem: MessageReportListItem | null;
  trace: MessageReportDetail | null;
}

export interface DashboardDataEvent {
  tableIds?: string[];
}

export type PhaseStatus = "skipped" | "ok" | "failed";

export interface ReportDetailFields {
  type: "fields";
  fields: Array<{ label: string; value: string }>;
}

export interface ReportDetailText {
  type: "text";
  title: string;
  body: string;
}

export interface ReportDetailLlm {
  type: "llm";
  model: string;
  sampling?: string;
  sections: Array<{ title: string; body: string }>;
  output: {
    content: string;
    reasoning?: string;
    meta?: string;
  };
}

export interface ReportDetailMood {
  type: "mood";
  traits: Record<string, number>;
}

export type ReportDetail =
  | ReportDetailFields
  | ReportDetailText
  | ReportDetailLlm
  | ReportDetailMood;

export interface ReportPhase {
  id: string;
  title: string;
  status: PhaseStatus;
  durationMs?: number;
  summary: string;
  detail?: ReportDetail;
}

export interface MessageReportRecord {
  status: "ignored" | "processing" | "processed" | "error";
  headline: string;
  durationMs: number;
  intake: {
    messagePreview: string;
    hasMedia: boolean;
    mediaKind?: string;
  };
  routing:
    | {
        decision: "ignored";
        ignoreReason: string;
        ignoreLabel: string;
        addressSource?: string;
      }
    | {
        decision: "accepted";
        trigger: "addressed" | "random" | "image";
        triggerLabel: string;
        addressSource?: string;
      };
  phases: ReportPhase[];
  result: {
    replyChars?: number;
    chunks?: number;
    sticker?: string;
    thinkingSent?: boolean;
    memory?: {
      status: "pending" | "done" | "failed";
      updated: boolean;
      scopes?: string[];
      error?: string;
    };
    error?: string;
  };
}

export interface DebugChatSummary {
  chatId: string;
  chatType: string;
  label: string;
  traceCount: number;
  latestAt: string | null;
}

export interface MessageReportListItem {
  id: number;
  chatId: string;
  userId: string | null;
  userLabel: string | null;
  messagePreview: string;
  status: "ignored" | "processing" | "processed" | "error";
  headline: string;
  badges: string[];
  durationMs: number | null;
  createdAt: string;
}

export interface MessageReportDetail {
  id: number;
  chatId: string;
  convKey: string;
  userId: string | null;
  chatType: string;
  messageId: number | null;
  messagePreview: string;
  status: "ignored" | "processing" | "processed" | "error";
  durationMs: number | null;
  createdAt: string;
  report: MessageReportRecord;
}

export interface BotErrorRecord {
  id: number;
  message: string;
  chatId: string | null;
  userId: string | null;
  createdAt: string;
}

export interface Stats {
  messagesReceived: number;
  messagesReplied: number;
  visionRequests: number;
  errors: number;
  lastActivityAt: string | null;
  botUsername: string | null;
  botRunning: boolean;
  uptimeSeconds: number;
  startedAt: string;
  recentErrors: BotErrorRecord[];
}

export interface UserMemoryFact {
  id: number;
  userId: string;
  fact: string;
  createdAt: string;
}

export interface GroupMemoryFact {
  id: number;
  groupId: string;
  fact: string;
  createdAt: string;
}

export interface Personality {
  id: number;
  name: string;
  prompt: string;
  moodDefaults: MoodValues;
  createdAt: string;
  updatedAt: string;
}

export interface PersonalitiesPayload {
  personalities: Personality[];
  activePersonalityId: number;
}

export interface GeneralMemoryFact {
  id: number;
  fact: string;
  createdAt: string;
}

export interface DataTableSummary {
  id: string;
  label: string;
  count: number;
}

export interface DataTablePayload {
  id: string;
  label: string;
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
  truncated: boolean;
}

export interface StickerCatalogEntry {
  index: number;
  emoji: string;
}

export interface StickerCatalog {
  enabled: boolean;
  packName: string;
  stickers: StickerCatalogEntry[];
  loaded: boolean;
  error: string | null;
}

export interface LlmModel {
  name: string;
  size?: number;
  modelMaxCtx?: number;
  details?: {
    parameter_size?: string;
    family?: string;
    quantization_level?: string;
  };
}

export type ApiErrorKind = "network" | "server" | "client" | "parse";

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly path: string;
  readonly status?: number;
  readonly hint?: string;

  constructor(opts: {
    kind: ApiErrorKind;
    path: string;
    message: string;
    status?: number;
    hint?: string;
  }) {
    super(opts.message);
    this.name = "ApiError";
    this.kind = opts.kind;
    this.path = opts.path;
    this.status = opts.status;
    this.hint = opts.hint;
  }
}

export function isApiError(err: unknown): err is ApiError {
  return err instanceof ApiError;
}

export function describeApiError(err: unknown): {
  title: string;
  message: string;
  hint?: string;
} {
  if (!isApiError(err)) {
    return {
      title: "Unexpected error",
      message: err instanceof Error ? err.message : "Something went wrong",
    };
  }

  const titles: Record<ApiErrorKind, string> = {
    network: "Cannot reach the API",
    server: "Server error",
    client: "Request rejected",
    parse: "Invalid server response",
  };

  return {
    title: titles[err.kind],
    message: err.message,
    hint: err.hint,
  };
}

function hintForPath(path: string, status: number): string | undefined {
  if (path === "/api/health" || path.startsWith("/api/settings") || path === "/api/stats") {
    if (status >= 500) {
      return "Check the server terminal and .env — common causes are missing BOT_TOKEN or VRAM_AVAILABLE. In dev: npm run dev -w server (port 3000).";
    }
    if (status === 404) {
      return "API route not found — is the server running on :3000? Vite proxies /api in dev.";
    }
  }
  if (path === "/api/tavily/status") {
    return undefined;
  }
  if (path === "/api/models" || path === "/api/llm/health") {
    if (status === 502) {
      return "Could not reach the LLM. Open Settings and verify the OpenAI-compatible API base URL.";
    }
  }
  return undefined;
}

async function parseErrorBody(
  res: Response,
): Promise<{ error?: string; message?: string }> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as { error?: string; message?: string };
  } catch {
    return { message: text.slice(0, 200) };
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;

  try {
    res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...init,
    });
  } catch {
    throw new ApiError({
      kind: "network",
      path,
      message: "Could not connect to the API",
      hint:
        "The server may not be running, or it exited on startup — check the server terminal for errors (often missing BOT_TOKEN or VRAM_AVAILABLE in .env). In dev: npm run dev or npm run dev -w server (listens on :3000; Vite proxies /api).",
    });
  }

  if (!res.ok) {
    const body = await parseErrorBody(res);
    const serverMessage = body.error ?? body.message;
    const kind: ApiErrorKind =
      res.status >= 500 ? "server" : res.status >= 400 ? "client" : "server";

    throw new ApiError({
      kind,
      path,
      status: res.status,
      message:
        serverMessage ??
        (res.status === 500
          ? "Internal server error — see the server terminal for details"
          : `Request failed (${res.status} ${res.statusText})`),
      hint: hintForPath(path, res.status),
    });
  }

  try {
    return (await res.json()) as T;
  } catch {
    throw new ApiError({
      kind: "parse",
      path,
      status: res.status,
      message: "The API returned a response that is not valid JSON",
      hint: "The server may be misconfigured or returning an HTML error page.",
    });
  }
}

function withHostQuery(path: string, host?: string): string {
  if (!host?.trim()) return path;
  return `${path}?host=${encodeURIComponent(host.trim())}`;
}

export const api = {
  checkHealth: () => request<{ ok: boolean }>("/api/health"),
  getSettings: () => request<Settings>("/api/settings"),
  updateSettings: (patch: Partial<Settings>) =>
    request<Settings>("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  getModels: (host?: string) =>
    request<{ models: LlmModel[] }>(withHostQuery("/api/models", host)).then(
      (r) => r.models,
    ),
  getBudget: (model: string, numPredict: number) =>
    request<{
      contextBudget: ContextBudget;
      derivedHistoryLimits: DerivedHistoryLimits;
    }>(
      `/api/budget?model=${encodeURIComponent(model)}&numPredict=${numPredict}`,
    ),
  getStats: () => request<Stats>("/api/stats"),
  clearErrors: () =>
    request<{ ok: boolean; deleted: number }>("/api/errors", {
      method: "DELETE",
    }),
  getMemories: () =>
    request<{ facts: UserMemoryFact[]; total: number }>("/api/memories"),
  createMemory: (userId: string, fact: string) =>
    request<{ fact: UserMemoryFact }>("/api/memories", {
      method: "POST",
      body: JSON.stringify({ userId, fact }),
    }),
  updateMemory: (id: number, fact: string) =>
    request<{ fact: UserMemoryFact }>(`/api/memories/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ fact }),
    }),
  deleteMemory: (id: number) =>
    request<{ ok: boolean }>(`/api/memories/${id}`, { method: "DELETE" }),
  clearUserMemories: (userId: string) =>
    request<{ ok: boolean; deleted: number }>(
      `/api/memories/user/${encodeURIComponent(userId)}`,
      { method: "DELETE" },
    ),
  getGroupMemories: () =>
    request<{ facts: GroupMemoryFact[]; total: number }>("/api/group-memories"),
  createGroupMemory: (groupId: string, fact: string) =>
    request<{ fact: GroupMemoryFact }>("/api/group-memories", {
      method: "POST",
      body: JSON.stringify({ groupId, fact }),
    }),
  updateGroupMemory: (id: number, fact: string) =>
    request<{ fact: GroupMemoryFact }>(`/api/group-memories/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ fact }),
    }),
  deleteGroupMemory: (id: number) =>
    request<{ ok: boolean }>(`/api/group-memories/${id}`, { method: "DELETE" }),
  clearGroupMemories: (groupId: string) =>
    request<{ ok: boolean; deleted: number }>(
      `/api/group-memories/group/${encodeURIComponent(groupId)}`,
      { method: "DELETE" },
    ),
  getGeneralMemories: () =>
    request<{ facts: GeneralMemoryFact[]; total: number }>(
      "/api/general-memories",
    ),
  createGeneralMemory: (fact: string) =>
    request<{ fact: GeneralMemoryFact }>("/api/general-memories", {
      method: "POST",
      body: JSON.stringify({ fact }),
    }),
  updateGeneralMemory: (id: number, fact: string) =>
    request<{ fact: GeneralMemoryFact }>(`/api/general-memories/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ fact }),
    }),
  deleteGeneralMemory: (id: number) =>
    request<{ ok: boolean }>(`/api/general-memories/${id}`, {
      method: "DELETE",
    }),
  clearGeneralMemories: () =>
    request<{ ok: boolean; deleted: number }>("/api/general-memories", {
      method: "DELETE",
    }),
  llmHealth: (host?: string) =>
    request<{ ok: boolean }>(withHostQuery("/api/llm/health", host)).then(
      (r) => r.ok,
    ),
  tavilyStatus: () =>
    request<{ configured: boolean; ok: boolean }>("/api/tavily/status"),
  getPersonalities: () => request<PersonalitiesPayload>("/api/personalities"),
  createPersonality: (
    name: string,
    prompt: string,
    moodDefaults?: MoodValues,
  ) =>
    request<{ personality: Personality }>("/api/personalities", {
      method: "POST",
      body: JSON.stringify({ name, prompt, moodDefaults }),
    }),
  updatePersonality: (
    id: number,
    patch: { name?: string; prompt?: string; moodDefaults?: MoodValues },
  ) =>
    request<{ personality: Personality }>(`/api/personalities/${id}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  deletePersonality: (id: number) =>
    request<{ ok: boolean; activePersonalityId: number }>(
      `/api/personalities/${id}`,
      { method: "DELETE" },
    ),
  getStickers: () => request<StickerCatalog>("/api/stickers"),
  refreshStickers: () =>
    request<StickerCatalog>("/api/stickers/refresh", { method: "POST" }),
  stickerPreviewUrl: (index: number) =>
    `/api/stickers/${index}/preview`,
  getDataTables: () =>
    request<{ tables: DataTableSummary[] }>("/api/data"),
  getDataTable: (tableId: string) =>
    request<DataTablePayload>(
      `/api/data/${encodeURIComponent(tableId)}`,
    ),
  getMood: () => request<MoodPayload>("/api/mood"),
  updateMood: (patch: {
    cooldownMinutes?: number;
    current?: MoodValues;
  }) =>
    request<MoodPayload>("/api/mood", {
      method: "PATCH",
      body: JSON.stringify(patch),
    }),
  refreshMood: () =>
    request<MoodPayload>("/api/mood/refresh", { method: "POST" }),
  resetMood: () =>
    request<MoodPayload & { ok: boolean; deleted: boolean }>(
      "/api/mood/current",
      { method: "DELETE" },
    ),
  getDebugChats: () =>
    request<{ chats: DebugChatSummary[] }>("/api/debug/chats"),
  getDebugTraces: (chatId: string) =>
    request<{ traces: MessageReportListItem[] }>(
      `/api/debug/traces?chatId=${encodeURIComponent(chatId)}`,
    ),
  getDebugTrace: (id: number) =>
    request<{ trace: MessageReportDetail }>(`/api/debug/traces/${id}`),
};
