import { useCallback, useEffect, useState } from "react";
import {
  api,
  type DebugChatSummary,
  type DebugTraceListItem,
  type DebugTraceRecord,
  type DebugTraceSummary,
} from "../api";
import { useDashboard } from "../context/DashboardContext";
import { ErrorBanner } from "../components/ErrorBanner";
import { JsonView } from "../components/JsonView";

type View = "chats" | "messages" | "detail";

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

function formatDuration(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function statusClass(status: string): string {
  if (status === "processed") return "ok";
  if (status === "error") return "danger";
  return "warn";
}

function summaryFlags(summary: DebugTraceSummary): string[] {
  const flags: string[] = [];
  if (summary.trigger) flags.push(summary.trigger);
  else if (summary.ignoreReason) flags.push(`ignored: ${summary.ignoreReason}`);
  if (summary.addressSource) flags.push(`via ${summary.addressSource}`);
  if (summary.linkFetch) flags.push("link fetch");
  if (summary.webSearch) flags.push("web search");
  if (summary.vision) flags.push("vision");
  if (summary.moodEvaluated) flags.push("mood");
  if (summary.memoryExtract) {
    flags.push(
      summary.memoryUpdated
        ? `memory (${summary.memoryScopes?.join(", ") ?? "updated"})`
        : "memory (none)",
    );
  }
  if (summary.sticker) flags.push("sticker");
  if (summary.error) flags.push(`error: ${summary.error}`);
  return flags;
}

function stepSummaryHint(data?: Record<string, unknown>): string | null {
  if (!data) return null;
  if (data.kind === "llm") {
    const label = typeof data.label === "string" ? data.label : "llm";
    return `LLM · ${label}`;
  }
  const keys = Object.keys(data);
  if (keys.length === 0) return null;
  if (keys.length <= 3) return keys.join(", ");
  return `${keys.length} fields`;
}

function StepDetail({ step }: { step: { step: string; data?: Record<string, unknown> } }) {
  const data = step.data;
  if (!data) return null;

  if (data.kind === "llm") {
    const request = data.request;
    const response = data.response;
    return (
      <div className="debug-llm-detail">
        <div className="debug-llm-meta">
          <span>model: {String(data.model ?? "—")}</span>
          {data.sampling ? <span>{String(data.sampling)}</span> : null}
        </div>
        <details className="debug-nested-details">
          <summary>Request</summary>
          <JsonView value={request} collapsed />
        </details>
        <details className="debug-nested-details">
          <summary>Response</summary>
          <JsonView value={response} collapsed />
        </details>
      </div>
    );
  }

  return <JsonView value={data} collapsed />;
}

function TimelineStep({
  step,
  index,
}: {
  step: { step: string; at: number; durationMs?: number; data?: Record<string, unknown> };
  index: number;
}) {
  const hint = stepSummaryHint(step.data);
  const hasData = step.data != null && Object.keys(step.data).length > 0;

  return (
    <li>
      <details className="debug-step">
        <summary className="debug-step-summary">
          <span className="debug-step-index">{index + 1}</span>
          <span className="debug-step-name">{step.step}</span>
          {hint ? <span className="debug-step-hint">{hint}</span> : null}
          <span className="debug-step-time">
            +{step.at}ms
            {step.durationMs != null ? ` · ${step.durationMs}ms` : ""}
          </span>
        </summary>
        <div className="debug-step-body">
          {hasData ? (
            <StepDetail step={step} />
          ) : (
            <p className="muted debug-step-empty">No additional data.</p>
          )}
        </div>
      </details>
    </li>
  );
}

export function DebugPage() {
  const { apiOnline } = useDashboard();
  const [view, setView] = useState<View>("chats");
  const [chats, setChats] = useState<DebugChatSummary[]>([]);
  const [selectedChat, setSelectedChat] = useState<DebugChatSummary | null>(
    null,
  );
  const [traces, setTraces] = useState<DebugTraceListItem[]>([]);
  const [selectedTrace, setSelectedTrace] = useState<DebugTraceRecord | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const loadChats = useCallback(async () => {
    if (!apiOnline) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getDebugChats();
      setChats(data.chats);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [apiOnline]);

  const loadTraces = useCallback(
    async (chat: DebugChatSummary) => {
      if (!apiOnline) return;
      setLoading(true);
      setError(null);
      try {
        const data = await api.getDebugTraces(chat.chatId);
        setTraces(data.traces);
        setSelectedChat(chat);
        setView("messages");
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
      }
    },
    [apiOnline],
  );

  const loadTraceDetail = useCallback(async (id: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getDebugTrace(id);
      setSelectedTrace(data.trace);
      setView("detail");
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view === "chats") void loadChats();
  }, [view, loadChats]);

  function goBack() {
    if (view === "detail") {
      setSelectedTrace(null);
      setView("messages");
      return;
    }
    if (view === "messages") {
      setSelectedChat(null);
      setTraces([]);
      setView("chats");
    }
  }

  return (
    <div className="page debug-page">
      <header className="page-header">
        <div className="debug-header-row">
          <div>
            <h2>Debug</h2>
            <p className="page-desc">
              Per-message processing traces (last 50 messages per chat).
            </p>
          </div>
          {view !== "chats" ? (
            <button type="button" className="btn secondary" onClick={goBack}>
              ← Back
            </button>
          ) : (
            <button
              type="button"
              className="btn secondary"
              onClick={() => void loadChats()}
              disabled={loading}
            >
              Refresh
            </button>
          )}
        </div>
      </header>

      {error != null ? (
        <ErrorBanner
          error={error}
          compact
          onRetry={() => {
            if (view === "chats") void loadChats();
            else if (view === "messages" && selectedChat)
              void loadTraces(selectedChat);
            else if (view === "detail" && selectedTrace)
              void loadTraceDetail(selectedTrace.id);
          }}
        />
      ) : null}

      {loading ? <p className="loading">Loading…</p> : null}

      {view === "chats" && !loading ? (
        <section className="card">
          <h3>Chats</h3>
          {chats.length === 0 ? (
            <p className="muted">
              No traces yet. Send messages to the bot to populate this view.
            </p>
          ) : (
            <div className="debug-chat-list">
              {chats.map((chat) => (
                <button
                  key={chat.chatId}
                  type="button"
                  className="debug-chat-item"
                  onClick={() => void loadTraces(chat)}
                >
                  <div className="debug-chat-item-main">
                    <strong>{chat.label}</strong>
                    <span className="muted">
                      {chat.chatType === "private" ? "Private" : "Group"} ·{" "}
                      {chat.traceCount} message
                      {chat.traceCount === 1 ? "" : "s"}
                    </span>
                  </div>
                  <span className="muted debug-chat-item-time">
                    {chat.latestAt ? formatTime(chat.latestAt) : "—"}
                  </span>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {view === "messages" && selectedChat && !loading ? (
        <section className="card">
          <h3>{selectedChat.label}</h3>
          <p className="muted page-desc">
            Recent messages, newest first (max 50).
          </p>
          {traces.length === 0 ? (
            <p className="muted">No messages recorded for this chat.</p>
          ) : (
            <div className="debug-message-list">
              {traces.map((trace) => (
                <button
                  key={trace.id}
                  type="button"
                  className="debug-message-item"
                  onClick={() => void loadTraceDetail(trace.id)}
                >
                  <div className="debug-message-item-top">
                    <span className={`badge ${statusClass(trace.status)}`}>
                      {trace.status}
                    </span>
                    <span className="muted">
                      #{trace.id} · {formatTime(trace.createdAt)}
                    </span>
                    <span className="debug-duration">
                      {formatDuration(trace.durationMs ?? trace.summary.durationMs)}
                    </span>
                  </div>
                  <div className="debug-message-preview">
                    {trace.messagePreview}
                  </div>
                  <div className="debug-flag-row">
                    {trace.userLabel ? (
                      <span className="debug-flag">{trace.userLabel}</span>
                    ) : null}
                    {summaryFlags(trace.summary).map((flag) => (
                      <span key={flag} className="debug-flag">
                        {flag}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {view === "detail" && selectedTrace && !loading ? (
        <>
          <section className="card">
            <h3>Message #{selectedTrace.id}</h3>
            <dl className="stats debug-summary-grid">
              <div>
                <dt>Status</dt>
                <dd>
                  <span
                    className={`badge ${statusClass(selectedTrace.status)}`}
                  >
                    {selectedTrace.status}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Time</dt>
                <dd>{formatTime(selectedTrace.createdAt)}</dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd>
                  {formatDuration(
                    selectedTrace.durationMs ??
                      selectedTrace.summary.durationMs,
                  )}
                </dd>
              </div>
              <div>
                <dt>Chat</dt>
                <dd>
                  {selectedTrace.chatType} · {selectedTrace.chatId}
                </dd>
              </div>
              <div>
                <dt>Conv key</dt>
                <dd>
                  <code>{selectedTrace.convKey || "—"}</code>
                </dd>
              </div>
              <div>
                <dt>Telegram message</dt>
                <dd>{selectedTrace.messageId ?? "—"}</dd>
              </div>
            </dl>
            <p className="debug-message-preview">{selectedTrace.messagePreview}</p>
            <div className="debug-flag-row">
              {summaryFlags(selectedTrace.summary).map((flag) => (
                <span key={flag} className="debug-flag">
                  {flag}
                </span>
              ))}
            </div>
          </section>

          <section className="card">
            <h3>Processing timeline</h3>
            {selectedTrace.steps.length === 0 ? (
              <p className="muted">No steps recorded.</p>
            ) : (
              <ol className="debug-timeline">
                {selectedTrace.steps.map((step, index) => (
                  <TimelineStep
                    key={`${step.step}-${step.at}-${index}`}
                    step={step}
                    index={index}
                  />
                ))}
              </ol>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
