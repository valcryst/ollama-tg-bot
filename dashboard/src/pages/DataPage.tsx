import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type DataTablePayload, type DataTableSummary } from "../api";
import { useDashboard } from "../context/DashboardContext";
import { ErrorBanner } from "../components/ErrorBanner";

type SortDirection = "asc" | "desc";

function formatCell(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function cellSearchText(value: unknown): string {
  return formatCell(value).toLowerCase();
}

function compareValues(a: unknown, b: unknown): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  if (typeof a === "boolean" && typeof b === "boolean") {
    return Number(a) - Number(b);
  }
  return formatCell(a).localeCompare(formatCell(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function isLongColumn(column: string): boolean {
  return /content|fact|message|stack|value/i.test(column);
}

function filterRows(
  rows: Record<string, unknown>[],
  columns: string[],
  searchQuery: string,
  columnFilters: Record<string, string>,
): Record<string, unknown>[] {
  const query = searchQuery.trim().toLowerCase();
  const activeFilters = Object.entries(columnFilters).filter(
    ([, value]) => value.trim() !== "",
  );

  return rows.filter((row) => {
    if (query) {
      const matchesSearch = columns.some((column) =>
        cellSearchText(row[column]).includes(query),
      );
      if (!matchesSearch) return false;
    }

    for (const [column, filterValue] of activeFilters) {
      const needle = filterValue.trim().toLowerCase();
      if (!cellSearchText(row[column]).includes(needle)) return false;
    }

    return true;
  });
}

function sortRows(
  rows: Record<string, unknown>[],
  sortColumn: string | null,
  sortDirection: SortDirection,
): Record<string, unknown>[] {
  if (!sortColumn) return rows;
  const sorted = [...rows];
  sorted.sort((left, right) => {
    const cmp = compareValues(left[sortColumn], right[sortColumn]);
    return sortDirection === "asc" ? cmp : -cmp;
  });
  return sorted;
}

export function DataPage() {
  const { apiOnline } = useDashboard();
  const [tables, setTables] = useState<DataTableSummary[]>([]);
  const [activeTable, setActiveTable] = useState<string | null>(null);
  const [payload, setPayload] = useState<DataTablePayload | null>(null);
  const [loadingMeta, setLoadingMeta] = useState(false);
  const [loadingTable, setLoadingTable] = useState(false);
  const [refreshingTable, setRefreshingTable] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>(
    {},
  );
  const [showColumnFilters, setShowColumnFilters] = useState(false);
  const [sortColumn, setSortColumn] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

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
    setSearchQuery("");
    setColumnFilters({});
    setShowColumnFilters(false);
    setSortColumn(null);
    setSortDirection("asc");
    void loadTable(activeTable);
  }, [activeTable, loadTable]);

  const refreshTable = useCallback(
    async (tableId: string) => {
      if (!apiOnline) return;
      setRefreshingTable(tableId);
      setError(null);
      try {
        const [meta, data] = await Promise.all([
          api.getDataTables(),
          api.getDataTable(tableId),
        ]);
        setTables(meta.tables);
        setActiveTable(tableId);
        setPayload(data);
      } catch (err) {
        setError(err);
        if (activeTable === tableId) setPayload(null);
      } finally {
        setRefreshingTable(null);
      }
    },
    [apiOnline, activeTable],
  );

  const activeSummary = tables.find((t) => t.id === activeTable);
  const isTableLoading =
    loadingTable || (activeTable != null && refreshingTable === activeTable);

  const displayedRows = useMemo(() => {
    if (!payload) return [];
    const filtered = filterRows(
      payload.rows,
      payload.columns,
      searchQuery,
      columnFilters,
    );
    return sortRows(filtered, sortColumn, sortDirection);
  }, [payload, searchQuery, columnFilters, sortColumn, sortDirection]);

  const hasActiveFilters =
    searchQuery.trim() !== "" ||
    Object.values(columnFilters).some((value) => value.trim() !== "");

  const toggleSort = (column: string) => {
    if (sortColumn !== column) {
      setSortColumn(column);
      setSortDirection("asc");
      return;
    }
    if (sortDirection === "asc") {
      setSortDirection("desc");
      return;
    }
    setSortColumn(null);
    setSortDirection("asc");
  };

  const clearFilters = () => {
    setSearchQuery("");
    setColumnFilters({});
  };

  const updateColumnFilter = (column: string, value: string) => {
    setColumnFilters((current) => {
      if (!value.trim()) {
        const next = { ...current };
        delete next[column];
        return next;
      }
      return { ...current, [column]: value };
    });
  };

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
              <div
                key={table.id}
                className={
                  activeTable === table.id
                    ? "data-tab-item active"
                    : "data-tab-item"
                }
              >
                <button
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
                <button
                  type="button"
                  className="secondary data-tab-refresh"
                  aria-label={`Refresh ${table.label}`}
                  title={`Refresh ${table.label}`}
                  disabled={refreshingTable === table.id || !apiOnline}
                  onClick={() => void refreshTable(table.id)}
                >
                  {refreshingTable === table.id ? "…" : "↻"}
                </button>
              </div>
            ))}
          </div>

          <section className="card data-card">
            <div className="data-card-header">
              <h3>{activeSummary?.label ?? "Table"}</h3>
              {payload ? (
                <p className="hint data-card-meta">
                  {hasActiveFilters
                    ? `${displayedRows.length} of ${payload.rows.length} loaded row${
                        payload.rows.length === 1 ? "" : "s"
                      }`
                    : `${payload.total} row${payload.total === 1 ? "" : "s"}`}
                  {payload.truncated
                    ? ` — newest ${payload.rows.length} loaded`
                    : null}
                </p>
              ) : null}
            </div>

            {isTableLoading ? <p className="hint">Loading rows…</p> : null}

            {!isTableLoading && payload && payload.rows.length === 0 ? (
              <p className="hint">No rows in this table.</p>
            ) : null}

            {!isTableLoading && payload && payload.rows.length > 0 ? (
              <>
                <div className="data-toolbar">
                  <label className="data-search">
                    <span className="sr-only">Search table</span>
                    <input
                      type="search"
                      placeholder="Search all columns…"
                      value={searchQuery}
                      onChange={(event) => setSearchQuery(event.target.value)}
                    />
                  </label>
                  <button
                    type="button"
                    className={
                      showColumnFilters ? "secondary active" : "secondary"
                    }
                    onClick={() => setShowColumnFilters((current) => !current)}
                  >
                    Column filters
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={!hasActiveFilters}
                    onClick={clearFilters}
                  >
                    Clear
                  </button>
                </div>

                {displayedRows.length === 0 ? (
                  <p className="hint">No rows match the current search or filters.</p>
                ) : (
                  <div className="data-table-wrap">
                    <table className="data-table">
                      <thead>
                        <tr>
                          {payload.columns.map((column) => {
                            const isSorted = sortColumn === column;
                            return (
                              <th key={column} scope="col">
                                <button
                                  type="button"
                                  className={
                                    isSorted
                                      ? "data-sort-button active"
                                      : "data-sort-button"
                                  }
                                  aria-sort={
                                    isSorted
                                      ? sortDirection === "asc"
                                        ? "ascending"
                                        : "descending"
                                      : "none"
                                  }
                                  onClick={() => toggleSort(column)}
                                >
                                  <span>{column}</span>
                                  <span
                                    className="data-sort-indicator"
                                    aria-hidden
                                  >
                                    {isSorted
                                      ? sortDirection === "asc"
                                        ? "↑"
                                        : "↓"
                                      : "↕"}
                                  </span>
                                </button>
                              </th>
                            );
                          })}
                        </tr>
                        {showColumnFilters ? (
                          <tr className="data-filter-row">
                            {payload.columns.map((column) => (
                              <th key={column}>
                                <input
                                  type="search"
                                  className="data-col-filter"
                                  placeholder="Filter…"
                                  value={columnFilters[column] ?? ""}
                                  onChange={(event) =>
                                    updateColumnFilter(
                                      column,
                                      event.target.value,
                                    )
                                  }
                                  aria-label={`Filter ${column}`}
                                />
                              </th>
                            ))}
                          </tr>
                        ) : null}
                      </thead>
                      <tbody>
                        {displayedRows.map((row, index) => (
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
                )}
              </>
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
