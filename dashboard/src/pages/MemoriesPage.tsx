import { useDashboard } from "../context/DashboardContext";
import { MemoriesPanel } from "../components/MemoriesPanel";

export function MemoriesPage() {
  const { apiOnline } = useDashboard();

  return (
    <div className="page">
      <MemoriesPanel apiOnline={apiOnline === true} embedded />
    </div>
  );
}
