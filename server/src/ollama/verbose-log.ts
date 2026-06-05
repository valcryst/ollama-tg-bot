import { logOllamaAnswerBlock, logOllamaRequestBlock } from "../logging.js";
import type { ChatMessage, VerbosePromptLayout } from "./client.js";

interface OllamaChatResponse {
  message?: {
    content?: string;
    thinking?: string;
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
  numPredict: number,
  messages: ChatMessage[],
): string {
  const lines = [`model: ${model}`, `num_predict: ${numPredict}`, ""];
  for (const [index, msg] of messages.entries()) {
    lines.push(formatChatMessage(index, msg));
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

function formatSectionedMessagesBody(
  model: string,
  numPredict: number,
  layout: VerbosePromptLayout,
): string {
  const historyChars = layout.history.reduce(
    (n, m) => n + m.content.length,
    0,
  );
  const lines = [
    `model: ${model}`,
    `num_predict: ${numPredict}`,
    "",
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

function formatResponseBody(data: OllamaChatResponse): string {
  const lines = [
    `done_reason: ${data.done_reason ?? "unknown"}`,
    `eval_count: ${data.eval_count ?? 0}`,
  ];
  const content = data.message?.content ?? "";
  const thinking = data.message?.thinking ?? "";
  if (content) {
    lines.push("", "content:", content);
  }
  if (thinking) {
    lines.push("", "thinking:", thinking);
  }
  return lines.join("\n");
}

export function logOllamaExchange(
  label: string,
  model: string,
  numPredict: number,
  messages: ChatMessage[],
  response: OllamaChatResponse,
  layout?: VerbosePromptLayout,
): void {
  const requestBody = layout
    ? formatSectionedMessagesBody(model, numPredict, layout)
    : formatFlatMessagesBody(model, numPredict, messages);
  logOllamaRequestBlock(label, requestBody);
  logOllamaAnswerBlock(label, formatResponseBody(response));
}
