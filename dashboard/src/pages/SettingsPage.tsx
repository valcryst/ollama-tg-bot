import { useDashboard } from "../context/DashboardContext";
import { ErrorBanner } from "../components/ErrorBanner";
import { SettingsNumberField } from "../SettingsNumberField";

export function SettingsPage() {
  const {
    settings,
    draft,
    setDraft,
    models,
    sectionErrors,
    setSectionError,
    configBlocked,
    showModelSelection,
    modelOptions,
    verifiedOllamaHost,
    testingOllama,
    modelsLoading,
    saving,
    testOllamaConnection,
    invalidateOllamaVerification,
    fetchModelsForHost,
    save,
    load,
  } = useDashboard();

  return (
    <div className="page">
      <header className="page-header">
        <h2>Settings</h2>
        <p className="page-desc">
          Ollama connection, model, and performance limits.
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
              <label htmlFor="host">Ollama host</label>
              <div className="field row">
                <input
                  id="host"
                  className="grow"
                  value={draft.ollamaHost}
                  onChange={(e) => {
                    const ollamaHost = e.target.value;
                    invalidateOllamaVerification(ollamaHost);
                    setDraft({ ...draft, ollamaHost });
                  }}
                  placeholder="http://localhost:11434"
                />
                <button
                  type="button"
                  className="secondary"
                  onClick={() => void testOllamaConnection()}
                  disabled={testingOllama || modelsLoading || configBlocked}
                >
                  {testingOllama ? "Testing…" : "Test connection"}
                </button>
              </div>
              {sectionErrors.ollama != null ? (
                <ErrorBanner
                  error={sectionErrors.ollama}
                  compact
                  onRetry={() => void testOllamaConnection()}
                  onDismiss={() => setSectionError("ollama", null)}
                />
              ) : null}
              {showModelSelection ? (
                <p className="hint success-inline">
                  Connected to Ollama at {verifiedOllamaHost}
                </p>
              ) : (
                <p className="hint">
                  Enter your Ollama API URL and test the connection before
                  choosing a model.
                </p>
              )}
            </div>

            {showModelSelection ? (
              <>
                <div className="field row">
                  <div className="grow">
                    <label htmlFor="model">
                      Model
                      {models.length > 0 && (
                        <span className="label-meta">
                          {models.length} pulled locally
                        </span>
                      )}
                    </label>
                    <select
                      id="model"
                      value={
                        modelOptions.some((o) => o.value === draft.model)
                          ? draft.model
                          : (modelOptions[0]?.value ?? "")
                      }
                      onChange={(e) =>
                        setDraft({ ...draft, model: e.target.value })
                      }
                      disabled={modelsLoading}
                    >
                      {modelOptions.length === 0 ? (
                        <option value="" disabled>
                          {modelsLoading ? "Loading models…" : "No models found"}
                        </option>
                      ) : (
                        modelOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))
                      )}
                    </select>
                  </div>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() =>
                      verifiedOllamaHost &&
                      void fetchModelsForHost(verifiedOllamaHost)
                    }
                    disabled={modelsLoading || configBlocked}
                    title="Fetch models from Ollama (ollama list)"
                  >
                    {modelsLoading ? "…" : "Refresh"}
                  </button>
                </div>

                {sectionErrors.models != null ? (
                  <ErrorBanner
                    error={sectionErrors.models}
                    compact
                    onRetry={() =>
                      verifiedOllamaHost &&
                      void fetchModelsForHost(verifiedOllamaHost)
                    }
                    onDismiss={() => setSectionError("models", null)}
                  />
                ) : null}

                {!modelsLoading &&
                  models.length === 0 &&
                  sectionErrors.models == null && (
                    <p className="hint warn">
                      No models on this host. Pull one with{" "}
                      <code>ollama pull llama3.2</code>, then Refresh.
                    </p>
                  )}

                <p className="hint">
                  Use a vision model (e.g. llava) for images and stickers.
                </p>
              </>
            ) : null}

            <div className="field toggle-row">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={draft.randomReplyEnabled}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      randomReplyEnabled: e.target.checked,
                    })
                  }
                />
                Random replies in group chats
              </label>
            </div>

            {draft.randomReplyEnabled && (
              <div className="field">
                <label htmlFor="chance">
                  Random reply chance ({draft.randomReplyChance}%)
                </label>
                <input
                  id="chance"
                  type="range"
                  min={0}
                  max={100}
                  value={draft.randomReplyChance}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      randomReplyChance: Number(e.target.value),
                    })
                  }
                />
              </div>
            )}

            <div className="field toggle-row">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={draft.reactToEveryImage}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      reactToEveryImage: e.target.checked,
                    })
                  }
                />
                React to every image
              </label>
              <p className="hint">
                In group chats, comment on photos and image files even when
                they are not addressed to the bot (requires a vision model).
              </p>
            </div>

            <h3 className="section-title">Ollama performance</h3>
            <p className="hint section-hint">
              Lower values = faster replies. Takes effect on the next message.
            </p>

            <SettingsNumberField
              id="numPredict"
              label="Max reply tokens (num_predict)"
              hint="Hard cap on generated length. Use 512+ for structured replies; lower = faster but may truncate."
              value={draft.numPredict}
              min={32}
              max={2048}
              variant="slider"
              disabled={configBlocked}
              onChange={(numPredict) => setDraft({ ...draft, numPredict })}
            />
            <SettingsNumberField
              id="numCtx"
              label="Context size (num_ctx)"
              hint="Larger = more history fits but slower prefill."
              value={draft.numCtx}
              min={2048}
              max={32768}
              step={512}
              variant="slider"
              disabled={configBlocked}
              onChange={(numCtx) => setDraft({ ...draft, numCtx })}
            />
            <SettingsNumberField
              id="temperature"
              label="Temperature"
              value={draft.temperature}
              min={0}
              max={2}
              step={0.1}
              variant="slider"
              disabled={configBlocked}
              onChange={(temperature) => setDraft({ ...draft, temperature })}
            />
            <SettingsNumberField
              id="chatTimeoutSec"
              label="Request timeout (seconds)"
              value={draft.chatTimeoutSec}
              min={30}
              max={600}
              variant="slider"
              disabled={configBlocked}
              onChange={(chatTimeoutSec) =>
                setDraft({ ...draft, chatTimeoutSec })
              }
            />

            <h3 className="section-title">Chat context</h3>

            <SettingsNumberField
              id="historyMaxMessages"
              label="Max messages in history"
              value={draft.historyMaxMessages}
              min={0}
              max={50}
              disabled={configBlocked}
              onChange={(historyMaxMessages) =>
                setDraft({ ...draft, historyMaxMessages })
              }
            />
            <SettingsNumberField
              id="historyMaxChars"
              label="Max history characters"
              value={draft.historyMaxChars}
              min={500}
              max={32000}
              step={500}
              disabled={configBlocked}
              onChange={(historyMaxChars) =>
                setDraft({ ...draft, historyMaxChars })
              }
            />
            <SettingsNumberField
              id="historyMaxReplyChars"
              label="Max stored reply length"
              hint="Older bot replies are truncated in context."
              value={draft.historyMaxReplyChars}
              min={100}
              max={4000}
              disabled={configBlocked}
              onChange={(historyMaxReplyChars) =>
                setDraft({ ...draft, historyMaxReplyChars })
              }
            />

            <h3 className="section-title">Vision</h3>

            <SettingsNumberField
              id="visionMaxDimension"
              label="Image max edge (px)"
              hint="Smaller images = faster vision requests."
              value={draft.visionMaxDimension}
              min={256}
              max={2048}
              step={64}
              disabled={configBlocked}
              onChange={(visionMaxDimension) =>
                setDraft({ ...draft, visionMaxDimension })
              }
            />

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
                {saving ? "Saving…" : "Save settings"}
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
