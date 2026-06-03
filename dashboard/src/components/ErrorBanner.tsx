import { describeApiError, isApiError } from "../api";
import "./ErrorBanner.css";

interface ErrorBannerProps {
  error: unknown;
  onRetry?: () => void;
  onDismiss?: () => void;
  compact?: boolean;
}

export function ErrorBanner({
  error,
  onRetry,
  onDismiss,
  compact = false,
}: ErrorBannerProps) {
  const { title, message, hint } = describeApiError(error);
  const status = isApiError(error) ? error.status : undefined;
  const path = isApiError(error) ? error.path : undefined;

  return (
    <div className={`error-banner ${compact ? "compact" : ""}`} role="alert">
      <div className="error-banner-body">
        <strong>{title}</strong>
        <p>{message}</p>
        {(status || path) && (
          <p className="error-meta">
            {path}
            {status ? ` · HTTP ${status}` : ""}
          </p>
        )}
        {hint && <p className="error-hint">{hint}</p>}
      </div>
      <div className="error-banner-actions">
        {onRetry && (
          <button type="button" className="secondary" onClick={onRetry}>
            Retry
          </button>
        )}
        {onDismiss && (
          <button type="button" className="secondary" onClick={onDismiss}>
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
