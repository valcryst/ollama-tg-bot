import { useDashboard } from "../context/DashboardContext";
import { ErrorBanner } from "../components/ErrorBanner";

export function CharacterPage() {
  const {
    settings,
    draft,
    setDraft,
    sectionErrors,
    setSectionError,
    configBlocked,
    saving,
    save,
    load,
  } = useDashboard();

  return (
    <div className="page">
      <header className="page-header">
        <h2>Character</h2>
        <p className="page-desc">
          How the bot speaks and behaves — system prompts applied to every reply.
        </p>
      </header>

      <section className="card">
        {sectionErrors.settings != null ? (
          <ErrorBanner
            error={sectionErrors.settings}
            compact
            onRetry={() => void load()}
          />
        ) : null}

        {draft ? (
          <fieldset disabled={configBlocked} className="form-fieldset">
            <div className="field">
              <label>Default system prompt</label>
              <pre className="prompt-preview">
                {draft.baseSystemPrompt ?? settings?.baseSystemPrompt ?? "…"}
              </pre>
              <p className="hint">
                Built into the bot and always applied. Use the custom prompt
                below to layer personality, tone, and extra rules on top.
              </p>
            </div>

            <div className="field">
              <label htmlFor="prompt">Custom system prompt</label>
              <textarea
                id="prompt"
                rows={8}
                value={draft.customSystemPrompt}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    customSystemPrompt: e.target.value,
                  })
                }
                placeholder="Optional: personality, topics, extra rules…"
              />
              <p className="hint">
                Appended after the default prompt. Leave empty to use only the
                built-in behavior.
              </p>
            </div>

            {sectionErrors.save != null ? (
              <ErrorBanner
                error={sectionErrors.save}
                compact
                onDismiss={() => setSectionError("save", null)}
              />
            ) : null}

            <div className="actions">
              <button
                type="button"
                onClick={() => void save()}
                disabled={saving || !draft || configBlocked}
              >
                {saving ? "Saving…" : "Save character"}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => settings && setDraft(settings)}
                disabled={!settings}
              >
                Reset
              </button>
            </div>
          </fieldset>
        ) : (
          !sectionErrors.settings && (
            <p className="hint">No settings loaded.</p>
          )
        )}
      </section>
    </div>
  );
}
