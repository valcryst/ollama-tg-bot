import type { ChatMessage } from "./llm/client.js";
import type { VerbosePromptLayout } from "./llm/client.js";
import {
  type DebugStep,
  type DebugTraceSummary,
  upsertDebugTrace,
} from "./db/debug-traces.js";

interface ChatResponseShape {
  message?: {
    content?: string;
    reasoning?: string;
  };
  done_reason?: string;
  eval_count?: number;
}

const sessions = new Map<number, DebugTraceSession>();

export class DebugTraceSession {
  readonly turnId: number;
  readonly chatId: string;
  readonly convKey: string;
  readonly userId: string | null;
  readonly chatType: string;
  readonly messageId: number | null;
  readonly messagePreview: string;
  private readonly startedAt = performance.now();
  private steps: DebugStep[] = [];
  private summary: DebugTraceSummary = {
    outcome: "ignored",
    webSearch: false,
    linkFetch: false,
    vision: false,
    memoryExtract: false,
    memoryUpdated: false,
    sticker: false,
    moodEvaluated: false,
  };
  private status: "ignored" | "processed" | "error" = "ignored";
  private finalized = false;

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

  patchSummary(patch: Partial<DebugTraceSummary>): void {
    Object.assign(this.summary, patch);
  }

  step(
    name: string,
    data?: Record<string, unknown>,
    durationMs?: number,
  ): void {
    const at = Math.round(performance.now() - this.startedAt);
    this.steps.push({
      at,
      step: name,
      ...(durationMs != null ? { durationMs: Math.round(durationMs) } : {}),
      ...(data && Object.keys(data).length > 0 ? { data } : {}),
    });
  }

  timedStep(
    name: string,
    startedAt: number,
    data?: Record<string, unknown>,
  ): void {
    this.step(name, data, performance.now() - startedAt);
  }

  recordLlmExchange(
    label: string,
    model: string,
    maxTokens: number,
    messages: ChatMessage[],
    response: ChatResponseShape,
    layout?: VerbosePromptLayout,
    samplingLine?: string,
  ): void {
    this.step(`llm:${label}`, {
      kind: "llm",
      label,
      model,
      maxTokens,
      sampling: samplingLine,
      request: layout
        ? {
            system: layout.system,
            history: layout.history.map((m) => ({
              role: m.role,
              content: m.content,
              imageCount: m.images?.length ?? 0,
            })),
            latest: layout.latest,
          }
        : messages.map((m) => ({
            role: m.role,
            content: m.content,
            imageCount: m.images?.length ?? 0,
          })),
      response: {
        doneReason: response.done_reason ?? "unknown",
        evalCount: response.eval_count ?? 0,
        content: response.message?.content ?? "",
        reasoning: response.message?.reasoning ?? "",
      },
    });
  }

  finalize(
    status: "ignored" | "processed" | "error",
    patch?: Partial<DebugTraceSummary>,
    options?: { awaitMemory?: boolean },
  ): void {
    if (patch) this.patchSummary(patch);
    this.status = status;
    this.summary.outcome = status;
    if (this.summary.durationMs == null) {
      this.summary.durationMs = Math.round(performance.now() - this.startedAt);
    }
    this.persist();
    this.finalized = true;
    if (!options?.awaitMemory) {
      sessions.delete(this.turnId);
    }
  }

  updateMemoryResult(input: {
    memoryUpdated: boolean;
    memoryScopes: string[];
    error?: string;
  }): void {
    this.patchSummary({
      memoryExtract: true,
      memoryUpdated: input.memoryUpdated,
      memoryScopes: input.memoryScopes,
    });
    if (input.error) {
      this.step("memory_extract_failed", { error: input.error });
    } else if (input.memoryUpdated) {
      this.step("memory_updated", { scopes: input.memoryScopes });
    } else {
      this.step("memory_extract_no_changes");
    }
    this.persist();
    sessions.delete(this.turnId);
  }

  private persist(): void {
    upsertDebugTrace({
      id: this.turnId,
      chatId: this.chatId,
      convKey: this.convKey,
      userId: this.userId,
      chatType: this.chatType,
      messageId: this.messageId,
      messagePreview: this.messagePreview,
      status: this.status,
      summary: this.summary,
      steps: this.steps,
      durationMs: this.summary.durationMs ?? null,
    });
  }
}

export function beginDebugTrace(input: {
  turnId: number;
  chatId: number;
  convKey?: string;
  userId: string | null;
  chatType: string;
  messageId: number | null;
  messagePreview: string;
}): DebugTraceSession {
  const session = new DebugTraceSession({
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

export function getDebugTrace(turnId: number): DebugTraceSession | undefined {
  return sessions.get(turnId);
}
