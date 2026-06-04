import { getSettings } from "../db/database.js";
import { normalizeImageForOllama } from "./images.js";
import { parseStructuredResponse } from "../response-format.js";
import {
  getChatTimeoutMs,
  getOllamaChatOptions,
  LENGTH_RETRY_MIN_PREDICT,
} from "../settings-limits.js";
import { sanitizeModelOutput } from "./sanitize.js";

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
const MAX_NUM_PREDICT = 2048;

interface OllamaChatResponse {
  message?: {
    role?: string;
    content?: string;
    thinking?: string;
  };
  done_reason?: string;
  eval_count?: number;
}

function pickAssistantRaw(data: OllamaChatResponse): string {
  const content = data.message?.content?.trim() ?? "";
  const thinking = data.message?.thinking?.trim() ?? "";
  return content || thinking || "";
}

function extractReplyText(raw: string): string {
  if (!raw) return "";

  const parsed = parseStructuredResponse(raw);
  if (parsed.reply.trim()) return parsed.reply.trim();

  const sanitized = sanitizeModelOutput(raw);
  if (sanitized) return sanitized;

  return raw.trim();
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
  const res = await fetch(`${resolveBaseUrl(hostOverride)}/api/tags`);
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

async function requestChat(
  model: string,
  prepared: ChatMessage[],
  numPredict: number,
): Promise<OllamaChatResponse> {
  const settings = getSettings();
  const res = await fetch(`${baseUrl()}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(getChatTimeoutMs(settings)),
    body: JSON.stringify({
      model,
      messages: prepared,
      stream: false,
      think: false,
      keep_alive: OLLAMA_KEEP_ALIVE,
      options: getOllamaChatOptions(settings, { numPredict }),
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

  return (await res.json()) as OllamaChatResponse;
}

/** Full model output (includes [MEMORY] / [GROUP_MEMORY] blocks when present). */
export async function chatComplete(
  messages: ChatMessage[],
  options?: { model?: string; numPredict?: number },
): Promise<string> {
  const settings = getSettings();
  const model = options?.model ?? settings.model;
  const prepared = await prepareMessages(messages);
  const cap = options?.numPredict ?? settings.numPredict;

  try {
    let numPredict = cap;
    let lastData: OllamaChatResponse | null = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      lastData = await requestChat(model, prepared, numPredict);
      const raw = pickAssistantRaw(lastData);
      if (raw) return raw;

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
    throw wrapChatError(err);
  }
}

export async function chat(
  messages: ChatMessage[],
  options?: { model?: string },
): Promise<string> {
  const raw = await chatComplete(messages, options);
  const reply = extractReplyText(raw);
  if (!reply) {
    throw new Error("Model response had no [REPLY] content");
  }
  return reply;
}

function wrapChatError(err: unknown): Error {
  if (err instanceof Error && err.name === "TimeoutError") {
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
