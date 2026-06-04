import { ErrorBanner } from "../components/ErrorBanner";
import "../App.css";

interface OfflinePageProps {
  primaryLoadError: unknown;
  onRetry: () => void;
}

export function OfflinePage({ primaryLoadError, onRetry }: OfflinePageProps) {
  return (
    <div className="layout layout-narrow">
      <header className="header">
        <div>
          <h1>Ollama Telegram Bot</h1>
          <p className="subtitle">Dashboard</p>
        </div>
        <span className="badge danger">API offline</span>
      </header>
      {primaryLoadError ? (
        <ErrorBanner error={primaryLoadError} onRetry={onRetry} />
      ) : null}
      <section className="card empty-state">
        <h2>Backend not available</h2>
        <p>
          The dashboard could not reach the API. Start the server, then retry.
        </p>
        <ol>
          <li>
            Copy <code>.env.example</code> to <code>.env</code> and set{" "}
            <code>BOT_TOKEN</code>
          </li>
          <li>
            Run <code>npm run dev</code> (or <code>npm run dev -w server</code> in
            another terminal)
          </li>
        </ol>
        <button type="button" onClick={onRetry}>
          Retry connection
        </button>
      </section>
    </div>
  );
}
