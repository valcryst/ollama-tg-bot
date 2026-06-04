import { useState } from "react";
import { useDashboard } from "../context/DashboardContext";
import {
  MemoriesPanel,
  type MemoryKind,
} from "../components/MemoriesPanel";

export function MemoriesPage() {
  const { apiOnline } = useDashboard();
  const [kind, setKind] = useState<MemoryKind>("user");

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
      </div>
      <MemoriesPanel apiOnline={apiOnline === true} kind={kind} embedded />
    </div>
  );
}
