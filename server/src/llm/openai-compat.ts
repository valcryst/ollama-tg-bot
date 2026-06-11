import type { ChatCompletion } from "openai/resources/chat/completions";
import type { Settings } from "../db/database.js";

/**
 * LocalAI OpenAI-compatible chat completions extensions.
 * @see https://localai.io/features/openai-functions/
 * @see https://github.com/mudler/LocalAI/pull/7959
 */

/** LocalAI `message` fields (OpenAI `content` + LocalAI reasoning split). */
export const ASSISTANT_MESSAGE_FIELDS = {
  content: "content",
  /** LocalAI / some backends (legacy alias). */
  reasoning: "reasoning",
  /** LocalAI documented field for Gemma 4, Qwen3, DeepSeek R1, etc. */
  reasoningContent: "reasoning_content",
} as const;

/** LocalAI request `options` bag (llama.cpp, vLLM, MLX backends). */
export interface LocalAiChatOptions {
  num_ctx: number;
  top_k: number;
  repeat_penalty: number;
  /** Preserve Gemma 4 channel tokens when the backend supports it. */
  skip_special_tokens?: boolean;
}

export interface ParsedAssistantMessage {
  /** Final answer — parse [REPLY] and side-pass blocks from this only. */
  content: string;
  /** Chain-of-thought — never merge into user-facing reply text. */
  reasoning: string;
}

export interface LocalAiChatExtensions {
  options: LocalAiChatOptions;
  reasoning_effort: LocalAiReasoningEffort;
}

export type LocalAiReasoningEffort = "none" | "low" | "medium" | "high";

/** Options bag only (dashboard preview). */
export function localAiRequestExtensions(
  settings: Settings,
): { options: LocalAiChatOptions } {
  return { options: localAiChatExtensions(settings, true).options };
}

/**
 * LocalAI chat request extensions: llama.cpp `options` + OpenAI `reasoning_effort`.
 * @see https://localai.io/advanced/model-configuration/
 *
 * Gemma 4 on LocalAI unreliably splits when `reasoning_effort` is not `"none"` — the
 * answer often lands in `reasoning` with empty `content`. Structured `[REPLY]` parsing
 * requires the full answer in `content`, so every chat request uses `reasoning_effort: "none"`.
 *
 * Reasoning is parsed from a separate backend field when returned, but is never merged
 * into user-facing reply text.
 */
export function localAiChatExtensions(
  settings: Settings,
  _auxiliary: boolean,
): LocalAiChatExtensions {
  return {
    options: {
      num_ctx: settings.numCtx,
      top_k: settings.topK,
      repeat_penalty: settings.repeatPenalty,
      skip_special_tokens: false,
    },
    reasoning_effort: "none",
  };
}

function readStringField(
  record: Record<string, unknown>,
  key: string,
): string {
  const value = record[key];
  return typeof value === "string" ? value.trim() : "";
}

function readTextContent(
  value: string | unknown[] | null | undefined,
): string {
  if (typeof value === "string") return value.trim();
  if (!Array.isArray(value)) return "";
  return value
    .map((part) => {
      if (part && typeof part === "object" && "text" in part) {
        const text = (part as { text?: string }).text;
        return typeof text === "string" ? text.trim() : "";
      }
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

/** Map an OpenAI chat completion choice to content + reasoning (LocalAI field split). */
export function parseAssistantMessage(
  choice: ChatCompletion["choices"][number] | undefined,
): ParsedAssistantMessage {
  if (!choice?.message) {
    return { content: "", reasoning: "" };
  }

  const message = choice.message as unknown as Record<string, unknown> & {
    content?: string | unknown[] | null;
    refusal?: string | null;
  };

  const content =
    readTextContent(message.content) ||
    (typeof message.refusal === "string" ? message.refusal.trim() : "");

  const reasoning =
    readStringField(message, ASSISTANT_MESSAGE_FIELDS.reasoningContent) ||
    readStringField(message, ASSISTANT_MESSAGE_FIELDS.reasoning);

  return { content, reasoning };
}
