import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { api, type DebugChatSummary, type MessageReportListItem } from "../../api";
import { ErrorBanner } from "../../components/ErrorBanner";
import { useDashboard } from "../../context/DashboardContext";
import { useLiveDebug } from "../../liveSocket";
import { debugMessagePath, decodeRouteChatId } from "./debugPaths";
import { formatDuration, formatTime, upsertListItem } from "./debugUtils";
import { statusClass } from "./DebugReportParts";

export function DebugChatMessages() {
  const { chatId: chatIdParam } = useParams();
  const chatId = decodeRouteChatId(chatIdParam);
  const { apiOnline } = useDashboard();
  const [chat, setChat] = useState<DebugChatSummary | null>(null);
  const [messages, setMessages] = useState<MessageReportListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const load = useCallback(
    async (silent = false) => {
      if (!apiOnline || !chatId) return;
      if (!silent) setLoading(true);
      setError(null);
      try {
        const [chatsRes, tracesRes] = await Promise.all([
          api.getDebugChats(),
          api.getDebugTraces(chatId),
        ]);
        const summary =
          chatsRes.chats.find((entry) => entry.chatId === chatId) ?? null;
        setChat(summary);
        setMessages(tracesRes.traces);
      } catch (err) {
        setError(err);
        setChat(null);
        setMessages([]);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [apiOnline, chatId],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useLiveDebug(
    useCallback(
      (event) => {
        if (!apiOnline || !chatId || event.chatId !== chatId) return;
        if (event.listItem) {
          setMessages((prev) => upsertListItem(prev, event.listItem!));
        } else {
          void load(true);
        }
      },
      [apiOnline, chatId, load],
    ),
    apiOnline === true,
  );

  if (!chatId) {
    return <Navigate to="/debug" replace />;
  }

  const title = chat?.label ?? `Chat ${chatId}`;

  return (
    <>
      {error != null ? (
        <ErrorBanner error={error} compact onRetry={() => void load()} />
      ) : null}

      {loading ? <p className="loading">Loading…</p> : null}

      {!loading ? (
        <section className="card">
          <h3>{title}</h3>
          {messages.length === 0 ? (
            <p className="muted">No reports for this chat.</p>
          ) : (
            <div className="report-message-list">
              {messages.map((item) => (
                <Link
                  key={item.id}
                  to={debugMessagePath(chatId, item.id)}
                  className="report-message-item"
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
                </Link>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}
