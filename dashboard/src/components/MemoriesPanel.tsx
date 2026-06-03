import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type UserMemoryFact } from "../api";
import { ErrorBanner } from "./ErrorBanner";

interface MemoriesPanelProps {
  apiOnline: boolean;
  /** When true, skip outer card chrome (used on dedicated page). */
  embedded?: boolean;
}

type UserGroup = {
  userId: string;
  facts: UserMemoryFact[];
};

export function MemoriesPanel({ apiOnline, embedded = false }: MemoriesPanelProps) {
  const [facts, setFacts] = useState<UserMemoryFact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [clearingUserId, setClearingUserId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!apiOnline) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getMemories();
      setFacts(data.facts);
    } catch (err) {
      setError(err);
      setFacts([]);
    } finally {
      setLoading(false);
    }
  }, [apiOnline]);

  useEffect(() => {
    void load();
  }, [load]);

  const groups = useMemo((): UserGroup[] => {
    const map = new Map<string, UserMemoryFact[]>();
    for (const fact of facts) {
      const list = map.get(fact.userId) ?? [];
      list.push(fact);
      map.set(fact.userId, list);
    }
    return [...map.entries()]
      .map(([userId, userFacts]) => ({ userId, facts: userFacts }))
      .sort((a, b) => a.userId.localeCompare(b.userId));
  }, [facts]);

  const removeFact = async (id: number) => {
    setDeletingId(id);
    try {
      await api.deleteMemory(id);
      setFacts((prev) => prev.filter((f) => f.id !== id));
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setDeletingId(null);
    }
  };

  const clearUser = async (userId: string) => {
    if (!confirm(`Remove all ${groups.find((g) => g.userId === userId)?.facts.length ?? 0} memories for user ${userId}?`)) {
      return;
    }
    setClearingUserId(userId);
    try {
      await api.clearUserMemories(userId);
      setFacts((prev) => prev.filter((f) => f.userId !== userId));
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setClearingUserId(null);
    }
  };

  if (!apiOnline) {
    return (
      <section className={embedded ? "page-block" : "card memories-card"}>
        {!embedded ? <h2>User memories</h2> : (
          <header className="page-header">
            <h2>User memories</h2>
            <p className="page-desc">
              Facts the bot learned from Telegram users.
            </p>
          </header>
        )}
        <p className="hint">API must be online to view stored memories.</p>
      </section>
    );
  }

  const header = embedded ? (
    <header className="page-header memories-page-header">
      <div>
        <h2>User memories</h2>
        <p className="page-desc">
          Facts the bot learned from Telegram users (from [MEMORY] blocks).{" "}
          {facts.length} total.
        </p>
      </div>
      <button
        type="button"
        className="secondary"
        onClick={() => void load()}
        disabled={loading}
      >
        {loading ? "…" : "Refresh"}
      </button>
    </header>
  ) : (
    <div className="memories-header">
      <div>
        <h2>User memories</h2>
        <p className="hint">
          Facts the bot learned from Telegram users (from [MEMORY] blocks).{" "}
          {facts.length} total.
        </p>
      </div>
      <button
        type="button"
        className="secondary"
        onClick={() => void load()}
        disabled={loading}
      >
        {loading ? "…" : "Refresh"}
      </button>
    </div>
  );

  return (
    <section className={embedded ? "page-block" : "card memories-card"}>
      {header}

      {error != null ? (
        <ErrorBanner
          error={error}
          compact
          onRetry={() => void load()}
          onDismiss={() => setError(null)}
        />
      ) : null}

      {loading && facts.length === 0 ? (
        <p className="hint">Loading memories…</p>
      ) : null}

      {!loading && facts.length === 0 && error == null ? (
        <p className="hint">No memories stored yet.</p>
      ) : null}

      <div className="memory-groups">
        {groups.map((group) => (
          <div key={group.userId} className="memory-group">
            <div className="memory-group-head">
              <span className="memory-user">
                User <code>{group.userId}</code>
                <span className="label-meta"> ({group.facts.length})</span>
              </span>
              <button
                type="button"
                className="secondary danger-btn"
                disabled={clearingUserId === group.userId}
                onClick={() => void clearUser(group.userId)}
              >
                {clearingUserId === group.userId ? "…" : "Clear user"}
              </button>
            </div>
            <ul className="memory-list">
              {group.facts.map((item) => (
                <li key={item.id} className="memory-item">
                  <div className="memory-item-body">
                    <p className="memory-fact">{item.fact}</p>
                    <time className="memory-time" dateTime={item.createdAt}>
                      {new Date(item.createdAt).toLocaleString()}
                    </time>
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    title="Delete this memory"
                    disabled={deletingId === item.id}
                    onClick={() => void removeFact(item.id)}
                  >
                    {deletingId === item.id ? "…" : "Remove"}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

    </section>
  );
}
