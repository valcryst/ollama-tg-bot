import { useCallback, useEffect, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { api, type MessageReportDetail } from "../../api";
import { ErrorBanner } from "../../components/ErrorBanner";
import { useDashboard } from "../../context/DashboardContext";
import { useLiveDebug } from "../../liveSocket";
import {
  decodeRouteChatId,
  parseRouteMessageId,
} from "./debugPaths";
import { formatDuration, formatTime } from "./debugUtils";
import {
  downloadReportLog,
  PhaseRow,
  statusClass,
} from "./DebugReportParts";

export function DebugMessageDetail() {
  const { chatId: chatIdParam, messageId: messageIdParam } = useParams();
  const chatId = decodeRouteChatId(chatIdParam);
  const messageId = parseRouteMessageId(messageIdParam);
  const { apiOnline } = useDashboard();
  const [detail, setDetail] = useState<MessageReportDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!apiOnline || messageId == null) return;
      if (!silent) setLoading(true);
      setError(null);
      try {
        const data = await api.getDebugTrace(messageId);
        if (chatId && data.trace.chatId !== chatId) {
          setError(new Error("Report does not belong to this chat."));
          setDetail(null);
          return;
        }
        setDetail(data.trace);
      } catch (err) {
        setError(err);
        setDetail(null);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [apiOnline, chatId, messageId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useLiveDebug(
    useCallback(
      (event) => {
        if (!apiOnline || messageId == null || event.traceId !== messageId) {
          return;
        }
        if (event.trace) {
          if (chatId && event.trace.chatId !== chatId) return;
          setDetail(event.trace);
        } else {
          void load(true);
        }
      },
      [apiOnline, chatId, messageId, load],
    ),
    apiOnline === true,
  );

  if (!chatId || messageId == null) {
    return <Navigate to="/debug" replace />;
  }

  const report = detail?.report;

  return (
    <>
      {error != null ? (
        <ErrorBanner error={error} compact onRetry={() => void load()} />
      ) : null}

      {loading ? <p className="loading">Loading…</p> : null}

      {!loading && detail && report ? (
        <>
          <div className="debug-header-actions debug-detail-actions">
            <button
              type="button"
              className="btn secondary"
              onClick={() => downloadReportLog(detail)}
            >
              Download log
            </button>
          </div>

          <section
            className={`card report-outcome report-outcome-${report.status}`}
          >
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
                Media attached
                {report.intake.mediaKind ? `: ${report.intake.mediaKind}` : ""}
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

      {!loading && !detail && error == null ? (
        <p className="muted">Report not found.</p>
      ) : null}
    </>
  );
}
