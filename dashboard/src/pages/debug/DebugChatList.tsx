import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, type DebugChatSummary } from "../../api";
import { ErrorBanner } from "../../components/ErrorBanner";
import { useDashboard } from "../../context/DashboardContext";
import { useLiveDebug } from "../../liveSocket";
import { debugChatPath } from "./debugPaths";
import { formatTime, patchChatSummaries } from "./debugUtils";

export function DebugChatList() {
  const { apiOnline } = useDashboard();
  const [chats, setChats] = useState<DebugChatSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const loadChats = useCallback(
    async (silent = false) => {
      if (!apiOnline) return;
      if (!silent) setLoading(true);
      setError(null);
      try {
        const data = await api.getDebugChats();
        setChats(data.chats);
      } catch (err) {
        setError(err);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [apiOnline],
  );

  useEffect(() => {
    void loadChats();
  }, [loadChats]);

  useLiveDebug(
    useCallback(
      (event) => {
        if (!apiOnline) return;
        if (event.listItem) {
          setChats((prev) => patchChatSummaries(prev, event));
        }
        void loadChats(true);
      },
      [apiOnline, loadChats],
    ),
    apiOnline === true,
  );

  return (
    <>
      {error != null ? (
        <ErrorBanner
          error={error}
          compact
          onRetry={() => void loadChats()}
        />
      ) : null}

      {loading ? <p className="loading">Loading…</p> : null}

      {!loading ? (
        <section className="card">
          <h3>Chats</h3>
          {chats.length === 0 ? (
            <p className="muted">
              No reports yet. Send messages to the bot to populate this view.
            </p>
          ) : (
            <div className="report-chat-list">
              {chats.map((chat) => (
                <Link
                  key={chat.chatId}
                  to={debugChatPath(chat.chatId)}
                  className="report-chat-item"
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
                </Link>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </>
  );
}
