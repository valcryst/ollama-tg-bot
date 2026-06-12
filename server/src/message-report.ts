import type { ChatMessage } from "./llm/client.js";
import type { VerbosePromptLayout } from "./llm/client.js";
import {
  type MessageReportListSummary,
  type MessageReportRecord,
  type ReportDetail,
  type ReportPhase,
  type ReportStatus,
  upsertMessageReport,
} from "./db/debug-traces.js";

export type {
  MessageReportListSummary,
  MessageReportRecord,
  ReportDetail,
  MessageReport,
  ReportPhase,
  ReportStatus,
} from "./db/debug-traces.js";

const IGNORE_LABELS: Record<string, string> = {
  from_bot: "Sender is a bot",
  slash_command: "Slash command",
  no_content: "Empty message",
  maintenance_mode: "Maintenance mode blocked",
  not_addressed: "Not addressed to the bot",
};

const ADDRESS_LABELS: Record<string, string> = {
  private: "Private chat (always addressed)",
  mention_or_reply: "Mention or reply to bot",
  name: "Bot name in message",
  analyzer: "LLM address check",
  no_text: "No text for address check",
};

const TRIGGER_LABELS: Record<string, string> = {
  addressed: "Addressed normally",
  random: "Random reply trigger",
  image: "Image reaction trigger",
};

const LLM_TITLES: Record<string, string> = {
  "address detection": "Address check",
  "web search decision": "Search decision",
  "mood evaluate": "Mood evaluation",
  "main reply": "Main reply",
  "vision describe": "Vision description",
  "sticker pick": "Sticker selection",
  "memory extract": "Memory extraction",
  "user memory merge": "Memory merge (user)",
  "group memory merge": "Memory merge (group)",
};

interface ChatResponseShape {
  message?: {
    content?: string;
    reasoning?: string;
  };
  done_reason?: string;
  eval_count?: number;
}

const sessions = new Map<number, MessageReportSession>();

export class MessageReportSession {
  readonly turnId: number;
  readonly chatId: string;
  convKey: string;
  readonly userId: string | null;
  readonly chatType: string;
  readonly messageId: number | null;
  readonly messagePreview: string;
  private readonly startedAt = performance.now();
  private status: ReportStatus = "ignored";
  private hasMedia = false;
  private mediaKind?: string;
  private routing:
    | {
        decision: "ignored";
        ignoreReason: string;
        ignoreLabel: string;
        addressSource?: string;
      }
    | {
        decision: "accepted";
        trigger: "addressed" | "random" | "image";
        triggerLabel: string;
        addressSource?: string;
      }
    | null = null;
  private phases: ReportPhase[] = [];
  private result: MessageReportRecord["result"] = {};
  private awaitMemory = false;

  constructor(input: {
    turnId: number;
    chatId: string;
    convKey?: string;
    userId: string | null;
    chatType: string;
    messageId: number | null;
    messagePreview: string;
  }) {
    this.turnId = input.turnId;
    this.chatId = input.chatId;
    this.convKey = input.convKey ?? "";
    this.userId = input.userId;
    this.chatType = input.chatType;
    this.messageId = input.messageId;
    this.messagePreview = input.messagePreview;
  }

  setConvKey(convKey: string): void {
    this.convKey = convKey;
  }

  setIntake(input: { hasMedia: boolean; mediaKind?: string }): void {
    this.hasMedia = input.hasMedia;
    this.mediaKind = input.mediaKind;
  }

  finishIgnored(ignoreReason: string, addressSource?: string): void {
    this.status = "ignored";
    this.routing = {
      decision: "ignored",
      ignoreReason,
      ignoreLabel: IGNORE_LABELS[ignoreReason] ?? ignoreReason,
      addressSource: addressSource
        ? humanAddressLabel(addressSource)
        : undefined,
    };
    this.persist();
    sessions.delete(this.turnId);
  }

  setAccepted(input: {
    trigger: "addressed" | "random" | "image";
    addressSource?: string;
  }): void {
    this.routing = {
      decision: "accepted",
      trigger: input.trigger,
      triggerLabel: TRIGGER_LABELS[input.trigger] ?? input.trigger,
      addressSource: input.addressSource
        ? humanAddressLabel(input.addressSource)
        : undefined,
    };
  }

  skipPhase(id: string, title: string, summary: string): void {
    this.phases.push({ id, title, status: "skipped", summary });
  }

  okPhase(
    id: string,
    title: string,
    summary: string,
    durationMs?: number,
    detail?: ReportDetail,
  ): void {
    this.phases.push({
      id,
      title,
      status: "ok",
      summary,
      ...(durationMs != null ? { durationMs: Math.round(durationMs) } : {}),
      ...(detail ? { detail } : {}),
    });
  }

  failPhase(
    id: string,
    title: string,
    summary: string,
    durationMs?: number,
    detail?: ReportDetail,
  ): void {
    this.phases.push({
      id,
      title,
      status: "failed",
      summary,
      ...(durationMs != null ? { durationMs: Math.round(durationMs) } : {}),
      ...(detail ? { detail } : {}),
    });
  }

  recordLlmCall(
    label: string,
    model: string,
    maxTokens: number,
    messages: ChatMessage[],
    response: ChatResponseShape,
    layout?: VerbosePromptLayout,
    samplingLine?: string,
  ): void {
    const title = LLM_TITLES[label] ?? label;
    const id = `llm-${label.replace(/\s+/g, "-")}`;
    const sections: Array<{ title: string; body: string }> = [];

    if (layout) {
      sections.push({ title: "System", body: layout.system });
      if (layout.history.length > 0) {
        sections.push({
          title: `History (${layout.history.length} messages)`,
          body: layout.history
            .map(
              (m, i) =>
                `[${i + 1}] ${m.role}${m.images?.length ? ` (${m.images.length} image(s))` : ""}\n${m.content}`,
            )
            .join("\n\n"),
        });
      }
      sections.push({ title: "Latest turn", body: layout.latest });
    } else {
      sections.push({
        title: "Messages",
        body: messages
          .map(
            (m, i) =>
              `[${i + 1}] ${m.role}${m.images?.length ? ` (${m.images.length} image(s))` : ""}\n${m.content}`,
          )
          .join("\n\n"),
      });
    }

    const content = response.message?.content ?? "";
    const reasoning = response.message?.reasoning ?? "";
    const meta = [
      `done: ${response.done_reason ?? "unknown"}`,
      `tokens: ${response.eval_count ?? 0}`,
      `max_tokens: ${maxTokens}`,
      samplingLine,
    ]
      .filter(Boolean)
      .join(" · ");

    const summaryParts = [`${model}`, `${content.length} chars output`];
    if (reasoning) summaryParts.push(`${reasoning.length} chars reasoning`);

    this.okPhase(id, title, summaryParts.join(" · "), undefined, {
      type: "llm",
      model,
      sampling: samplingLine,
      sections,
      output: {
        content,
        reasoning: reasoning || undefined,
        meta,
      },
    });
  }

  finalizeProcessed(options?: {
    replyChars?: number;
    chunks?: number;
    sticker?: string;
    thinkingSent?: boolean;
    awaitMemory?: boolean;
  }): void {
    this.status = "processed";
    this.result = {
      ...this.result,
      replyChars: options?.replyChars,
      chunks: options?.chunks,
      sticker: options?.sticker,
      thinkingSent: options?.thinkingSent,
      memory: options?.awaitMemory
        ? { status: "pending", updated: false }
        : this.result.memory,
    };
    this.awaitMemory = options?.awaitMemory ?? false;
    this.persist();
    if (!this.awaitMemory) {
      sessions.delete(this.turnId);
    }
  }

  finalizeError(error: string): void {
    this.status = "error";
    this.result = { ...this.result, error };
    this.persist();
    sessions.delete(this.turnId);
  }

  finalizeEarlyReply(input: { reason: string; replyChars?: number }): void {
    this.status = "processed";
    this.result = {
      error: input.reason,
      replyChars: input.replyChars,
    };
    this.persist();
    sessions.delete(this.turnId);
  }

  completeMemory(input: {
    updated: boolean;
    scopes: string[];
    error?: string;
  }): void {
    this.result = {
      ...this.result,
      memory: {
        status: input.error ? "failed" : "done",
        updated: input.updated,
        scopes: input.scopes,
        error: input.error,
      },
    };

    if (input.error) {
      this.failPhase("memory", "Memory extraction", input.error);
    } else if (input.updated) {
      this.okPhase(
        "memory",
        "Memory extraction",
        `Updated ${input.scopes.join(", ")} memory`,
      );
    } else {
      this.skipPhase(
        "memory",
        "Memory extraction",
        "No new facts extracted",
      );
    }

    this.persist();
    sessions.delete(this.turnId);
  }

  private buildReport(): MessageReportRecord {
    const durationMs = Math.round(performance.now() - this.startedAt);
    return {
      status: this.status,
      headline: buildHeadline(
        this.status,
        durationMs,
        this.routing,
        this.phases,
        this.result,
      ),
      durationMs,
      intake: {
        messagePreview: this.messagePreview,
        hasMedia: this.hasMedia,
        mediaKind: this.mediaKind,
      },
      routing:
        this.routing ?? {
          decision: "ignored",
          ignoreReason: "unknown",
          ignoreLabel: "Unknown",
        },
      phases: this.phases,
      result: this.result,
    };
  }

  private persist(): void {
    const report = this.buildReport();
    const listSummary: MessageReportListSummary = {
      headline: report.headline,
      badges: buildBadges(report),
      trigger:
        report.routing.decision === "accepted"
          ? report.routing.trigger
          : undefined,
      ignoreLabel:
        report.routing.decision === "ignored"
          ? report.routing.ignoreLabel
          : undefined,
    };

    upsertMessageReport({
      id: this.turnId,
      chatId: this.chatId,
      convKey: this.convKey,
      userId: this.userId,
      chatType: this.chatType,
      messageId: this.messageId,
      messagePreview: this.messagePreview,
      status: this.status,
      listSummary,
      report,
      durationMs: report.durationMs,
    });
  }
}

function buildBadges(report: MessageReportRecord): string[] {
  const badges: string[] = [];
  if (report.routing.decision === "accepted") {
    badges.push(report.routing.triggerLabel);
  } else {
    badges.push(report.routing.ignoreLabel);
  }

  for (const phase of report.phases) {
    if (phase.status !== "ok") continue;
    if (phase.id.startsWith("llm-")) continue;
    if (["delivery", "routing"].includes(phase.id)) continue;
    badges.push(phase.title.toLowerCase());
  }

  if (report.result.memory?.updated) {
    badges.push("memory updated");
  }

  return [...new Set(badges)].slice(0, 6);
}

function buildHeadline(
  status: ReportStatus,
  durationMs: number,
  routing: MessageReportSession["routing"],
  phases: ReportPhase[],
  result: MessageReportRecord["result"],
): string {
  const duration = formatDuration(durationMs);

  if (status === "ignored") {
    const label =
      routing?.decision === "ignored" ? routing.ignoreLabel : "Ignored";
    return `Ignored · ${label}`;
  }

  if (status === "error") {
    return `Failed in ${duration}${result.error ? ` · ${result.error}` : ""}`;
  }

  const features = [
    ...new Set(
      phases
        .filter((p) => p.status === "ok")
        .map((p) => p.title.toLowerCase())
        .filter((t) => t !== "main reply" && t !== "delivery"),
    ),
  ].slice(0, 4);

  if (result.error && !result.replyChars) {
    return `Stopped in ${duration} · ${result.error}`;
  }

  const replyPart =
    result.replyChars != null ? `${result.replyChars} chars` : "replied";
  const featureText = features.length > 0 ? ` · ${features.join(", ")}` : "";
  return `Replied in ${duration} · ${replyPart}${featureText}`;
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function humanAddressLabel(source?: string): string | undefined {
  if (!source) return undefined;
  return ADDRESS_LABELS[source] ?? source;
}

export function beginMessageReport(input: {
  turnId: number;
  chatId: number;
  convKey?: string;
  userId: string | null;
  chatType: string;
  messageId: number | null;
  messagePreview: string;
}): MessageReportSession {
  const session = new MessageReportSession({
    turnId: input.turnId,
    chatId: String(input.chatId),
    convKey: input.convKey,
    userId: input.userId,
    chatType: input.chatType,
    messageId: input.messageId,
    messagePreview: input.messagePreview,
  });
  sessions.set(input.turnId, session);
  return session;
}

export function getMessageReport(
  turnId: number,
): MessageReportSession | undefined {
  return sessions.get(turnId);
}

export const beginDebugTrace = beginMessageReport;
export const getDebugTrace = getMessageReport;
export type DebugTraceSession = MessageReportSession;
