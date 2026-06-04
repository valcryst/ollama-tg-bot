import { NavLink, Outlet } from "react-router-dom";
import { useDashboard } from "../context/DashboardContext";
import { ErrorBanner } from "../components/ErrorBanner";
import "../App.css";

const navItems = [
  { to: "/", label: "Overview", end: true },
  { to: "/settings", label: "Settings", end: false },
  { to: "/memories", label: "Memories", end: false },
] as const;

export function AppLayout() {
  const {
    apiOnline,
    stats,
    ollamaOk,
    tavilyConfigured,
    apiUnreachable,
    sectionErrors,
    saveOk,
    load,
  } = useDashboard();

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <h1>Ollama TG Bot</h1>
          <p className="subtitle">Dashboard</p>
        </div>

        <nav className="sidebar-nav" aria-label="Main">
          {navItems.map(({ to, label, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                isActive ? "nav-link active" : "nav-link"
              }
            >
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="sidebar-status">
          <span className="status-label">Status</span>
          <div className="badges badges-stack">
            <span
              className={`badge ${
                apiOnline === true
                  ? "ok"
                  : apiOnline === false
                    ? "danger"
                    : "warn"
              }`}
            >
              API{" "}
              {apiOnline === true
                ? "online"
                : apiOnline === false
                  ? "offline"
                  : "unknown"}
            </span>
            <span className={`badge ${stats?.botRunning ? "ok" : "warn"}`}>
              Bot {stats?.botRunning ? "online" : stats ? "offline" : "—"}
            </span>
            <span
              className={`badge ${
                ollamaOk === true ? "ok" : ollamaOk === false ? "warn" : "warn"
              }`}
            >
              Ollama{" "}
              {ollamaOk === true
                ? "reachable"
                : ollamaOk === false
                  ? "unreachable"
                  : "—"}
            </span>
            <span
              className={`badge ${
                tavilyConfigured === true
                  ? "ok"
                  : tavilyConfigured === false
                    ? ""
                    : "warn"
              }`}
            >
              Tavily{" "}
              {tavilyConfigured === true
                ? "on"
                : tavilyConfigured === false
                  ? "off"
                  : "—"}
            </span>
          </div>
        </div>
      </aside>

      <div className="main-panel">
        {apiUnreachable ? (
          <ErrorBanner
            error={
              sectionErrors.stats ??
              sectionErrors.settings ??
              new Error("API is not responding")
            }
            onRetry={() => void load()}
          />
        ) : null}

        {saveOk ? (
          <div className="alert success page-alert">Settings saved</div>
        ) : null}

        <main className="page-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
