export interface Settings {
  ollamaHost: string;
  model: string;
  customSystemPrompt: string;
  baseSystemPrompt?: string;
  randomReplyEnabled: boolean;
  randomReplyChance: number;
  reactToEveryImage: boolean;
  numPredict: number;
  numCtx: number;
  temperature: number;
  chatTimeoutSec: number;
  visionMaxDimension: number;
  derivedHistoryLimits?: {
    historyMaxMessages: number;
    historyMaxChars: number;
    historyMaxReplyChars: number;
  };
  ownerUsername: string;
  ownerUserId: string;
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

export interface GeneralMemoryFact {
  id: number;
  fact: string;
  createdAt: string;
}

export interface OllamaModel {
  name: string;
  size?: number;
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
      return "The backend may have crashed on startup (check the server terminal). In dev, run: npm run dev -w server";
    }
    if (status === 404) {
      return "API route not found — is the server running on :3000? Vite proxies /api in dev.";
    }
  }
  if (path === "/api/tavily/status") {
    return undefined;
  }
  if (path === "/api/models" || path === "/api/ollama/health") {
    if (status === 502) {
      return "Could not reach Ollama. Open Settings and verify the Ollama host URL, then ensure ollama serve is running.";
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
        "Start the backend: npm run dev -w server (or npm run dev). Vite proxies /api in dev.",
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
    request<{ models: OllamaModel[] }>(withHostQuery("/api/models", host)).then(
      (r) => r.models,
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
  ollamaHealth: (host?: string) =>
    request<{ ok: boolean }>(withHostQuery("/api/ollama/health", host)).then(
      (r) => r.ok,
    ),
  tavilyStatus: () =>
    request<{ configured: boolean; ok: boolean }>("/api/tavily/status"),
};
