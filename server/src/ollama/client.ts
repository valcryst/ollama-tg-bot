import { extractModelMaxCtx } from "../context-budget.js";
import { getSettings } from "../db/database.js";
import { getResolvedSettings } from "../settings-runtime.js";
import { normalizeImageForOllama } from "./images.js";
import { logOllamaExchange } from "./verbose-log.js";
import { extractTelegramReply } from "../response-format.js";
import {
  getChatTimeoutMs,
  getEffectiveNumPredict,
  getOllamaChatOptions,
  getOllamaRequestTimeoutMs,
  getReplyNumPredict,
  LENGTH_RETRY_MIN_PREDICT,
  AUXILIARY_TEMPERATURE,
  maxNumPredictForContext,
} from "../settings-limits.js";
export interface OllamaModel {
  name: string;
  modified_at?: string;
  size?: number;
  modelMaxCtx?: number;
  details?: {
    family?: string;
    parameter_size?: string;
    quantization_level?: string;
  };
}

export interface ModelShowResult {
  modelMaxCtx: number | null;
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
  response?: string;
  content?: string;
  choices?: OpenAiChatResponse["choices"];
  usage?: OpenAiChatResponse["usage"];
  done_reason?: string;
  eval_count?: number;
}

interface OpenAiModel {
  id?: string;
  name?: string;
  object?: string;
  created?: number;
}

interface OpenAiChatResponse {
  choices?: {
    delta?: {
      role?: string;
      content?: string | null;
      reasoning?: string | null;
    };
    finish_reason?: string;
    text?: string | null;
    message?: {
      role?: string;
      content?: string | OpenAiContentPart[] | null;
      reasoning?: string | null;
      reasoning_content?: string | null;
    };
  }[];
  usage?: {
    completion_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}

interface OpenAiContentPart {
  type?: string;
  text?: string;
}

function pickAssistantContent(data: OllamaChatResponse): string {
  return (
    data.message?.content?.trim() ||
    data.response?.trim() ||
    data.content?.trim() ||
    openAiChoiceText(data.choices?.[0]) ||
    ""
  );
}

function emptyResponseError(
  model: string,
  data: OllamaChatResponse,
  numPredict: number,
): Error {
  const reason = data.done_reason ?? "unknown";
  const evalCount = data.eval_count ?? 0;
  const hadThinking = Boolean(data.message?.thinking?.trim());

  const settings = getSettings();
  let hint =
    "Try /reset to shorten context, pick a different model, or raise generation tokens in Settings.";
  if (reason === "length") {
    if (settings.thinkingEnabled) {
      const replyBudget = getReplyNumPredict(settings);
      hint =
        `Generation used all ${numPredict} tokens (num_predict) before a usable [REPLY]. ` +
        `Thinking and reply share one Ollama budget — the model may have spent it on reasoning ` +
        `(reply slice ~${replyBudget} tokens). Raise total generation tokens, lower thinking, or send /reset.`;
    } else {
      hint = `Generation used all ${numPredict} tokens (num_predict) before a usable [REPLY]. Raise generation tokens in Settings (try 512+) or send /reset.`;
    }
  } else if (hadThinking) {
    hint =
      "This model returned thinking output but no final answer. Restart the server and retry, or switch models.";
  }

  const fields = Object.keys(data).sort().join(", ") || "none";
  return new Error(
    `Ollama returned an empty response (model: ${model}, done_reason: ${reason}, tokens: ${evalCount}, fields: ${fields}). ${hint}`,
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
  const host = resolveBaseUrl(hostOverride);
  let ollamaRes: Response | null = null;
  let ollamaError = "";
  try {
    ollamaRes = await fetch(`${host}/api/tags`, {
      signal: AbortSignal.timeout(LIST_MODELS_TIMEOUT_MS),
    });
    if (ollamaRes.ok) {
      const data = (await ollamaRes.json()) as { models?: TagsModel[] };
      return normalizeOllamaModels(data.models ?? []);
    }
    ollamaError = `${ollamaRes.status}: ${await ollamaRes.text()}`;
  } catch (err) {
    ollamaError = err instanceof Error ? err.message : String(err);
  }

  const openai = await fetch(`${host}/v1/models`, {
    signal: AbortSignal.timeout(LIST_MODELS_TIMEOUT_MS),
  });
  if (!openai.ok) {
    throw new Error(
      `Model listing failed. Ollama /api/tags returned ${ollamaError}; OpenAI /v1/models returned ${openai.status}: ${await openai.text()}`,
    );
  }

  const data = (await openai.json()) as { data?: OpenAiModel[] };
  return normalizeOpenAiModels(data.data ?? []);
}

function normalizeOllamaModels(models: TagsModel[]): OllamaModel[] {
  const seen = new Set<string>();

  return models
    .map((entry) => {
      const name = (entry.name ?? entry.model ?? "").trim();
      if (!name || seen.has(name)) return null;
      seen.add(name);
      return { ...entry, name };
    })
    .filter((m): m is OllamaModel => m !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function normalizeOpenAiModels(models: OpenAiModel[]): OllamaModel[] {
  const seen = new Set<string>();
  return models
    .map((entry) => {
      const name = (entry.id ?? entry.name ?? "").trim();
      if (!name || seen.has(name)) return null;
      seen.add(name);
      return { name };
    })
    .filter((m): m is OllamaModel => m !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function showModel(
  name: string,
  hostOverride?: string,
): Promise<ModelShowResult> {
  const res = await fetch(`${resolveBaseUrl(hostOverride)}/api/show`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(LIST_MODELS_TIMEOUT_MS),
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    throw new Error(`Ollama show failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { model_info?: Record<string, unknown> };
  return {
    modelMaxCtx: data.model_info
      ? extractModelMaxCtx(data.model_info)
      : null,
  };
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
  const settings = getResolvedSettings();
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
    if (looksLikeOpenAiCompatibleError(body)) {
      return requestOpenAiChat(
        model,
        prepared,
        numPredict,
        auxiliary,
        verboseLabel,
        verboseLayout,
      );
    }
    if (res.status === 400 && /image|audio file/i.test(body)) {
      throw new Error(
        `Ollama rejected the image (is "${model}" a vision model?). ${body}`,
      );
    }
    throw new Error(`Ollama chat failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as OllamaChatResponse;
  if (shouldRetryOpenAiAfterEmpty(data)) {
    return requestOpenAiChat(
      model,
      prepared,
      numPredict,
      auxiliary,
      verboseLabel,
      verboseLayout,
    );
  }
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

function shouldRetryOpenAiAfterEmpty(data: OllamaChatResponse): boolean {
  return (
    !pickAssistantContent(data) &&
    data.done_reason === "stop" &&
    (data.eval_count ?? 0) > 0
  );
}

async function requestOpenAiChat(
  model: string,
  prepared: ChatMessage[],
  numPredict: number,
  auxiliary: boolean,
  verboseLabel?: string,
  verboseLayout?: VerbosePromptLayout,
): Promise<OllamaChatResponse> {
  const candidates = model.endsWith(":latest")
    ? [model, model.slice(0, -":latest".length)]
    : [model];
  let lastError = "";

  for (const candidate of candidates) {
    const res = await fetch(`${baseUrl()}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(
        getOllamaRequestTimeoutMs(getResolvedSettings(), { auxiliary }),
      ),
      body: JSON.stringify(openAiChatBody(candidate, prepared, numPredict, auxiliary)),
    });

    if (!res.ok) {
      lastError = await res.text().catch(() => "");
      if (res.status === 404 && candidate !== candidates[candidates.length - 1]) {
        continue;
      }
      throw new Error(`LocalAI chat failed (${res.status}): ${lastError}`);
    }

    const data = openAiToOllamaResponse((await res.json()) as OpenAiChatResponse);
    if (verboseLabel) {
      logOllamaExchange(
        verboseLabel,
        candidate,
        numPredict,
        prepared,
        data,
        verboseLayout,
      );
    }
    return data;
  }

  throw new Error(`LocalAI chat failed: ${lastError || "model not found"}`);
}

function openAiChatBody(
  model: string,
  messages: ChatMessage[],
  numPredict: number,
  auxiliary: boolean,
) {
  const settings = getResolvedSettings();
  return {
    model,
    messages: messages.map(openAiMessage),
    stream: false,
    max_tokens: numPredict,
    temperature: auxiliary ? AUXILIARY_TEMPERATURE : settings.temperature,
    top_p: settings.topP,
  };
}

function openAiMessage(msg: ChatMessage) {
  if (!msg.images?.length) {
    return { role: msg.role, content: msg.content };
  }
  return {
    role: msg.role,
    content: [
      { type: "text", text: msg.content },
      ...msg.images.map((image) => ({
        type: "image_url",
        image_url: { url: `data:image/jpeg;base64,${image}` },
      })),
    ],
  };
}

function openAiToOllamaResponse(data: OpenAiChatResponse): OllamaChatResponse {
  const choice = data.choices?.[0];
  return {
    message: {
      role: choice?.message?.role ?? choice?.delta?.role,
      content: openAiChoiceText(choice),
    },
    done_reason: choice?.finish_reason,
    eval_count:
      data.usage?.completion_tokens ??
      data.usage?.output_tokens ??
      data.usage?.total_tokens,
  };
}

function openAiChoiceText(
  choice: OpenAiChatResponse["choices"] extends (infer T)[] | undefined
    ? T | undefined
    : never,
): string {
  return (
    openAiTextContent(choice?.message?.content) ||
    choice?.message?.reasoning?.trim() ||
    choice?.text?.trim() ||
    choice?.delta?.content?.trim() ||
    choice?.delta?.reasoning?.trim() ||
    choice?.message?.reasoning_content?.trim() ||
    ""
  );
}

function openAiTextContent(
  content: string | OpenAiContentPart[] | null | undefined,
): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => part.text?.trim() ?? "")
    .filter(Boolean)
    .join("\n");
}

function looksLikeOpenAiCompatibleError(body: string): boolean {
  return /"type"\s*:\s*"invalid_request_error"|\/v1\/models|chat.completions|LocalAI/i.test(
    body,
  );
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
  const settings = getResolvedSettings();
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

      const predictCap = maxNumPredictForContext(settings.numCtx);
      const canRetry =
        attempt === 0 &&
        lastData.done_reason === "length" &&
        numPredict < predictCap &&
        options?.numPredict == null;

      if (!canRetry) break;

      numPredict = Math.min(
        predictCap,
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
    const host = resolveBaseUrl(hostOverride);
    const res = await fetch(`${host}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) return true;
    const openai = await fetch(`${host}/v1/models`, {
      signal: AbortSignal.timeout(5000),
    });
    return openai.ok;
  } catch {
    return false;
  }
}
