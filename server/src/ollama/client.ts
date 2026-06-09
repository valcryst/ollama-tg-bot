import { getSettings } from "../db/database.js";
import { normalizeImageForOllama } from "./images.js";
import { logOllamaExchange } from "./verbose-log.js";
import { extractTelegramReply } from "../response-format.js";
import {
  getChatTimeoutMs,
  getEffectiveNumPredict,
  getOllamaChatOptions,
  getOllamaRequestTimeoutMs,
  LENGTH_RETRY_MIN_PREDICT,
  MAX_NUM_PREDICT,
} from "../settings-limits.js";
export interface OllamaModel {
  name: string;
  modified_at?: string;
  size?: number;
  details?: {
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
  };
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  images?: string[];
}

/** Keep the model loaded in VRAM until Ollama restarts or the model is unloaded. */
const OLLAMA_KEEP_ALIVE = -1;
const LIST_MODELS_TIMEOUT_MS = 60_000;

interface OllamaChatResponse {
  message?: {
    role?: string;
    content?: string;
    thinking?: string;
  };
  done_reason?: string;
  eval_count?: number;
}

function pickAssistantContent(data: OllamaChatResponse): string {
  return data.message?.content?.trim() ?? "";
}

function emptyResponseError(
  model: string,
  data: OllamaChatResponse,
  numPredict: number,
): Error {
  const reason = data.done_reason ?? "unknown";
  const evalCount = data.eval_count ?? 0;
  const hadThinking = Boolean(data.message?.thinking?.trim());

  let hint =
    "Try /reset to shorten context, pick a different model, or raise max reply tokens in Settings.";
  if (reason === "length") {
    hint = `Generation used all ${numPredict} tokens (num_predict) before a usable [REPLY]. Raise max reply tokens in Settings (try 512+) or send /reset.`;
  } else if (hadThinking) {
    hint =
      "This model returned thinking output but no final answer. Restart the server and retry, or switch models.";
  }

  return new Error(
    `Ollama returned an empty response (model: ${model}, done_reason: ${reason}, tokens: ${evalCount}). ${hint}`,
  );
}

function resolveBaseUrl(hostOverride?: string): string {
  const host = (hostOverride ?? getSettings().ollamaHost).trim();
  if (!host) {
    throw new Error("Ollama host is not configured");
  }
  return host.replace(/\/$/, "");
}

function baseUrl(): string {
  return resolveBaseUrl();
}

type TagsModel = OllamaModel & { model?: string };

export async function listModels(hostOverride?: string): Promise<OllamaModel[]> {
  const res = await fetch(`${resolveBaseUrl(hostOverride)}/api/tags`, {
    signal: AbortSignal.timeout(LIST_MODELS_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Ollama returned ${res.status}: ${await res.text()}`);
  }
  const data = (await res.json()) as { models?: TagsModel[] };
  const seen = new Set<string>();

  return (data.models ?? [])
    .map((entry) => {
      const name = (entry.name ?? entry.model ?? "").trim();
      if (!name || seen.has(name)) return null;
      seen.add(name);
      return { ...entry, name };
    })
    .filter((m): m is OllamaModel => m !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function prepareMessages(
  messages: ChatMessage[],
): Promise<ChatMessage[]> {
  return Promise.all(
    messages.map(async (msg) => {
      if (!msg.images?.length) return msg;
      const images = await Promise.all(
        msg.images.map((b64) => normalizeImageForOllama(b64)),
      );
      return { ...msg, images };
    }),
  );
}

export interface VerbosePromptLayout {
  system: string;
  history: ChatMessage[];
  latest: string;
}

export interface ChatCompleteOptions {
  model?: string;
  numPredict?: number;
  /** Use low temperature for structured side passes (mood, memory, search, …). */
  auxiliary?: boolean;
  /**
   * Request Ollama thinking when settings.thinkingEnabled (main replies and
   * memory extract only).
   */
  think?: boolean;
  /** VERBOSE log section label, e.g. "web search decision". */
  verboseLabel?: string;
  /** VERBOSE: split main-reply prompt into system / history / latest sections. */
  verboseLayout?: VerbosePromptLayout;
}

async function requestChat(
  model: string,
  prepared: ChatMessage[],
  numPredict: number,
  auxiliary: boolean,
  think: boolean,
  verboseLabel?: string,
  verboseLayout?: VerbosePromptLayout,
): Promise<OllamaChatResponse> {
  const settings = getSettings();
  const res = await fetch(`${baseUrl()}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(
      getOllamaRequestTimeoutMs(settings, { auxiliary }),
    ),
    body: JSON.stringify({
      model,
      messages: prepared,
      stream: false,
      think,
      keep_alive: OLLAMA_KEEP_ALIVE,
      options: getOllamaChatOptions(settings, { numPredict, auxiliary }),
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 400 && /image|audio file/i.test(body)) {
      throw new Error(
        `Ollama rejected the image (is "${model}" a vision model?). ${body}`,
      );
    }
    throw new Error(`Ollama chat failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as OllamaChatResponse;
  if (verboseLabel) {
    logOllamaExchange(
      verboseLabel,
      model,
      numPredict,
      prepared,
      data,
      verboseLayout,
    );
  }
  return data;
}

export interface ChatCompleteResult {
  /** Ollama message.content (final answer; excludes the thinking field). */
  raw: string;
  /** Ollama chain-of-thought when thinking mode is on. */
  thinking: string;
}

/** Full model output (includes [MEMORY] / [GROUP_MEMORY] blocks when present). */
export async function chatCompleteDetailed(
  messages: ChatMessage[],
  options?: ChatCompleteOptions,
): Promise<ChatCompleteResult> {
  const settings = getSettings();
  const model = options?.model ?? settings.model;
  const prepared = await prepareMessages(messages);
  const verboseLabel = options?.verboseLabel;
  const verboseLayout = options?.verboseLayout;
  const auxiliary = options?.auxiliary ?? false;
  const think = Boolean(options?.think && settings.thinkingEnabled);

  try {
    let numPredict = getEffectiveNumPredict(settings, {
      baseNumPredict: options?.numPredict,
    });
    let lastData: OllamaChatResponse | null = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      const label =
        verboseLabel && attempt > 0
          ? `${verboseLabel} (retry ${attempt + 1})`
          : verboseLabel;
      lastData = await requestChat(
        model,
        prepared,
        numPredict,
        auxiliary,
        think,
        label,
        verboseLayout,
      );
      const raw = pickAssistantContent(lastData);
      if (raw) {
        return {
          raw,
          thinking: lastData.message?.thinking?.trim() ?? "",
        };
      }

      const canRetry =
        attempt === 0 &&
        lastData.done_reason === "length" &&
        numPredict < MAX_NUM_PREDICT &&
        options?.numPredict == null;

      if (!canRetry) break;

      numPredict = Math.min(
        MAX_NUM_PREDICT,
        Math.max(numPredict * 2, LENGTH_RETRY_MIN_PREDICT),
      );
    }

    throw emptyResponseError(model, lastData!, numPredict);
  } catch (err) {
    throw wrapChatError(err, auxiliary);
  }
}

export async function chatComplete(
  messages: ChatMessage[],
  options?: ChatCompleteOptions,
): Promise<string> {
  const { raw } = await chatCompleteDetailed(messages, options);
  return raw;
}

export async function chat(
  messages: ChatMessage[],
  options?: ChatCompleteOptions,
): Promise<string> {
  const settings = getSettings();
  const think = Boolean(options?.think && settings.thinkingEnabled);
  const raw = await chatComplete(messages, options);
  const reply = extractTelegramReply(raw, { thinkingMode: think });
  if (!reply) {
    throw new Error("Model response had no [REPLY] content");
  }
  return reply;
}

function wrapChatError(err: unknown, auxiliary = false): Error {
  if (err instanceof Error && err.name === "TimeoutError") {
    if (auxiliary) {
      return new Error(
        `Ollama auxiliary request timed out (${getSettings().chatTimeoutSec}s). The bot will skip that side pass and continue where possible.`,
      );
    }
    return new Error(
      `Ollama request timed out (${getSettings().chatTimeoutSec}s). Try a smaller model, fewer chat history (/reset), or lower timeout in dashboard.`,
    );
  }
  if (err instanceof Error) return err;
  return new Error(String(err));
}

export async function checkHealth(hostOverride?: string): Promise<boolean> {
  try {
    const res = await fetch(`${resolveBaseUrl(hostOverride)}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
