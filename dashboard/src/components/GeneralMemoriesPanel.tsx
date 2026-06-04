import { useCallback, useEffect, useState } from "react";
import { api, type GeneralMemoryFact } from "../api";
import { ErrorBanner } from "./ErrorBanner";

interface GeneralMemoriesPanelProps {
  apiOnline: boolean;
  embedded?: boolean;
}

export function GeneralMemoriesPanel({
  apiOnline,
  embedded = false,
}: GeneralMemoriesPanelProps) {
  const [facts, setFacts] = useState<GeneralMemoryFact[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [clearing, setClearing] = useState(false);
  const [savingId, setSavingId] = useState<number | "new" | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [addFactText, setAddFactText] = useState("");

  const load = useCallback(async () => {
    if (!apiOnline) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.getGeneralMemories();
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

  const upsertFact = (record: GeneralMemoryFact) => {
    setFacts((prev) => {
      const idx = prev.findIndex((f) => f.id === record.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = record;
        return next;
      }
      return [...prev, record].sort((a, b) => a.id - b.id);
    });
  };

  const startEdit = (id: number, fact: string) => {
    setEditingId(id);
    setEditText(fact);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditText("");
  };

  const saveEdit = async (id: number) => {
    const trimmed = editText.trim();
    if (trimmed.length < 2) return;

    setSavingId(id);
    try {
      const { fact } = await api.updateGeneralMemory(id, trimmed);
      upsertFact(fact);
      cancelEdit();
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setSavingId(null);
    }
  };

  const addFact = async () => {
    const trimmed = addFactText.trim();
    if (trimmed.length < 2) return;

    setSavingId("new");
    try {
      const { fact } = await api.createGeneralMemory(trimmed);
      upsertFact(fact);
      setAddFactText("");
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setSavingId(null);
    }
  };

  const removeFact = async (id: number) => {
    setDeletingId(id);
    try {
      await api.deleteGeneralMemory(id);
      setFacts((prev) => prev.filter((f) => f.id !== id));
      if (editingId === id) cancelEdit();
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setDeletingId(null);
    }
  };

  const clearAll = async () => {
    if (!confirm(`Remove all ${facts.length} general memories?`)) return;

    setClearing(true);
    try {
      await api.clearGeneralMemories();
      setFacts([]);
      cancelEdit();
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setClearing(false);
    }
  };

  if (!apiOnline) {
    return (
      <section className={embedded ? "page-block" : "card memories-card"}>
        {embedded ? (
          <header className="page-header">
            <h2>General memory</h2>
            <p className="page-desc">
              Shared facts, terms, and knowledge used in every chat.
            </p>
          </header>
        ) : (
          <h2>General memory</h2>
        )}
        <p className="hint">API must be online to view stored memories.</p>
      </section>
    );
  }

  const header = embedded ? (
    <header className="page-header memories-page-header">
      <div>
        <h2>General memory</h2>
        <p className="page-desc">
          Facts, terms, and knowledge shared across all chats. {facts.length}{" "}
          total.
        </p>
      </div>
      <div className="memories-header-actions">
        {facts.length > 0 ? (
          <button
            type="button"
            className="secondary danger-btn"
            disabled={clearing}
            onClick={() => void clearAll()}
          >
            {clearing ? "…" : "Clear all"}
          </button>
        ) : null}
        <button
          type="button"
          className="secondary"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? "…" : "Refresh"}
        </button>
      </div>
    </header>
  ) : (
    <div className="memories-header">
      <div>
        <h2>General memory</h2>
        <p className="hint">
          Facts, terms, and knowledge shared across all chats. {facts.length}{" "}
          total.
        </p>
      </div>
      <div className="memories-header-actions">
        {facts.length > 0 ? (
          <button
            type="button"
            className="secondary danger-btn"
            disabled={clearing}
            onClick={() => void clearAll()}
          >
            {clearing ? "…" : "Clear all"}
          </button>
        ) : null}
        <button
          type="button"
          className="secondary"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? "…" : "Refresh"}
        </button>
      </div>
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

      <form
        className="memory-add-form"
        onSubmit={(e) => {
          e.preventDefault();
          void addFact();
        }}
      >
        <p className="hint memory-add-hint">
          Add glossary terms, project facts, or standing instructions that apply
          everywhere.
        </p>
        <div className="memory-add-row">
          <label className="memory-add-field memory-add-fact-field">
            <span>Fact</span>
            <input
              type="text"
              value={addFactText}
              onChange={(e) => setAddFactText(e.target.value)}
              placeholder="e.g. API means Application Programming Interface here"
              maxLength={500}
            />
          </label>
          <button
            type="submit"
            className="primary"
            disabled={savingId === "new" || addFactText.trim().length < 2}
          >
            {savingId === "new" ? "…" : "Add"}
          </button>
        </div>
      </form>

      {loading && facts.length === 0 ? (
        <p className="hint">Loading memories…</p>
      ) : null}

      {!loading && facts.length === 0 && error == null ? (
        <p className="hint">
          No general memories yet. The bot can learn them from chat, or add facts
          above.
        </p>
      ) : null}

      {facts.length > 0 ? (
        <ul className="memory-list">
          {facts.map((item) => {
            const isEditing = editingId === item.id;
            return (
              <li key={item.id} className="memory-item">
                <div className="memory-item-body">
                  {isEditing ? (
                    <textarea
                      className="memory-edit-input"
                      rows={2}
                      value={editText}
                      onChange={(e) => setEditText(e.target.value)}
                      maxLength={500}
                    />
                  ) : (
                    <p className="memory-fact">{item.fact}</p>
                  )}
                  <time className="memory-time" dateTime={item.createdAt}>
                    {new Date(item.createdAt).toLocaleString()}
                  </time>
                </div>
                <div className="memory-item-actions">
                  {isEditing ? (
                    <>
                      <button
                        type="button"
                        className="primary"
                        disabled={
                          savingId === item.id || editText.trim().length < 2
                        }
                        onClick={() => void saveEdit(item.id)}
                      >
                        {savingId === item.id ? "…" : "Save"}
                      </button>
                      <button
                        type="button"
                        className="secondary"
                        disabled={savingId === item.id}
                        onClick={cancelEdit}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="secondary"
                        title="Edit this memory"
                        disabled={deletingId === item.id}
                        onClick={() => startEdit(item.id, item.fact)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="secondary danger-btn"
                        title="Delete this memory"
                        disabled={deletingId === item.id}
                        onClick={() => void removeFact(item.id)}
                      >
                        {deletingId === item.id ? "…" : "Remove"}
                      </button>
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
