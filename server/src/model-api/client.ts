import { getSettings } from "../db/database.js";
import { extractTelegramReply } from "../response-format.js";
import {
  AUXILIARY_TEMPERATURE,
  getChatTimeoutMs,
  getEffectiveNumPredict,
  getReplyNumPredict,
  LENGTH_RETRY_MIN_PREDICT,
  maxNumPredictForContext,
} from "../settings-limits.js";
import { getResolvedSettings } from "../settings-runtime.js";
import { normalizeImageForChat } from "./images.js";
import { logModelExchange } from "./verbose-log.js";

const LIST_MODELS_TIMEOUT_MS = 60_000;

export interface ModelApiModel {
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
  object?: string;
  created?: number;
}

interface OpenAiChatResponse {
  choices?: OpenAiChoice[];
  usage?: {
    completion_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  };
}

interface OpenAiChoice {
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
    throw new Error("Model API base URL is not configured");
  }
  return host.replace(/\/$/, "");
}

function baseUrl(): string {
  return resolveBaseUrl();
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
      "This model returned reasoning output but no final answer. Restart the server and retry, or switch models.";
  }

  const fields = Object.keys(data).sort().join(", ") || "none";
  return new Error(
    `Model API returned an empty response (model: ${model}, finish_reason: ${reason}, tokens: ${evalCount}, fields: ${fields}). ${hint}`,
  );
}

export async function listModels(hostOverride?: string): Promise<ModelApiModel[]> {
  const res = await fetch(`${resolveBaseUrl(hostOverride)}/v1/models`, {
    signal: AbortSignal.timeout(LIST_MODELS_TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new Error(`Model listing failed (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { data?: OpenAiModel[] };
  return normalizeModels(data.data ?? []);
}

function normalizeModels(models: OpenAiModel[]): ModelApiModel[] {
  const seen = new Set<string>();
  return models
    .map((entry) => {
      const name = (entry.id ?? entry.name ?? "").trim();
      if (!name || seen.has(name)) return null;
      seen.add(name);
      return { name };
    })
    .filter((m): m is ModelApiModel => m !== null)
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
  const res = await fetch(`${baseUrl()}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(getChatTimeoutMs(settings)),
    body: JSON.stringify(
      chatCompletionBody(model, prepared, numPredict, auxiliary, think),
    ),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    if (res.status === 400 && /image|audio file/i.test(body)) {
      throw new Error(
        `Model API rejected the image (is "${model}" a vision model?). ${body}`,
      );
    }
    throw new Error(`Model API chat failed (${res.status}): ${body}`);
  }

  const data = openAiToChatResponse((await res.json()) as OpenAiChatResponse);
  if (verboseLabel) {
    logModelExchange(
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

function chatCompletionBody(
  model: string,
  messages: ChatMessage[],
  numPredict: number,
  auxiliary: boolean,
  think: boolean,
) {
  const settings = getResolvedSettings();
  return {
    model,
    messages: messages.map(toOpenAiMessage),
    stream: false,
    max_completion_tokens: numPredict,
    temperature: auxiliary ? AUXILIARY_TEMPERATURE : settings.temperature,
    top_p: settings.topP,
    ...(think ? { reasoning_effort: "medium" } : {}),
  };
}

function toOpenAiMessage(msg: ChatMessage) {
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

function openAiToChatResponse(data: OpenAiChatResponse): ChatResponse {
  const choice = data.choices?.[0];
  return {
    message: {
      role: choice?.message?.role ?? choice?.delta?.role,
      content: openAiChoiceText(choice),
      reasoning: openAiChoiceReasoning(choice),
    },
    done_reason: choice?.finish_reason,
    eval_count:
      data.usage?.completion_tokens ??
      data.usage?.output_tokens ??
      data.usage?.total_tokens,
  };
}

function openAiChoiceText(choice: OpenAiChoice | undefined): string {
  return (
    openAiTextContent(choice?.message?.content) ||
    choice?.text?.trim() ||
    choice?.delta?.content?.trim() ||
    ""
  );
}

function openAiChoiceReasoning(choice: OpenAiChoice | undefined): string {
  return (
    choice?.message?.reasoning?.trim() ||
    choice?.message?.reasoning_content?.trim() ||
    choice?.delta?.reasoning?.trim() ||
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
      if (raw) {
        return {
          raw,
          thinking: pickReasoning(lastData),
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
        `Model API auxiliary request timed out (${getSettings().chatTimeoutSec}s). The bot will skip that side pass and continue where possible.`,
      );
    }
    return new Error(
      `Model API request timed out (${getSettings().chatTimeoutSec}s). Try a smaller model, fewer chat history (/reset), or lower timeout in dashboard.`,
    );
  }
  if (err instanceof Error) return err;
  return new Error(String(err));
}

export async function checkHealth(hostOverride?: string): Promise<boolean> {
  try {
    const res = await fetch(`${resolveBaseUrl(hostOverride)}/v1/models`, {
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
