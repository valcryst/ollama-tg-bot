import { useCallback, useEffect, useState } from "react";
import { api, type DataTablePayload, type DataTableSummary } from "../api";
import { useDashboard } from "../context/DashboardContext";
import { ErrorBanner } from "../components/ErrorBanner";

function formatCell(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function isLongColumn(column: string): boolean {
  return /content|fact|message|stack|value/i.test(column);
}

export function DataPage() {
  const { apiOnline } = useDashboard();
  const [tables, setTables] = useState<DataTableSummary[]>([]);
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [payload, setPayload] = useState<DataTablePayload | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [loadingTable, setLoadingTable] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const loadMeta = useCallback(async () => {
    if (!apiOnline) return;
    setLoadingMeta(true);
    setError(null);
    try {
      const data = await api.getDataTables();
      setTables(data.tables);
      setActiveTable((current) => {
        if (current && data.tables.some((t) => t.id === current)) {
          return current;
        }
        return data.tables[0]?.id ?? null;
      });
    } catch (err) {
      setError(err);
      setTables([]);
      setActiveTable(null);
    } finally {
      setLoadingMeta(false);
    }
  }, [apiOnline]);

  const loadTable = useCallback(
    async (tableId: string) => {
      if (!apiOnline) return;
      setLoadingTable(true);
      setError(null);
      try {
        const data = await api.getDataTable(tableId);
        setPayload(data);
      } catch (err) {
        setError(err);
        setPayload(null);
      } finally {
        setLoadingTable(false);
      }
    },
    [apiOnline],
  );

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    if (!activeTable) {
      setPayload(null);
      return;
    }
    void loadTable(activeTable);
  }, [activeTable, loadTable]);

  const activeSummary = tables.find((t) => t.id === activeTable);

  return (
    <div className="page">
      <header className="page-header">
        <h2>Data</h2>
        <p className="page-desc">
          Raw SQLite contents — one tab per table. Large tables show the newest{" "}
          {2000} rows.
        </p>
      </header>

      {error != null ? (
        <ErrorBanner
          error={error}
          compact
          onRetry={() => {
            void loadMeta();
            if (activeTable) void loadTable(activeTable);
          }}
        />
      ) : null}

      {loadingMeta && tables.length === 0 ? (
        <p className="hint">Loading tables…</p>
      ) : null}

      {tables.length > 0 ? (
        <>
          <div
            className="data-tabs"
            role="tablist"
            aria-label="Database tables"
          >
            {tables.map((table) => (
              <button
                key={table.id}
                type="button"
                role="tab"
                aria-selected={activeTable === table.id}
                className={
                  activeTable === table.id ? "data-tab active" : "data-tab"
                }
                onClick={() => setActiveTable(table.id)}
              >
                {table.label}
                <span className="data-tab-count">{table.count}</span>
              </button>
            ))}
          </div>

          <section className="card data-card">
            <div className="data-card-header">
              <h3>{activeSummary?.label ?? "Table"}</h3>
              {payload ? (
                <p className="hint data-card-meta">
                  {payload.total} row{payload.total === 1 ? "" : "s"}
                  {payload.truncated
                    ? ` — showing newest ${payload.rows.length}`
                    : null}
                </p>
              ) : null}
            </div>

            {loadingTable ? <p className="hint">Loading rows…</p> : null}

            {!loadingTable && payload && payload.rows.length === 0 ? (
              <p className="hint">No rows in this table.</p>
            ) : null}

            {!loadingTable && payload && payload.rows.length > 0 ? (
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      {payload.columns.map((column) => (
                        <th key={column}>{column}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {payload.rows.map((row, index) => (
                      <tr key={index}>
                        {payload.columns.map((column) => (
                          <td
                            key={column}
                            className={
                              isLongColumn(column) ? "cell-long" : undefined
                            }
                          >
                            {formatCell(row[column])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </section>
        </>
      ) : null}

      {!loadingMeta && tables.length === 0 && apiOnline && error == null ? (
        <p className="hint">No tables found.</p>
      ) : null}
    </div>
  );
}
