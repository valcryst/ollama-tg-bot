import { useCallback, useEffect, useState } from "react";
import {
  api,
  type DebugChatSummary,
  type MessageReportDetail,
  type MessageReportListItem,
  type ReportDetail,
  type ReportPhase,
} from "../api";
import { useDashboard } from "../context/DashboardContext";
import { ErrorBanner } from "../components/ErrorBanner";

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

function phaseStatusClass(status: ReportPhase["status"]): string {
  if (status === "ok") return "ok";
  if (status === "failed") return "danger";
  return "";
}

function PhaseDetail({ detail }: { detail: ReportDetail }) {
  if (detail.type === "fields") {
    return (
      <dl className="report-fields">
        {detail.fields.map(({ label, value }) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    );
  }

  if (detail.type === "text") {
    return (
      <div className="report-text-block">
        <h5>{detail.title}</h5>
        <pre className="report-pre">{detail.body}</pre>
      </div>
    );
  }

  if (detail.type === "mood") {
    return (
      <dl className="report-fields report-mood-grid">
        {Object.entries(detail.traits)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([trait, value]) => (
            <div key={trait}>
              <dt>{trait}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
    );
  }

  return (
    <div className="report-llm">
      <div className="report-llm-meta">
        <span>{detail.model}</span>
        {detail.sampling ? <span>{detail.sampling}</span> : null}
        {detail.output.meta ? <span>{detail.output.meta}</span> : null}
      </div>
      {detail.sections.map((section) => (
        <details key={section.title} className="report-section">
          <summary>{section.title}</summary>
          <pre className="report-pre">{section.body}</pre>
        </details>
      ))}
      <details className="report-section">
        <summary>Output</summary>
        <pre className="report-pre">{detail.output.content || "(empty)"}</pre>
      </details>
      {detail.output.reasoning ? (
        <details className="report-section">
          <summary>Reasoning</summary>
          <pre className="report-pre">{detail.output.reasoning}</pre>
        </details>
      ) : null}
    </div>
  );
}

function PhaseRow({ phase }: { phase: ReportPhase }) {
  return (
    <details className="report-phase">
      <summary className="report-phase-summary">
        <span className={`report-phase-status ${phaseStatusClass(phase.status)}`}>
          {phase.status}
        </span>
        <span className="report-phase-title">{phase.title}</span>
        <span className="report-phase-oneline">{phase.summary}</span>
        {phase.durationMs != null ? (
          <span className="report-phase-duration">{formatDuration(phase.durationMs)}</span>
        ) : null}
      </summary>
      {phase.detail ? (
        <div className="report-phase-body">
          <PhaseDetail detail={phase.detail} />
        </div>
      ) : null}
    </details>
  );
}

export function DebugPage() {
  const { apiOnline } = useDashboard();
  const [view, setView] = useState<View>("chats");
  const [chats, setChats] = useState<DebugChatSummary[]>([]);
  const [selectedChat, setSelectedChat] = useState<DebugChatSummary | null>(null);
  const [messages, setMessages] = useState<MessageReportListItem[]>([]);
  const [detail, setDetail] = useState<MessageReportDetail | null>(null);
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

  const loadMessages = useCallback(
    async (chat: DebugChatSummary) => {
      if (!apiOnline) return;
      setLoading(true);
      setError(null);
      try {
        const data = await api.getDebugTraces(chat.chatId);
        setMessages(data.traces);
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

  const loadDetail = useCallback(async (id: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getDebugTrace(id);
      setDetail(data.trace);
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
      setDetail(null);
      setView("messages");
      return;
    }
    if (view === "messages") {
      setSelectedChat(null);
      setMessages([]);
      setView("chats");
    }
  }

  const report = detail?.report;

  return (
    <div className="page debug-page">
      <header className="page-header">
        <div className="debug-header-row">
          <div>
            <h2>Debug</h2>
            <p className="page-desc">
              Message processing reports (last 50 per chat).
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
              void loadMessages(selectedChat);
            else if (view === "detail" && detail) void loadDetail(detail.id);
          }}
        />
      ) : null}

      {loading ? <p className="loading">Loading…</p> : null}

      {view === "chats" && !loading ? (
        <section className="card">
          <h3>Chats</h3>
          {chats.length === 0 ? (
            <p className="muted">
              No reports yet. Send messages to the bot to populate this view.
            </p>
          ) : (
            <div className="report-chat-list">
              {chats.map((chat) => (
                <button
                  key={chat.chatId}
                  type="button"
                  className="report-chat-item"
                  onClick={() => void loadMessages(chat)}
                >
                  <div>
                    <strong>{chat.label}</strong>
                    <span className="muted">
                      {chat.chatType === "private" ? "Private" : "Group"} ·{" "}
                      {chat.traceCount} reports
                    </span>
                  </div>
                  <span className="muted">
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
          {messages.length === 0 ? (
            <p className="muted">No reports for this chat.</p>
          ) : (
            <div className="report-message-list">
              {messages.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="report-message-item"
                  onClick={() => void loadDetail(item.id)}
                >
                  <div className="report-message-top">
                    <span className={`badge ${statusClass(item.status)}`}>
                      {item.status}
                    </span>
                    <span className="muted">#{item.id}</span>
                    <span className="report-message-time">
                      {formatTime(item.createdAt)}
                    </span>
                    <span className="report-message-duration">
                      {formatDuration(item.durationMs)}
                    </span>
                  </div>
                  <p className="report-headline">{item.headline}</p>
                  <p className="report-preview">{item.messagePreview}</p>
                  {item.userLabel ? (
                    <span className="report-badge">{item.userLabel}</span>
                  ) : null}
                </button>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {view === "detail" && detail && report && !loading ? (
        <>
          <section className={`card report-outcome report-outcome-${report.status}`}>
            <div className="report-outcome-head">
              <span className={`badge ${statusClass(report.status)}`}>
                {report.status}
              </span>
              <h3>{report.headline}</h3>
            </div>
            <p className="report-preview report-preview-large">
              {report.intake.messagePreview}
            </p>
            <dl className="report-meta">
              <div>
                <dt>When</dt>
                <dd>{formatTime(detail.createdAt)}</dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd>{formatDuration(report.durationMs)}</dd>
              </div>
              <div>
                <dt>Chat</dt>
                <dd>
                  {detail.chatType} · {detail.chatId}
                </dd>
              </div>
              {detail.messageId != null ? (
                <div>
                  <dt>Telegram msg</dt>
                  <dd>{detail.messageId}</dd>
                </div>
              ) : null}
            </dl>
          </section>

          <section className="card">
            <h3>Routing</h3>
            {report.routing.decision === "ignored" ? (
              <dl className="report-fields">
                <div>
                  <dt>Decision</dt>
                  <dd>Ignored</dd>
                </div>
                <div>
                  <dt>Reason</dt>
                  <dd>{report.routing.ignoreLabel}</dd>
                </div>
                {report.routing.addressSource ? (
                  <div>
                    <dt>Address check</dt>
                    <dd>{report.routing.addressSource}</dd>
                  </div>
                ) : null}
              </dl>
            ) : (
              <dl className="report-fields">
                <div>
                  <dt>Decision</dt>
                  <dd>Accepted</dd>
                </div>
                <div>
                  <dt>Trigger</dt>
                  <dd>{report.routing.triggerLabel}</dd>
                </div>
                {report.routing.addressSource ? (
                  <div>
                    <dt>Address match</dt>
                    <dd>{report.routing.addressSource}</dd>
                  </div>
                ) : null}
              </dl>
            )}
            {report.intake.hasMedia ? (
              <p className="muted report-note">
                Media attached{report.intake.mediaKind ? `: ${report.intake.mediaKind}` : ""}
              </p>
            ) : null}
          </section>

          {report.result.replyChars != null ||
          report.result.sticker ||
          report.result.error ||
          report.result.memory ? (
            <section className="card">
              <h3>Result</h3>
              <dl className="report-fields">
                {report.result.replyChars != null ? (
                  <div>
                    <dt>Reply length</dt>
                    <dd>{report.result.replyChars} chars</dd>
                  </div>
                ) : null}
                {report.result.chunks != null ? (
                  <div>
                    <dt>Chunks sent</dt>
                    <dd>{report.result.chunks}</dd>
                  </div>
                ) : null}
                {report.result.sticker ? (
                  <div>
                    <dt>Sticker</dt>
                    <dd>{report.result.sticker}</dd>
                  </div>
                ) : null}
                {report.result.thinkingSent ? (
                  <div>
                    <dt>Thinking sent</dt>
                    <dd>Yes</dd>
                  </div>
                ) : null}
                {report.result.memory ? (
                  <div>
                    <dt>Memory</dt>
                    <dd>
                      {report.result.memory.status === "pending"
                        ? "Pending…"
                        : report.result.memory.updated
                          ? `Updated (${report.result.memory.scopes?.join(", ") ?? "yes"})`
                          : "No changes"}
                      {report.result.memory.error
                        ? ` · ${report.result.memory.error}`
                        : ""}
                    </dd>
                  </div>
                ) : null}
                {report.result.error ? (
                  <div>
                    <dt>Error</dt>
                    <dd>{report.result.error}</dd>
                  </div>
                ) : null}
              </dl>
            </section>
          ) : null}

          <section className="card">
            <h3>Pipeline</h3>
            {report.phases.length === 0 ? (
              <p className="muted">No pipeline steps recorded.</p>
            ) : (
              <div className="report-phase-list">
                {report.phases.map((phase) => (
                  <PhaseRow key={`${phase.id}-${phase.title}`} phase={phase} />
                ))}
              </div>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
