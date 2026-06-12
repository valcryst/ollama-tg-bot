import { useCallback, useEffect, useState } from "react";
import {
  api,
  DEFAULT_MOOD_VALUES,
  MOOD_KEYS,
  type MoodKey,
  type MoodValues,
  type Personality,
} from "../api";
import { useDashboard } from "../context/DashboardContext";
import { useLiveMood, useLivePersonalities } from "../liveSocket";
import { ErrorBanner } from "../components/ErrorBanner";
import { SettingsNumberField } from "../SettingsNumberField";

export function CharacterPage() {
  const {
    settings,
    configBlocked,
    setDraft,
    setSectionError,
    sectionErrors,
  } = useDashboard();

  const [personalities, setPersonalities] = useState<Personality[]>([]);
  const [activeId, setActiveId] = useState(0);
  const [traitHints, setTraitHints] = useState<Record<MoodKey, string> | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [activatingId, setActivatingId] = useState<number | null>(null);
  const [savingId, setSavingId] = useState<number | "new" | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [editMoodDefaults, setEditMoodDefaults] =
    useState<MoodValues>(DEFAULT_MOOD_VALUES);
  const [newName, setNewName] = useState("");
  const [newPrompt, setNewPrompt] = useState("");
  const [newMoodDefaults, setNewMoodDefaults] =
    useState<MoodValues>(DEFAULT_MOOD_VALUES);

  const load = useCallback(
    async (silent = false) => {
      if (configBlocked) return;
      if (!silent) setLoading(true);
      setError(null);
      try {
        const [data, mood] = await Promise.all([
          api.getPersonalities(),
          api.getMood(),
        ]);
        setPersonalities(data.personalities);
        setActiveId(data.activePersonalityId);
        setTraitHints(mood.traitHints);
        setDraft((d) =>
          d ? { ...d, activePersonalityId: data.activePersonalityId } : d,
        );
      } catch (err) {
        setError(err);
        setPersonalities([]);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [configBlocked, setDraft],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useLivePersonalities(
    useCallback(() => {
      void load(true);
    }, [load]),
    !configBlocked,
  );

  useLiveMood(
    useCallback((mood) => {
      setTraitHints(mood.traitHints);
    }, []),
    !configBlocked,
  );

  async function activatePersonality(id: number) {
    setActivatingId(id);
    setSectionError("save", null);
    try {
      const updated = await api.updateSettings({ activePersonalityId: id });
      setActiveId(updated.activePersonalityId);
      setDraft(updated);
    } catch (err) {
      setSectionError("save", err);
    } finally {
      setActivatingId(null);
    }
  }

  function startEdit(personality: Personality) {
    setEditingId(personality.id);
    setEditName(personality.name);
    setEditPrompt(personality.prompt);
    setEditMoodDefaults({ ...personality.moodDefaults });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditName("");
    setEditPrompt("");
    setEditMoodDefaults({ ...DEFAULT_MOOD_VALUES });
  }

  async function saveEdit(id: number) {
    setSavingId(id);
    setSectionError("save", null);
    try {
      const { personality } = await api.updatePersonality(id, {
        name: editName,
        prompt: editPrompt,
        moodDefaults: editMoodDefaults,
      });
      setPersonalities((list) =>
        list.map((p) => (p.id === id ? personality : p)),
      );
      cancelEdit();
    } catch (err) {
      setSectionError("save", err);
    } finally {
      setSavingId(null);
    }
  }

  async function createPersonality() {
    const name = newName.trim();
    if (!name) return;
    setSavingId("new");
    setSectionError("save", null);
    try {
      const { personality } = await api.createPersonality(
        name,
        newPrompt,
        newMoodDefaults,
      );
      setPersonalities((list) => [...list, personality]);
      setNewName("");
      setNewPrompt("");
      setNewMoodDefaults({ ...DEFAULT_MOOD_VALUES });
      if (personalities.length === 0) {
        await activatePersonality(personality.id);
      }
    } catch (err) {
      setSectionError("save", err);
    } finally {
      setSavingId(null);
    }
  }

  async function removePersonality(id: number) {
    const personality = personalities.find((p) => p.id === id);
    if (!personality) return;
    if (!window.confirm(`Delete personality "${personality.name}"?`)) return;

    setDeletingId(id);
    setSectionError("save", null);
    try {
      const result = await api.deletePersonality(id);
      setPersonalities((list) => list.filter((p) => p.id !== id));
      setActiveId(result.activePersonalityId);
      setDraft((d) =>
        d ? { ...d, activePersonalityId: result.activePersonalityId } : d,
      );
      if (editingId === id) cancelEdit();
    } catch (err) {
      setSectionError("save", err);
    } finally {
      setDeletingId(null);
    }
  }

  function renderMoodDefaults(
    idPrefix: string,
    values: MoodValues,
    onChange: (next: MoodValues) => void,
    disabled: boolean,
  ) {
    return (
      <div className="personality-mood-section">
        <h5>Mood defaults</h5>
        <p className="hint">
          Baseline mood (0–5 per trait). Global mood drifts back to these values
          when this character is active.
        </p>
        <div className="mood-grid">
          {MOOD_KEYS.map((key) => (
            <SettingsNumberField
              key={key}
              id={`${idPrefix}-${key}`}
              label={key}
              hint={traitHints?.[key]}
              value={values[key]}
              min={0}
              max={5}
              step={1}
              variant="slider"
              disabled={disabled}
              onChange={(value) => onChange({ ...values, [key]: value })}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <header className="page-header">
        <h2>Character</h2>
        <p className="page-desc">
          Manage multiple personalities and choose which one the bot uses for
          every reply. Each character has its own mood default baselines.
        </p>
      </header>

      <section className="card">
        <div className="field">
          <label>Default system prompt</label>
          <pre className="prompt-preview">
            {settings?.baseSystemPrompt ?? "…"}
          </pre>
          <p className="hint">
            Always applied. Each personality below adds tone, role, and extra
            rules on top of this base.
          </p>
        </div>
      </section>

      <section className="card">
        <div className="section-head">
          <h3 className="section-title">Personalities</h3>
        </div>

        {error != null ? (
          <ErrorBanner
            error={error}
            compact
            onRetry={() => void load()}
            onDismiss={() => setError(null)}
          />
        ) : null}

        {sectionErrors.save != null ? (
          <ErrorBanner
            error={sectionErrors.save}
            compact
            onDismiss={() => setSectionError("save", null)}
          />
        ) : null}

        {personalities.length === 0 && !loading ? (
          <p className="hint">
            No personalities yet — the bot uses only the base system prompt.
            Create one below when you want a custom character layer.
          </p>
        ) : activeId === 0 && !loading ? (
          <p className="hint">
            No active personality — the bot uses only the base system prompt.
          </p>
        ) : null}

        <div className="personality-list">
          {personalities.map((personality) => {
            const isActive = personality.id === activeId;
            const isEditing = editingId === personality.id;

            return (
              <article
                key={personality.id}
                className={`personality-card${isActive ? " personality-card-active" : ""}`}
              >
                <div className="personality-card-head">
                  <div className="personality-card-title">
                    {isEditing ? (
                      <input
                        type="text"
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        disabled={configBlocked}
                        aria-label="Personality name"
                      />
                    ) : (
                      <h4>{personality.name}</h4>
                    )}
                    {isActive ? (
                      <span className="badge badge-ok">Active</span>
                    ) : null}
                  </div>

                  <div className="personality-card-actions">
                    {!isActive ? (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => void activatePersonality(personality.id)}
                        disabled={
                          configBlocked || activatingId === personality.id
                        }
                      >
                        {activatingId === personality.id
                          ? "Activating…"
                          : "Use this"}
                      </button>
                    ) : null}
                    {isEditing ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void saveEdit(personality.id)}
                          disabled={
                            configBlocked ||
                            savingId === personality.id ||
                            !editName.trim()
                          }
                        >
                          {savingId === personality.id ? "Saving…" : "Save"}
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          onClick={cancelEdit}
                          disabled={savingId === personality.id}
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => startEdit(personality)}
                        disabled={configBlocked}
                      >
                        Edit
                      </button>
                    )}
                    <button
                      type="button"
                      className="secondary danger-btn"
                      onClick={() => void removePersonality(personality.id)}
                      disabled={
                        configBlocked || deletingId === personality.id
                      }
                    >
                      {deletingId === personality.id ? "Deleting…" : "Delete"}
                    </button>
                  </div>
                </div>

                {isEditing ? (
                  <>
                    <textarea
                      rows={8}
                      value={editPrompt}
                      onChange={(e) => setEditPrompt(e.target.value)}
                      disabled={configBlocked}
                      placeholder="Personality, tone, topics, extra rules…"
                    />
                    {renderMoodDefaults(
                      `edit-${personality.id}`,
                      editMoodDefaults,
                      setEditMoodDefaults,
                      configBlocked || savingId === personality.id,
                    )}
                  </>
                ) : (
                  <>
                    <pre className="personality-prompt-preview">
                      {personality.prompt.trim() || "(empty — base prompt only)"}
                    </pre>
                    <p className="hint mood-inline-summary">
                      Mood defaults:{" "}
                      <span className="mood-summary">
                        {MOOD_KEYS.map((key) => (
                          <span key={key} title={traitHints?.[key]}>
                            {key.slice(0, 3)}:{personality.moodDefaults[key]}
                          </span>
                        ))}
                      </span>
                    </p>
                  </>
                )}
              </article>
            );
          })}
        </div>

        <div className="personality-create">
          <h4 className="section-title">New personality</h4>
          <div className="field">
            <label htmlFor="new-personality-name">Name</label>
            <input
              id="new-personality-name"
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              disabled={configBlocked}
              placeholder="e.g. Friendly helper"
            />
          </div>
          <div className="field">
            <label htmlFor="new-personality-prompt">Custom prompt</label>
            <textarea
              id="new-personality-prompt"
              rows={6}
              value={newPrompt}
              onChange={(e) => setNewPrompt(e.target.value)}
              disabled={configBlocked}
              placeholder="Personality, tone, topics, extra rules…"
            />
          </div>
          {renderMoodDefaults(
            "new",
            newMoodDefaults,
            setNewMoodDefaults,
            configBlocked || savingId === "new",
          )}
          <button
            type="button"
            onClick={() => void createPersonality()}
            disabled={configBlocked || savingId === "new" || !newName.trim()}
          >
            {savingId === "new" ? "Creating…" : "Create personality"}
          </button>
        </div>
      </section>
    </div>
  );
}
