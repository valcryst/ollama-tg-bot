import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type GroupMemoryFact, type UserMemoryFact } from "../api";
import { ErrorBanner } from "./ErrorBanner";

export type MemoryKind = "user" | "group";

interface MemoriesPanelProps {
  apiOnline: boolean;
  kind: MemoryKind;
  /** When true, skip outer card chrome (used on dedicated page). */
  embedded?: boolean;
}

type UserGroup = {
  userId: string;
  facts: UserMemoryFact[];
};

type ChatGroup = {
  groupId: string;
  facts: GroupMemoryFact[];
};

const COPY: Record<
  MemoryKind,
  {
    title: string;
    desc: string;
    offlineDesc: string;
    entityLabel: string;
    entityIdKey: "userId" | "groupId";
    clearLabel: string;
    confirmClear: (id: string, count: number) => string;
    addHint: string;
  }
> = {
  user: {
    title: "User memories",
    desc: "View and edit facts stored per Telegram user.",
    offlineDesc: "Facts the bot learned from Telegram users.",
    entityLabel: "User",
    entityIdKey: "userId",
    clearLabel: "Clear user",
    confirmClear: (id, count) =>
      `Remove all ${count} memories for user ${id}?`,
    addHint: "Add a fact for a user that already has memories in this list.",
  },
  group: {
    title: "Group memories",
    desc: "View and edit facts stored per Telegram group.",
    offlineDesc: "Facts the bot learned from Telegram groups.",
    entityLabel: "Chat",
    entityIdKey: "groupId",
    clearLabel: "Clear group",
    confirmClear: (id, count) =>
      `Remove all ${count} memories for group ${id}?`,
    addHint: "Add a fact for a group that already has memories in this list.",
  },
};

export function MemoriesPanel({
  apiOnline,
  kind,
  embedded = false,
}: MemoriesPanelProps) {
  const copy = COPY[kind];
  const [userFacts, setUserFacts] = useState<UserMemoryFact[]>([]);
  const [groupFacts, setGroupFacts] = useState<GroupMemoryFact[]>([]);
  const facts = kind === "user" ? userFacts : groupFacts;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [clearingId, setClearingId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<number | "new" | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [addEntityId, setAddEntityId] = useState("");
  const [addFactText, setAddFactText] = useState("");

  const load = useCallback(async () => {
    if (!apiOnline) return;
    setLoading(true);
    setError(null);
    try {
      if (kind === "user") {
        const data = await api.getMemories();
        setUserFacts(data.facts);
      } else {
        const data = await api.getGroupMemories();
        setGroupFacts(data.facts);
      }
    } catch (err) {
      setError(err);
      if (kind === "user") setUserFacts([]);
      else setGroupFacts([]);
    } finally {
      setLoading(false);
    }
  }, [apiOnline, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  const userGroups = useMemo((): UserGroup[] => {
    const map = new Map<string, UserMemoryFact[]>();
    for (const fact of userFacts) {
      const list = map.get(fact.userId) ?? [];
      list.push(fact);
      map.set(fact.userId, list);
    }
    return [...map.entries()]
      .map(([userId, userGroupFacts]) => ({ userId, facts: userGroupFacts }))
      .sort((a, b) => a.userId.localeCompare(b.userId));
  }, [userFacts]);

  const chatGroups = useMemo((): ChatGroup[] => {
    const map = new Map<string, GroupMemoryFact[]>();
    for (const fact of groupFacts) {
      const list = map.get(fact.groupId) ?? [];
      list.push(fact);
      map.set(fact.groupId, list);
    }
    return [...map.entries()]
      .map(([groupId, groupGroupFacts]) => ({
        groupId,
        facts: groupGroupFacts,
      }))
      .sort((a, b) => a.groupId.localeCompare(b.groupId));
  }, [groupFacts]);

  const entityIds = useMemo(
    () =>
      kind === "user"
        ? userGroups.map((g) => g.userId)
        : chatGroups.map((g) => g.groupId),
    [kind, userGroups, chatGroups],
  );

  useEffect(() => {
    if (entityIds.length === 0) {
      setAddEntityId("");
      return;
    }
    if (!addEntityId || !entityIds.includes(addEntityId)) {
      setAddEntityId(entityIds[0]);
    }
  }, [entityIds, addEntityId]);

  const upsertUserFact = (record: UserMemoryFact) => {
    setUserFacts((prev) => {
      const idx = prev.findIndex((f) => f.id === record.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = record;
        return next;
      }
      return [...prev, record].sort(
        (a, b) =>
          a.userId.localeCompare(b.userId) || a.id - b.id,
      );
    });
  };

  const upsertGroupFact = (record: GroupMemoryFact) => {
    setGroupFacts((prev) => {
      const idx = prev.findIndex((f) => f.id === record.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = record;
        return next;
      }
      return [...prev, record].sort(
        (a, b) =>
          a.groupId.localeCompare(b.groupId) || a.id - b.id,
      );
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
      if (kind === "user") {
        const { fact } = await api.updateMemory(id, trimmed);
        upsertUserFact(fact);
      } else {
        const { fact } = await api.updateGroupMemory(id, trimmed);
        upsertGroupFact(fact);
      }
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
    if (!addEntityId || trimmed.length < 2) return;

    setSavingId("new");
    try {
      if (kind === "user") {
        const { fact } = await api.createMemory(addEntityId, trimmed);
        upsertUserFact(fact);
      } else {
        const { fact } = await api.createGroupMemory(addEntityId, trimmed);
        upsertGroupFact(fact);
      }
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
      if (kind === "user") {
        await api.deleteMemory(id);
        setUserFacts((prev) => prev.filter((f) => f.id !== id));
      } else {
        await api.deleteGroupMemory(id);
        setGroupFacts((prev) => prev.filter((f) => f.id !== id));
      }
      if (editingId === id) cancelEdit();
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setDeletingId(null);
    }
  };

  const clearEntity = async (entityId: string) => {
    const count =
      kind === "user"
        ? (userGroups.find((g) => g.userId === entityId)?.facts.length ?? 0)
        : (chatGroups.find((g) => g.groupId === entityId)?.facts.length ?? 0);
    if (!confirm(copy.confirmClear(entityId, count))) return;

    setClearingId(entityId);
    try {
      if (kind === "user") {
        await api.clearUserMemories(entityId);
        setUserFacts((prev) => prev.filter((f) => f.userId !== entityId));
      } else {
        await api.clearGroupMemories(entityId);
        setGroupFacts((prev) => prev.filter((f) => f.groupId !== entityId));
      }
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setClearingId(null);
    }
  };

  const renderFactActions = (
    item: UserMemoryFact | GroupMemoryFact,
    isEditing: boolean,
  ) => {
    if (isEditing) {
      return (
        <div className="memory-item-actions">
          <button
            type="button"
            className="primary"
            disabled={savingId === item.id || editText.trim().length < 2}
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
        </div>
      );
    }

    return (
      <div className="memory-item-actions">
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
      </div>
    );
  };

  const renderFactItem = (item: UserMemoryFact | GroupMemoryFact) => {
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
        {renderFactActions(item, isEditing)}
      </li>
    );
  };

  if (!apiOnline) {
    return (
      <section className={embedded ? "page-block" : "card memories-card"}>
        {!embedded ? (
          <h2>{copy.title}</h2>
        ) : (
          <header className="page-header">
            <h2>{copy.title}</h2>
            <p className="page-desc">{copy.offlineDesc}</p>
          </header>
        )}
        <p className="hint">API must be online to view stored memories.</p>
      </section>
    );
  }

  const header = embedded ? (
    <header className="page-header memories-page-header">
      <div>
        <h2>{copy.title}</h2>
        <p className="page-desc">
          {copy.desc} {facts.length} total.
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
        <h2>{copy.title}</h2>
        <p className="hint">
          {copy.desc} {facts.length} total.
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

      {entityIds.length > 0 ? (
        <form
          className="memory-add-form"
          onSubmit={(e) => {
            e.preventDefault();
            void addFact();
          }}
        >
          <p className="hint memory-add-hint">{copy.addHint}</p>
          <div className="memory-add-row">
            <label className="memory-add-field">
              <span>{copy.entityLabel} ID</span>
              <select
                value={addEntityId}
                onChange={(e) => setAddEntityId(e.target.value)}
              >
                {entityIds.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
            </label>
            <label className="memory-add-field memory-add-fact-field">
              <span>Fact</span>
              <input
                type="text"
                value={addFactText}
                onChange={(e) => setAddFactText(e.target.value)}
                placeholder="New fact to store…"
                maxLength={500}
              />
            </label>
            <button
              type="submit"
              className="primary"
              disabled={
                savingId === "new" ||
                addFactText.trim().length < 2 ||
                !addEntityId
              }
            >
              {savingId === "new" ? "…" : "Add"}
            </button>
          </div>
        </form>
      ) : null}

      {loading && facts.length === 0 ? (
        <p className="hint">Loading memories…</p>
      ) : null}

      {!loading && facts.length === 0 && error == null ? (
        <p className="hint">
          No memories stored yet. Chat with the bot first so user/group IDs
          appear here.
        </p>
      ) : null}

      <div className="memory-groups">
        {kind === "user"
          ? userGroups.map((group) => (
              <div key={group.userId} className="memory-group">
                <div className="memory-group-head">
                  <span className="memory-user">
                    {copy.entityLabel} <code>{group.userId}</code>
                    <span className="label-meta"> ({group.facts.length})</span>
                  </span>
                  <button
                    type="button"
                    className="secondary danger-btn"
                    disabled={clearingId === group.userId}
                    onClick={() => void clearEntity(group.userId)}
                  >
                    {clearingId === group.userId ? "…" : copy.clearLabel}
                  </button>
                </div>
                <ul className="memory-list">
                  {group.facts.map((item) => renderFactItem(item))}
                </ul>
              </div>
            ))
          : chatGroups.map((group) => (
              <div key={group.groupId} className="memory-group">
                <div className="memory-group-head">
                  <span className="memory-user">
                    {copy.entityLabel} <code>{group.groupId}</code>
                    <span className="label-meta"> ({group.facts.length})</span>
                  </span>
                  <button
                    type="button"
                    className="secondary danger-btn"
                    disabled={clearingId === group.groupId}
                    onClick={() => void clearEntity(group.groupId)}
                  >
                    {clearingId === group.groupId ? "…" : copy.clearLabel}
                  </button>
                </div>
                <ul className="memory-list">
                  {group.facts.map((item) => renderFactItem(item))}
                </ul>
              </div>
            ))}
      </div>
    </section>
  );
}
