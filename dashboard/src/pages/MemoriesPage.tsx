import { useState } from "react";
import { useDashboard } from "../context/DashboardContext";
import { GeneralMemoriesPanel } from "../components/GeneralMemoriesPanel";
import {
  MemoriesPanel,
  type MemoryKind,
} from "../components/MemoriesPanel";

type TabKind = MemoryKind | "general";

export function MemoriesPage() {
  const { apiOnline } = useDashboard();
  const [kind, setKind] = useState<TabKind>("user");

  return (
    <div className="page">
      <div className="memories-tabs" role="tablist" aria-label="Memory type">
        <button
          type="button"
          role="tab"
          aria-selected={kind === "user"}
          className={kind === "user" ? "memories-tab active" : "memories-tab"}
          onClick={() => setKind("user")}
        >
          Users
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={kind === "group"}
          className={kind === "group" ? "memories-tab active" : "memories-tab"}
          onClick={() => setKind("group")}
        >
          Groups
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={kind === "general"}
          className={
            kind === "general" ? "memories-tab active" : "memories-tab"
          }
          onClick={() => setKind("general")}
        >
          General
        </button>
      </div>
      {kind === "general" ? (
        <GeneralMemoriesPanel apiOnline={apiOnline === true} embedded />
      ) : (
        <MemoriesPanel apiOnline={apiOnline === true} kind={kind} embedded />
      )}
    </div>
  );
}
