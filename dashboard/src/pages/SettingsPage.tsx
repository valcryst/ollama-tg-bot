import { useMemo, useState } from "react";
import { useDashboard } from "../context/DashboardContext";
import { ErrorBanner } from "../components/ErrorBanner";
import { ModelConfigPanel } from "../components/ModelConfigPanel";
import {
  analyzeModelConfig,
  hasModelConfigErrors,
} from "../modelConfig";
import { SettingsNumberField } from "../SettingsNumberField";
import { api, type StickerCatalog } from "../api";

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

  const modelConfigIssues = useMemo(
    () => (draft ? analyzeModelConfig(draft).issues : []),
    [draft],
  );
  const modelConfigInvalid = hasModelConfigErrors(modelConfigIssues);

  const [stickerCatalog, setStickerCatalog] = useState<StickerCatalog | null>(
    null,
  );
  const [stickersLoading, setStickersLoading] = useState(false);
  const [stickersError, setStickersError] = useState<unknown | null>(null);

  async function loadStickers() {
    setStickersLoading(true);
    setStickersError(null);
    try {
      setStickerCatalog(await api.getStickers());
    } catch (err) {
      setStickersError(err);
    } finally {
      setStickersLoading(false);
    }
  }

  async function refreshStickers() {
    setStickersLoading(true);
    setStickersError(null);
    try {
      setStickerCatalog(await api.refreshStickers());
    } catch (err) {
      setStickersError(err);
    } finally {
      setStickersLoading(false);
    }
  }

  return (
    <div className="page">
      <header className="page-header">
        <h2>Settings</h2>
        <p className="page-desc">
          Ollama connection, model, owner account, and performance limits.
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

            <h3 className="section-title">Owner account</h3>
            <div className="field">
              <label htmlFor="ownerUsername">Telegram username</label>
              <input
                id="ownerUsername"
                type="text"
                value={draft.ownerUsername}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    ownerUsername: e.target.value.replace(/^@+/, ""),
                  })
                }
                placeholder="username (without @)"
              />
              <p className="hint">
                The person who runs this bot. Their numeric id is resolved via
                the Telegram API when you save — they must message the bot at
                least once first (e.g. <code>/start</code> or <code>/id</code>).
                Leave empty to disable.
              </p>
            </div>
            <div className="field">
              <label htmlFor="ownerUserId">Resolved user id</label>
              <input
                id="ownerUserId"
                className="input-readonly"
                type="text"
                readOnly
                tabIndex={-1}
                value={draft.ownerUserId}
                placeholder="Not resolved yet"
              />
              <p className="hint">
                Set automatically when you save a username. Read-only.
              </p>
            </div>

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

            <h3 className="section-title">Outgoing stickers</h3>
            <div className="field toggle-row">
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={draft.stickersEnabled}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      stickersEnabled: e.target.checked,
                    })
                  }
                />
                Let the bot send stickers from a pack
              </label>
              <p className="hint">
                After a text reply, a separate pass picks the best-matching
                sticker from your pack. Whether that pass runs is rolled
                locally from the frequency setting.
              </p>
            </div>

            {draft.stickersEnabled ? (
              <>
                <div className="field">
                  <label htmlFor="stickerReplyChance">
                    Sticker frequency ({draft.stickerReplyChance}%)
                  </label>
                  <input
                    id="stickerReplyChance"
                    type="range"
                    min={0}
                    max={100}
                    value={draft.stickerReplyChance}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        stickerReplyChance: Number(e.target.value),
                      })
                    }
                  />
                  <p className="hint">
                    How often the bot should add a sticker after replying.
                    Higher = stickers on most messages.
                  </p>
                </div>

                <div className="field">
                  <label htmlFor="stickerPackName">Sticker pack name</label>
                  <div className="field row">
                    <input
                      id="stickerPackName"
                      className="grow"
                      value={draft.stickerPackName}
                      onChange={(e) =>
                        setDraft({
                          ...draft,
                          stickerPackName: e.target.value.replace(/^@/, ""),
                        })
                      }
                      placeholder="HotCherry or MyPack_by_botname"
                    />
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => void refreshStickers()}
                      disabled={
                        stickersLoading ||
                        configBlocked ||
                        !draft.stickerPackName.trim()
                      }
                    >
                      {stickersLoading ? "Loading…" : "Load pack"}
                    </button>
                  </div>
                  <p className="hint">
                    Public set name from Telegram (the part after{" "}
                    <code>t.me/addstickers/</code>). Save settings after
                    changing the name, then load the pack to preview stickers.
                  </p>
                </div>

                {stickersError != null ? (
                  <ErrorBanner
                    error={stickersError}
                    compact
                    onRetry={() => void refreshStickers()}
                    onDismiss={() => setStickersError(null)}
                  />
                ) : null}

                {stickerCatalog?.loaded && stickerCatalog.stickers.length > 0 ? (
                  <div className="field">
                    <label>
                      Stickers in pack ({stickerCatalog.stickers.length})
                    </label>
                    <p className="hint">
                      Emojis are loaded from your sticker pack in Telegram.
                      Reload the pack after you change them in @Stickers.
                    </p>
                    <div className="sticker-preview-grid">
                      {stickerCatalog.stickers.map((s) => (
                        <div
                          key={s.index}
                          className="sticker-preview-card"
                          title={`Sticker ${s.index + 1}: ${s.emoji}`}
                        >
                          <span className="sticker-preview-index">
                            #{s.index + 1}
                          </span>
                          <img
                            src={api.stickerPreviewUrl(s.index)}
                            alt={`Sticker ${s.index + 1}`}
                            className="sticker-preview-image"
                            loading="lazy"
                          />
                          <span className="sticker-pack-emoji">{s.emoji}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : stickerCatalog && !stickersLoading ? (
                  <p className="hint">
                    {stickerCatalog.error
                      ? `Could not load pack: ${stickerCatalog.error}`
                      : "Load the pack to preview stickers."}
                  </p>
                ) : null}

                {!stickerCatalog && !stickersLoading ? (
                  <div className="actions compact-actions">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => void loadStickers()}
                      disabled={configBlocked || stickersLoading}
                    >
                      Check loaded stickers
                    </button>
                  </div>
                ) : null}
              </>
            ) : null}

            <ModelConfigPanel
              draft={draft}
              disabled={configBlocked}
              onChange={(next) => setDraft(next)}
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

            {modelConfigInvalid ? (
              <p className="field-error model-config-save-block">
                Fix model parameter errors before saving.
              </p>
            ) : null}

            <div className="actions">
              <button
                type="button"
                onClick={() => void save()}
                disabled={
                  saving || !draft || configBlocked || modelConfigInvalid
                }
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
