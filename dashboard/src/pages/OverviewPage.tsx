import { useDashboard } from "../context/DashboardContext";
import { ErrorBanner } from "../components/ErrorBanner";

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export function OverviewPage() {
  const { stats, sectionErrors, load } = useDashboard();

  return (
    <div className="page">
      <header className="page-header">
        <h2>Overview</h2>
        <p className="page-desc">Live bot activity and usage tips.</p>
      </header>

      <section className="card stats-card">
        <h3>Bot stats</h3>

        {sectionErrors.stats != null ? (
          <ErrorBanner
            error={sectionErrors.stats}
            compact
            onRetry={() => void load()}
          />
        ) : null}

        {stats ? (
          <dl className="stats">
            <div>
              <dt>Username</dt>
              <dd>{stats.botUsername ? `@${stats.botUsername}` : "—"}</dd>
            </div>
            <div>
              <dt>Uptime</dt>
              <dd>{formatUptime(stats.uptimeSeconds)}</dd>
            </div>
            <div>
              <dt>Messages received</dt>
              <dd>{stats.messagesReceived}</dd>
            </div>
            <div>
              <dt>Replies sent</dt>
              <dd>{stats.messagesReplied}</dd>
            </div>
            <div>
              <dt>Vision requests</dt>
              <dd>{stats.visionRequests}</dd>
            </div>
            <div>
              <dt>Errors</dt>
              <dd className={stats.errors > 0 ? "danger" : ""}>
                {stats.errors}
              </dd>
            </div>
            <div>
              <dt>Last activity</dt>
              <dd>
                {stats.lastActivityAt
                  ? new Date(stats.lastActivityAt).toLocaleString()
                  : "—"}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="hint">Stats unavailable — API may be offline.</p>
        )}

        {stats && stats.errors > 0 ? (
          <div className="error-log">
            <h3>Recent errors</h3>
            {stats.recentErrors.length === 0 ? (
              <p className="hint">
                No error details stored yet (counter includes failures before
                logging was added). Check the server console for{" "}
                <code>Handler error:</code> lines.
              </p>
            ) : (
              <ul className="error-log-list">
                {stats.recentErrors.map((entry) => (
                  <li key={entry.id} className="error-log-item">
                    <p className="error-log-message">{entry.message}</p>
                    <div className="error-log-meta">
                      <time dateTime={entry.createdAt}>
                        {new Date(entry.createdAt).toLocaleString()}
                      </time>
                      {entry.chatId ? (
                        <span>
                          chat <code>{entry.chatId}</code>
                        </span>
                      ) : null}
                      {entry.userId ? (
                        <span>
                          user <code>{entry.userId}</code>
                        </span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        <div className="usage">
          <h3>How to talk to the bot</h3>
          <ul>
            <li>
              <strong>Private chat:</strong> send any message
            </li>
            <li>
              <strong>Groups:</strong> @mention the bot, reply to its messages,
              or use <code>/start@your_bot</code> — plain <code>/start</code>{" "}
              does not reach the bot in groups
            </li>
            <li>
              <strong>Group setup:</strong> if the bot never answers, open
              @BotFather → <code>/setprivacy</code> → <b>Disable</b>, then
              remove and re-add the bot. “Has no access to messages” in group
              permissions is normal until then.
            </li>
            <li>
              <strong>Vision:</strong> send a photo, image file, or sticker
              (animated/video use a preview frame; optional caption)
            </li>
            <li>
              <strong>Commands:</strong> <code>/reset</code> clears chat
              history, <code>/forget</code> clears your stored memories
            </li>
          </ul>
        </div>
      </section>
    </div>
  );
}
