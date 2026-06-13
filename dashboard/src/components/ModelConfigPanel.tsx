import { useMemo, useState } from "react";
import type { ContextBudget, Settings } from "../api";
import { useDashboard } from "../context/DashboardContext";
import { SettingsNumberField } from "../SettingsNumberField";
import {
  MODEL_CONFIG_GROUPS,
  analyzeModelConfig,
  applyModelConfigUpdate,
  issuesForField,
  numPredictHint,
  type ModelConfigIssue,
} from "../modelConfig";

interface ModelConfigPanelProps {
  draft: Settings;
  disabled?: boolean;
  onChange: (settings: Settings) => void;
}

function FieldIssue({ issues }: { issues: ModelConfigIssue[] }) {
  const error = issues.find((i) => i.severity === "error");
  if (!error) return null;
  return <p className="field-error">{error.message}</p>;
}

function limiterLabel(limitedBy: ContextBudget["limitedBy"]): string {
  switch (limitedBy) {
    case "vram_tier":
      return "VRAM tier baseline";
    case "kv_headroom":
      return "KV cache headroom after model weights";
    case "model_max":
      return "Model native maximum";
    case "generation_floor":
      return "Generation budget floor";
    case "min_floor":
      return "Minimum context floor";
  }
}

export function ModelConfigPanel({
  draft,
  disabled,
  onChange,
}: ModelConfigPanelProps) {
  const { contextBudget, derivedHistoryLimits, budgetLoading, vramAvailableGb } = useDashboard();

  const analysis = useMemo(
    () =>
      contextBudget
        ? analyzeModelConfig(draft, contextBudget, derivedHistoryLimits ?? undefined)
        : null,
    [draft, contextBudget, derivedHistoryLimits],
  );
  const [rejectFlash, setRejectFlash] = useState<ModelConfigIssue | null>(null);

  function update(patch: Parameters<typeof applyModelConfigUpdate>[2]) {
    if (!contextBudget) return;
    const result = applyModelConfigUpdate(draft, contextBudget, patch);
    if (!result.ok) {
      setRejectFlash(result.issue);
      return;
    }
    setRejectFlash(null);
    onChange(result.settings);
  }

  if (vramAvailableGb == null) {
    return (
      <div className="model-config">
        <header className="model-config-header">
          <h3 className="section-title">Model parameters</h3>
        </header>
        <p className="field-error">
          VRAM_AVAILABLE is required on the server. Add it to <code>.env</code>{" "}
          (e.g. <code>VRAM_AVAILABLE=24</code>) and restart the bot.
        </p>
      </div>
    );
  }

  if (!contextBudget || !analysis) {
    return (
      <div className="model-config">
        <header className="model-config-header">
          <h3 className="section-title">Model parameters</h3>
        </header>
        <p className="hint">
          {budgetLoading
            ? "Computing context budget…"
            : draft.model
              ? "Could not compute context budget. Check the selected model and try refreshing."
              : "Select a model to see context budget."}
        </p>
      </div>
    );
  }

  const predictIssues = issuesForField(analysis.issues, "numPredict");
  const numPredictError =
    rejectFlash?.field === "numPredict"
      ? rejectFlash.message
      : predictIssues[0]?.message;

  return (
    <div className="model-config">
      <header className="model-config-header">
        <h3 className="section-title">Model parameters</h3>
        <p className="hint section-hint">
          Context is computed automatically from VRAM and the selected model.
          Adjust generation budget, thinking, and sampling below.
        </p>
      </header>

      <section className="model-config-group" aria-labelledby="model-ctx">
        <h4 id="model-ctx" className="model-config-group-title">
          {MODEL_CONFIG_GROUPS[0].title}
        </h4>
        <p className="hint model-config-group-desc">
          {MODEL_CONFIG_GROUPS[0].description}
        </p>
        <div className="context-budget-card">
          <div className="context-budget-value">
            <span className="context-budget-label">Context window</span>
            <strong>{contextBudget.effectiveNumCtx.toLocaleString()}</strong>
            <span className="context-budget-unit">tokens</span>
          </div>
          <dl className="context-budget-meta">
            <div>
              <dt>VRAM</dt>
              <dd>{contextBudget.vramGb} GB</dd>
            </div>
            <div>
              <dt>Model</dt>
              <dd>{contextBudget.modelName || "—"}</dd>
            </div>
            {contextBudget.modelWeightGb != null ? (
              <div>
                <dt>Weights</dt>
                <dd>~{contextBudget.modelWeightGb.toFixed(1)} GB</dd>
              </div>
            ) : null}
            <div>
              <dt>Limited by</dt>
              <dd>{limiterLabel(contextBudget.limitedBy)}</dd>
            </div>
            <div>
              <dt>Generation max</dt>
              <dd>{analysis.maxNumPredict.toLocaleString()} tokens</dd>
            </div>
          </dl>
          <ul className="context-budget-notes">
            {contextBudget.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      </section>

      <section className="model-config-group" aria-labelledby="model-gen">
        <h4 id="model-gen" className="model-config-group-title">
          {MODEL_CONFIG_GROUPS[1].title}
        </h4>
        <p className="hint model-config-group-desc">
          {MODEL_CONFIG_GROUPS[1].description}
        </p>
        <SettingsNumberField
          id="numPredict"
          label="Max generation tokens"
          value={draft.numPredict}
          min={32}
          max={analysis.maxNumPredict}
          step={32}
          variant="slider"
          disabled={disabled}
          error={numPredictError}
          hint={numPredictHint(analysis.maxNumPredict, contextBudget.effectiveNumCtx)}
          onChange={(numPredict) => update({ numPredict })}
        />
        <div className="field toggle-row">
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.thinkingEnabled}
              disabled={disabled}
              onChange={(e) => update({ thinkingEnabled: e.target.checked })}
            />
            Enable thinking
          </label>
          <p className="hint">
            Requests separate model reasoning when the backend supports
            reasoning_effort.
          </p>
        </div>
        {draft.thinkingEnabled ? (
          <div className="field toggle-row">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={draft.sendThinkingEnabled}
                disabled={disabled}
                onChange={(e) =>
                  update({ sendThinkingEnabled: e.target.checked })
                }
              />
            Send reasoning to Telegram
            </label>
            <p className="hint">
              If the API returns a separate reasoning field, post it as a
              separate message before the reply. It is not saved to chat history.
            </p>
            <FieldIssue issues={issuesForField(analysis.issues, "sendThinkingEnabled")} />
          </div>
        ) : null}
      </section>

      <section className="model-config-group" aria-labelledby="model-sample">
        <h4 id="model-sample" className="model-config-group-title">
          {MODEL_CONFIG_GROUPS[2].title}
        </h4>
        <p className="hint model-config-group-desc">
          {MODEL_CONFIG_GROUPS[2].description}
        </p>
        <SettingsNumberField
          id="temperature"
          label="Temperature"
          hint="Randomness for in-character replies and /explain."
          value={draft.temperature}
          min={0}
          max={2}
          step={0.1}
          variant="slider"
          disabled={disabled}
          onChange={(temperature) => update({ temperature })}
        />
        <SettingsNumberField
          id="topP"
          label="Top P (nucleus sampling)"
          hint="Lower = more focused; higher = more varied word choice."
          value={draft.topP}
          min={0.05}
          max={1}
          step={0.05}
          variant="slider"
          disabled={disabled}
          onChange={(topP) => update({ topP })}
        />
        <SettingsNumberField
          id="topK"
          label="Top K"
          hint="Candidate tokens per step. Lower = safer; higher = more diverse."
          value={draft.topK}
          min={1}
          max={200}
          step={1}
          variant="slider"
          disabled={disabled}
          onChange={(topK) => update({ topK })}
        />
        <SettingsNumberField
          id="repeatPenalty"
          label="Repeat penalty"
          hint="Above 1.0 reduces loops; below 1.0 allows more repetition."
          value={draft.repeatPenalty}
          min={0.8}
          max={2}
          step={0.05}
          variant="slider"
          disabled={disabled}
          onChange={(repeatPenalty) => update({ repeatPenalty })}
        />
      </section>

      <section className="model-config-group" aria-labelledby="model-timeout">
        <h4 id="model-timeout" className="model-config-group-title">
          {MODEL_CONFIG_GROUPS[3].title}
        </h4>
        <p className="hint model-config-group-desc">
          {MODEL_CONFIG_GROUPS[3].description}
        </p>
        <SettingsNumberField
          id="chatTimeoutSec"
          label="Timeout (seconds)"
          value={draft.chatTimeoutSec}
          min={30}
          max={600}
          variant="slider"
          disabled={disabled}
          onChange={(chatTimeoutSec) => update({ chatTimeoutSec })}
        />
      </section>

      <aside className="model-config-derived">
        <h4 className="model-config-group-title">Derived chat history</h4>
        <ul className="model-config-derived-list">
          <li>
            Up to <strong>{analysis.derived.historyMaxMessages}</strong> messages
          </li>
          <li>
            <strong>{analysis.derived.historyMaxChars.toLocaleString()}</strong>{" "}
            characters of history
          </li>
          <li>
            Replies stored to{" "}
            <strong>
              {analysis.derived.historyMaxReplyChars.toLocaleString()}
            </strong>{" "}
            chars
          </li>
          <li>
            Generation budget:{" "}
            <strong>{analysis.derived.numPredict}</strong> tokens
          </li>
        </ul>
      </aside>
    </div>
  );
}
