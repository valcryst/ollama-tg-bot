import type { ChatCompletion } from "openai/resources/chat/completions";
import type { Settings } from "../db/database.js";

/** OpenAI-compatible assistant message fields used by common reasoning backends. */
export const ASSISTANT_MESSAGE_FIELDS = {
  content: "content",
  /** Legacy or provider-specific reasoning alias. */
  reasoning: "reasoning",
  /** Common reasoning field used by several OpenAI-compatible backends. */
  reasoningContent: "reasoning_content",
} as const;

/** Provider-specific request `options` bag used by several local backends. */
export interface ProviderChatOptions {
  num_ctx: number;
  top_k: number;
  repeat_penalty: number;
  /** Preserve channel tokens when the backend supports it. */
  skip_special_tokens?: boolean;
}

export interface ParsedAssistantMessage {
  /** Final answer: parse [REPLY] and side-pass blocks from this only. */
  content: string;
  /** Reasoning: never merge into user-facing reply text. */
  reasoning: string;
}

export interface ProviderChatExtensions {
  options: ProviderChatOptions;
  reasoning_effort: ReasoningEffort;
}

export type ReasoningEffort = "none" | "low" | "medium" | "high";

/** Options bag only for dashboard/API previews. */
export function providerRequestExtensions(
  settings: Settings,
): { options: ProviderChatOptions } {
  return { options: providerChatExtensions(settings, true).options };
}

/**
 * OpenAI-compatible chat request extensions for provider-specific options.
 *
 * Some backends can mis-split when `reasoning_effort` is not `"none"`: the
 * answer may land in `reasoning` with empty `content`. Keep thinking disabled
 * unless the selected backend/model handles separate reasoning reliably.
 *
 * Reasoning is parsed from a separate backend field when returned, but is never
 * merged into user-facing reply text.
 */
export function providerChatExtensions(
  settings: Settings,
  auxiliary: boolean,
): ProviderChatExtensions {
  return {
    options: {
      num_ctx: settings.numCtx,
      top_k: settings.topK,
      repeat_penalty: settings.repeatPenalty,
      skip_special_tokens: false,
    },
    // Side passes ([ADDRESS], [SEARCH], mood, memory, …) need structured output in
    // `content`. Many backends mis-split when reasoning is on — keep it off there.
    reasoning_effort:
      auxiliary || !settings.thinkingEnabled ? "none" : "medium",
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

/** Map an OpenAI chat completion choice to content + separate reasoning. */
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
