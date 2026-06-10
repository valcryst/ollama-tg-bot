import { logModelAnswerBlock, logModelRequestBlock } from "../logging.js";
import type { ChatMessage, VerbosePromptLayout } from "./client.js";

interface ChatResponse {
  message?: {
    content?: string;
    reasoning?: string;
  };
  done_reason?: string;
  eval_count?: number;
}

const SECTION = (title: string) => `---- ${title} ----`;

function formatChatMessage(index: number, msg: ChatMessage): string {
  const imageNote = msg.images?.length ? ` (${msg.images.length} image(s))` : "";
  const lines = [`[${index}] ${msg.role}${imageNote}:`, msg.content];
  if (msg.images?.length) {
    lines.push(`(${msg.images.length} image(s) attached, base64 omitted)`);
  }
  return lines.join("\n");
}

function formatMessageList(messages: ChatMessage[]): string {
  if (messages.length === 0) return "(empty)";
  return messages
    .map((msg, index) => formatChatMessage(index, msg))
    .join("\n\n");
}

function formatFlatMessagesBody(
  model: string,
  maxTokens: number,
  messages: ChatMessage[],
  samplingLine?: string,
): string {
  const lines = [
    `model: ${model}`,
    `max_completion_tokens: ${maxTokens}`,
    ...(samplingLine ? [samplingLine, ""] : [""]),
  ];
  for (const [index, msg] of messages.entries()) {
    lines.push(formatChatMessage(index, msg));
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

function formatSectionedMessagesBody(
  model: string,
  maxTokens: number,
  layout: VerbosePromptLayout,
  samplingLine?: string,
): string {
  const historyChars = layout.history.reduce(
    (n, m) => n + m.content.length,
    0,
  );
  const lines = [
    `model: ${model}`,
    `max_completion_tokens: ${maxTokens}`,
    ...(samplingLine ? [samplingLine, ""] : [""]),
    SECTION("SYSTEM"),
    layout.system,
    "",
    SECTION(
      `CHAT HISTORY (${layout.history.length} messages, ${historyChars} chars)`,
    ),
    formatMessageList(layout.history),
    "",
    SECTION("LATEST TURN"),
    layout.latest,
  ];
  return lines.join("\n").trimEnd();
}

function formatResponseBody(data: ChatResponse): string {
  const lines = [
    `done_reason: ${data.done_reason ?? "unknown"}`,
    `eval_count: ${data.eval_count ?? 0}`,
  ];
  const content = data.message?.content ?? "";
  const reasoning = data.message?.reasoning ?? "";
  if (content) {
    lines.push("", "content:", content);
  }
  if (reasoning) {
    lines.push("", "reasoning:", reasoning);
  }
  return lines.join("\n");
}

export function logModelExchange(
  label: string,
  model: string,
  maxTokens: number,
  messages: ChatMessage[],
  response: ChatResponse,
  layout?: VerbosePromptLayout,
  samplingLine?: string,
): void {
  const requestBody = layout
    ? formatSectionedMessagesBody(model, maxTokens, layout, samplingLine)
    : formatFlatMessagesBody(model, maxTokens, messages, samplingLine);
  logModelRequestBlock(label, requestBody);
  logModelAnswerBlock(label, formatResponseBody(response));
}
