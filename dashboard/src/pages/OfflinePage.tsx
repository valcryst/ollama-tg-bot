import {
  ApiError,
  describeApiError,
  isApiError,
} from "../api";
import "../App.css";

interface OfflinePageProps {
  primaryLoadError: unknown;
  onRetry: () => void;
}

function fallbackError(): ApiError {
  return new ApiError({
    kind: "network",
    path: "/api/health",
    message: "Could not connect to the API",
  });
}

export function OfflinePage({ primaryLoadError, onRetry }: OfflinePageProps) {
  const error = primaryLoadError ?? fallbackError();
  const { title, message, hint } = describeApiError(error);
  const status = isApiError(error) ? error.status : undefined;
  const path = isApiError(error) ? error.path : undefined;
  const isNetwork = isApiError(error) && error.kind === "network";

  const badgeLabel = isNetwork ? "API offline" : "Startup error";

  return (
    <div className="layout layout-narrow">
      <header className="header">
        <div>
          <h1>Ollama Telegram Bot</h1>
          <p className="subtitle">Dashboard</p>
        </div>
        <span className="badge danger">{badgeLabel}</span>
      </header>
      <section className="card empty-state">
        <h2>{title}</h2>
        <p>{message}</p>
        {(status || path) && (
          <p className="error-meta">
            {path}
            {status ? ` · HTTP ${status}` : ""}
          </p>
        )}
        {hint ? <p className="error-hint">{hint}</p> : null}
        {isNetwork ? (
          <>
            <h3 className="empty-state-subhead">If the server is not running</h3>
            <ol>
              <li>
                Copy <code>.env.example</code> to <code>.env</code>
              </li>
              <li>
                Set <code>BOT_TOKEN</code> and <code>VRAM_AVAILABLE</code> (GPU
                VRAM in GB, e.g. <code>24</code>)
              </li>
              <li>
                Run <code>npm run dev</code> (or{" "}
                <code>npm run dev -w server</code> in another terminal)
              </li>
            </ol>
            <p className="error-hint">
              In dev the API listens on port 3000 (Vite proxies <code>/api</code>
              ). <code>PORT</code> in <code>.env</code> applies to production
              only.
            </p>
          </>
        ) : (
          <p className="error-hint">
            Fix the issue in the server terminal or <code>.env</code>, then
            retry.
          </p>
        )}
        <button type="button" onClick={onRetry}>
          Retry connection
        </button>
      </section>
    </div>
  );
}
