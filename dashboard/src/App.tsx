import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { DashboardProvider, useDashboard } from "./context/DashboardContext";
import { AppLayout } from "./layout/AppLayout";
import { MemoriesPage } from "./pages/MemoriesPage";
import { OfflinePage } from "./pages/OfflinePage";
import { OverviewPage } from "./pages/OverviewPage";
import { CharacterPage } from "./pages/CharacterPage";
import { SettingsPage } from "./pages/SettingsPage";
import { DataPage } from "./pages/DataPage";
import "./App.css";

function DashboardRoutes() {
  const {
    loading,
    apiUnreachable,
    settings,
    stats,
    primaryLoadError,
    load,
  } = useDashboard();

  if (loading) {
    return (
      <div className="layout">
        <p className="loading">Loading dashboard…</p>
      </div>
    );
  }

  if (apiUnreachable && !settings && !stats) {
    return (
      <OfflinePage
        primaryLoadError={primaryLoadError}
        onRetry={() => void load()}
      />
    );
  }

  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<OverviewPage />} />
        <Route path="character" element={<CharacterPage />} />
        <Route path="settings" element={<SettingsPage />} />
        <Route path="memories" element={<MemoriesPage />} />
        <Route path="data" element={<DataPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <DashboardProvider>
        <DashboardRoutes />
      </DashboardProvider>
    </BrowserRouter>
  );
}
