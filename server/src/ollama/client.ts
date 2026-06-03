import { getSettings } from "../db/database.js";
import { normalizeImageForOllama } from "./images.js";
import {
  getChatTimeoutMs,
  getOllamaChatOptions,
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

export async function chat(
  messages: ChatMessage[],
  options?: { model?: string },
): Promise<string> {
  const settings = getSettings();
  const model = options?.model ?? settings.model;
  const prepared = await prepareMessages(messages);

  try {
    const res = await fetch(`${baseUrl()}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(getChatTimeoutMs(settings)),
      body: JSON.stringify({
        model,
        messages: prepared,
        stream: false,
        keep_alive: OLLAMA_KEEP_ALIVE,
        options: getOllamaChatOptions(settings),
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

    const data = (await res.json()) as {
      message?: { content?: string };
    };
    const raw = data.message?.content?.trim() ?? "";
    const content = sanitizeModelOutput(raw);
    if (!content) {
      throw new Error("Ollama returned an empty response");
    }
    return content;
  } catch (err) {
    throw wrapChatError(err);
  }
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
