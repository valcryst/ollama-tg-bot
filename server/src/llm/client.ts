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
  getProviderExtensions,
  getReplyNumPredict,
  LENGTH_RETRY_MIN_PREDICT,
  maxNumPredictForContext,
} from "../settings-limits.js";
import { getResolvedSettings } from "../settings-runtime.js";
import { normalizeImageForChat } from "./images.js";
import { logModelExchange } from "./verbose-log.js";

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

interface OpenAiContentPart {
  type?: string;
  text?: string;
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
    if (settings.thinkingEnabled) {
      const replyBudget = getReplyNumPredict(settings);
      hint =
        `Generation used all ${numPredict} tokens before a usable [REPLY]. ` +
        `Reasoning and reply share one generation budget ` +
        `(reply slice ~${replyBudget} tokens). Raise total generation tokens, lower thinking, or send /reset.`;
    } else {
      hint = `Generation used all ${numPredict} tokens before a usable [REPLY]. Raise generation tokens in Settings (try 512+) or send /reset.`;
    }
  } else if (hadReasoning) {
    hint =
      "The model returned reasoning output but no message content. If this persists, try disabling thinking mode or switch models.";
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
  /**
   * Request model reasoning when settings.thinkingEnabled (main replies and
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
): Promise<ChatResponse> {
  const settings = getResolvedSettings();
  let response: ChatCompletion;
  try {
    response = await openAiClient().chat.completions.create(
      chatCompletionBody(model, prepared, numPredict, auxiliary, think),
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

  const data = chatCompletionToChatResponse(response);
  if (verboseLabel) {
    logModelExchange(
      verboseLabel,
      model,
      numPredict,
      prepared,
      data,
      verboseLayout,
      formatVerboseSamplingLine(settings, auxiliary, think),
    );
  }
  return data;
}

function formatVerboseSamplingLine(
  settings: Settings,
  auxiliary: boolean,
  think: boolean,
): string {
  const temp = auxiliary ? AUXILIARY_TEMPERATURE : settings.temperature;
  const parts = [
    `temperature: ${temp}`,
    `top_p: ${settings.topP}`,
    `top_k: ${settings.topK}`,
    `repeat_penalty: ${settings.repeatPenalty}`,
    `num_ctx: ${settings.numCtx}`,
    think ? "reasoning_effort: medium" : null,
  ].filter(Boolean);
  return parts.join(", ");
}

function chatCompletionBody(
  model: string,
  messages: ChatMessage[],
  numPredict: number,
  auxiliary: boolean,
  think: boolean,
): ChatCompletionCreateParamsNonStreaming {
  const settings = getResolvedSettings();
  return {
    model,
    messages: messages.map(toOpenAiMessage),
    stream: false,
    max_completion_tokens: numPredict,
    temperature: auxiliary ? AUXILIARY_TEMPERATURE : settings.temperature,
    top_p: settings.topP,
    ...(think ? { reasoning_effort: "medium" } : {}),
    ...getProviderExtensions(settings),
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

function chatCompletionToChatResponse(data: ChatCompletion): ChatResponse {
  const choice = data.choices?.[0];
  return {
    message: {
      role: choice?.message?.role,
      content: openAiChoiceText(choice),
      reasoning: openAiChoiceReasoning(choice),
    },
    done_reason: choice?.finish_reason ?? undefined,
    eval_count:
      data.usage?.completion_tokens ??
      data.usage?.total_tokens,
  };
}

function openAiChoiceText(
  choice: ChatCompletion["choices"][number] | undefined,
): string {
  return (
    openAiTextContent(choice?.message?.content) ||
    choice?.message?.refusal?.trim() ||
    ""
  );
}

function openAiChoiceReasoning(
  choice: ChatCompletion["choices"][number] | undefined,
): string {
  const message = choice?.message as
    | (ChatCompletion["choices"][number]["message"] & {
        reasoning?: string | null;
        reasoning_content?: string | null;
      })
    | undefined;
  return (
    message?.reasoning?.trim() ||
    message?.reasoning_content?.trim() ||
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
  const verboseLabel = options?.verboseLabel;
  const verboseLayout = options?.verboseLayout;
  const auxiliary = options?.auxiliary ?? false;
  const think = Boolean(options?.think && settings.thinkingEnabled);

  try {
    let numPredict = getEffectiveNumPredict(settings, {
      baseNumPredict: options?.numPredict,
    });
    let lastData: ChatResponse | null = null;

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
      const reasoning = pickReasoning(lastData);
      if (raw) {
        return {
          raw,
          thinking: reasoning,
        };
      }

      // Some OpenAI-compatible backends (e.g. LocalAI) return text in reasoning only.
      if (reasoning) {
        return { raw: reasoning, thinking: "" };
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
