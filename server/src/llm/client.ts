import OpenAI, {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
} from "openai";
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionMessageParam,
} from "openai/resources/chat/completions";
import type { Model } from "openai/resources/models";
import { config } from "../config.js";
import { getSettings } from "../db/database.js";
import type { Settings } from "../db/database.js";
import {
  AUXILIARY_TEMPERATURE,
  getChatTimeoutMs,
  getEffectiveNumPredict,
} from "../settings-limits.js";
import { getResolvedSettings } from "../settings-runtime.js";
import { normalizeImageForChat } from "./images.js";
import {
  parseAssistantMessage,
  providerChatExtensions,
} from "./openai-compat.js";
import { getMessageReport } from "../message-report.js";

const LIST_MODELS_TIMEOUT_MS = 60_000;

export interface LlmModel {
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

interface OpenAiModel {
  id?: string;
  name?: string;
}

interface ChatResponse {
  message?: {
    role?: string;
    content?: string;
    reasoning?: string;
  };
  done_reason?: string;
  eval_count?: number;
}

function toChatResponse(
  choice: ChatCompletion["choices"][number] | undefined,
  usage: ChatCompletion["usage"],
): ChatResponse {
  const { content, reasoning } = parseAssistantMessage(choice);
  return {
    message: {
      role: choice?.message?.role,
      content,
      reasoning,
    },
    done_reason: choice?.finish_reason ?? undefined,
    eval_count: usage?.completion_tokens ?? usage?.total_tokens,
  };
}

function resolveBaseUrl(hostOverride?: string): string {
  const host = (hostOverride ?? getSettings().apiBaseUrl).trim();
  if (!host) {
    throw new Error("LLM base URL is not configured");
  }
  return host.replace(/\/$/, "");
}

function resolveOpenAiBaseUrl(hostOverride?: string): string {
  const base = resolveBaseUrl(hostOverride);
  return base.endsWith("/v1") ? base : `${base}/v1`;
}

function openAiClient(hostOverride?: string): OpenAI {
  return new OpenAI({
    apiKey: config.openAiApiKey || "not-needed",
    baseURL: resolveOpenAiBaseUrl(hostOverride),
    maxRetries: 0,
  });
}

function pickAssistantContent(data: ChatResponse): string {
  return data.message?.content?.trim() ?? "";
}

function pickReasoning(data: ChatResponse): string {
  return data.message?.reasoning?.trim() ?? "";
}

function emptyResponseError(
  model: string,
  data: ChatResponse,
  numPredict: number,
): Error {
  const reason = data.done_reason ?? "unknown";
  const evalCount = data.eval_count ?? 0;
  const hadReasoning = Boolean(pickReasoning(data));

  const settings = getSettings();
  let hint =
    "Try /reset to shorten context, pick a different model, or raise generation tokens in Settings.";
  if (reason === "length") {
    hint = `Generation used all ${numPredict} tokens before a usable [REPLY]. Raise generation tokens in Settings (try 512+) or send /reset.`;
  } else if (hadReasoning) {
    hint =
      "The API returned reasoning but left content empty. " +
      "The [REPLY] answer must be in content, not only in reasoning. " +
      "Disable thinking, check the selected model/provider reasoning configuration, or try /reset.";
  }

  const fields = Object.keys(data).sort().join(", ") || "none";
  return new Error(
    `LLM returned an empty response (model: ${model}, finish_reason: ${reason}, tokens: ${evalCount}, fields: ${fields}). ${hint}`,
  );
}

export async function listModels(hostOverride?: string): Promise<LlmModel[]> {
  try {
    const page = await openAiClient(hostOverride).models.list({
      timeout: LIST_MODELS_TIMEOUT_MS,
    });
    return normalizeModels(page.data ?? []);
  } catch (err) {
    throw wrapModelListError(err, hostOverride);
  }
}

function normalizeModels(models: (OpenAiModel | Model)[]): LlmModel[] {
  const seen = new Set<string>();
  return models
    .map((entry) => {
      const fallbackName = "name" in entry ? entry.name : "";
      const name = (entry.id ?? fallbackName ?? "").trim();
      if (!name || seen.has(name)) return null;
      seen.add(name);
      return { name };
    })
    .filter((m): m is LlmModel => m !== null)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function showModel(
  _name: string,
  _hostOverride?: string,
): Promise<ModelShowResult> {
  return { modelMaxCtx: null };
}

async function prepareMessages(
  messages: ChatMessage[],
): Promise<ChatMessage[]> {
  return Promise.all(
    messages.map(async (msg) => {
      if (!msg.images?.length) return msg;
      const images = await Promise.all(
        msg.images.map((b64) => normalizeImageForChat(b64)),
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
  /** Use low temperature for structured side passes (mood, memory, search, etc.). */
  auxiliary?: boolean;
  /** Reserved for main reply calls. */
  think?: boolean;
  /** Record LLM I/O on the active debug trace for this turn. */
  traceTurnId?: number;
  /** Debug trace section label, e.g. "web search decision". */
  traceLabel?: string;
  /** Split main-reply prompt into system / history / latest sections for debug trace. */
  traceLayout?: VerbosePromptLayout;
}

async function requestChat(
  model: string,
  prepared: ChatMessage[],
  numPredict: number,
  auxiliary: boolean,
  traceTurnId?: number,
  traceLayout?: VerbosePromptLayout,
  traceLabel?: string,
): Promise<ChatResponse> {
  const settings = getResolvedSettings();
  let response: ChatCompletion;
  try {
    response = await openAiClient().chat.completions.create(
      chatCompletionBody(model, prepared, numPredict, auxiliary),
      { timeout: getChatTimeoutMs(settings) },
    );
  } catch (err) {
    if (
      err instanceof APIConnectionTimeoutError ||
      err instanceof APIConnectionError
    ) {
      throw err;
    }
    if (err instanceof APIError) {
      const body = apiErrorDetails(err);
      if (err.status === 400 && /image|audio file/i.test(body)) {
        throw new Error(
          `LLM rejected the image (is "${model}" a vision model?). ${body}`,
        );
      }
      throw new Error(
        `LLM chat failed (${err.status ?? "unknown"}): ${body}`,
      );
    }
    throw err;
  }

  const data = toChatResponse(response.choices?.[0], response.usage);
  if (traceTurnId != null) {
    const report = getMessageReport(traceTurnId);
    if (report) {
      report.recordLlmCall(
        traceLabel ?? "llm",
        model,
        numPredict,
        prepared,
        data,
        traceLayout,
        formatTraceSamplingLine(settings, auxiliary),
      );
    }
  }
  return data;
}
function formatTraceSamplingLine(
  settings: Settings,
  auxiliary: boolean,
): string {
  const temp = auxiliary ? AUXILIARY_TEMPERATURE : settings.temperature;
  const reasoningEffort = providerChatExtensions(settings, auxiliary)
    .reasoning_effort;
  return [
    `temperature: ${temp}`,
    `top_p: ${settings.topP}`,
    `top_k: ${settings.topK}`,
    `repeat_penalty: ${settings.repeatPenalty}`,
    `num_ctx: ${settings.numCtx}`,
    `reasoning_effort: ${reasoningEffort}`,
  ].join(", ");
}

function chatCompletionBody(
  model: string,
  messages: ChatMessage[],
  numPredict: number,
  auxiliary: boolean,
): ChatCompletionCreateParamsNonStreaming {
  const settings = getResolvedSettings();
  return {
    model,
    messages: messages.map(toOpenAiMessage),
    stream: false,
    max_completion_tokens: numPredict,
    temperature: auxiliary ? AUXILIARY_TEMPERATURE : settings.temperature,
    top_p: settings.topP,
    ...providerChatExtensions(settings, auxiliary),
  } as ChatCompletionCreateParamsNonStreaming;
}

function toOpenAiMessage(msg: ChatMessage): ChatCompletionMessageParam {
  if (!msg.images?.length) {
    return { role: msg.role, content: msg.content };
  }
  if (msg.role !== "user") {
    return { role: msg.role, content: msg.content };
  }
  return {
    role: "user",
    content: [
      { type: "text", text: msg.content },
      ...msg.images.map((image) => ({
        type: "image_url" as const,
        image_url: { url: `data:image/jpeg;base64,${image}` },
      })),
    ],
  };
}

export interface ChatCompleteResult {
  /** Assistant final answer content. */
  raw: string;
  /** Optional model reasoning when the API returns it separately. */
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
  const traceTurnId = options?.traceTurnId;
  const traceLayout = options?.traceLayout;
  const traceLabel = options?.traceLabel;
  const auxiliary = options?.auxiliary ?? false;

  try {
    const numPredict = getEffectiveNumPredict(settings, {
      baseNumPredict: options?.numPredict,
    });
    const data = await requestChat(
      model,
      prepared,
      numPredict,
      auxiliary,
      traceTurnId,
      traceLayout,
      traceLabel,
    );
    const raw = pickAssistantContent(data);
    const thinking = pickReasoning(data);
    if (raw) {
      return { raw, thinking };
    }
    throw emptyResponseError(model, data, numPredict);
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

function wrapChatError(err: unknown, auxiliary = false): Error {
  const settings = getSettings();
  const apiUrl = resolveBaseUrl();
  const timeoutSec = settings.chatTimeoutSec;

  if (
    err instanceof APIConnectionTimeoutError ||
    (err instanceof Error && err.name === "TimeoutError")
  ) {
    if (auxiliary) {
      return new Error(
        `LLM auxiliary request timed out after ${timeoutSec}s (${apiUrl}). The bot will skip that side pass and continue where possible.`,
      );
    }
    return new Error(
      `LLM request timed out after ${timeoutSec}s (${apiUrl}). Check the API URL in dashboard Settings, confirm the server is running, and verify the model name matches GET /v1/models.`,
    );
  }
  if (err instanceof APIConnectionError) {
    return new Error(
      `LLM connection failed (${apiUrl}): ${err.message}. Check the API URL in dashboard Settings.`,
    );
  }
  if (err instanceof Error) return err;
  return new Error(String(err));
}

function apiErrorDetails(err: APIError): string {
  if (typeof err.error === "string") return err.error;
  if (err.error && Object.keys(err.error).length > 0) {
    return JSON.stringify(err.error);
  }
  return err.message;
}

function wrapModelListError(err: unknown, hostOverride?: string): Error {
  const apiUrl = resolveBaseUrl(hostOverride);
  if (err instanceof APIConnectionTimeoutError) {
    return new Error(
      `Model listing timed out (${apiUrl}): ${err.message}`,
    );
  }
  if (err instanceof APIConnectionError) {
    return new Error(
      `Model listing connection failed (${apiUrl}): ${err.message}`,
    );
  }
  if (err instanceof APIError) {
    return new Error(
      `Model listing failed (${err.status ?? "unknown"}, ${apiUrl}): ${apiErrorDetails(err)}`,
    );
  }
  if (err instanceof Error) return err;
  return new Error(String(err));
}

export async function checkHealth(hostOverride?: string): Promise<boolean> {
  try {
    await openAiClient(hostOverride).models.list({ timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}
