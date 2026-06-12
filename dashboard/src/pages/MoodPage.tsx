import { useCallback, useEffect, useState } from "react";
import { ErrorBanner } from "../components/ErrorBanner";
import { SettingsNumberField } from "../SettingsNumberField";
import {
  api,
  type MoodKey,
  type MoodPayload,
  type MoodValues,
} from "../api";
import { useLiveMood } from "../liveSocket";

const MOOD_KEYS: MoodKey[] = [
  "irritated",
  "exhausted",
  "amused",
  "curious",
  "contemptuous",
  "gloomy",
  "impatient",
  "pleased",
  "suspicious",
];

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString();
}

export function MoodPage() {
  const [payload, setPayload] = useState<MoodPayload | null>(null);
  const [draftCooldown, setDraftCooldown] = useState<number | null>(null);
  const [draftCurrent, setDraftCurrent] = useState<MoodValues | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  const [saveOk, setSaveOk] = useState(false);

  const applyPayload = useCallback((data: MoodPayload) => {
    setPayload(data);
    setDraftCooldown(data.cooldownMinutes);
    setDraftCurrent(
      data.current ? { ...data.current.values } : { ...data.defaults },
    );
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      applyPayload(await api.getMood());
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [applyPayload]);

  useEffect(() => {
    void load();
  }, [load]);

  useLiveMood(
    useCallback(
      (data) => {
        if (!refreshing && !saving) applyPayload(data);
      },
      [applyPayload, refreshing, saving],
    ),
  );

  async function refreshCurrent() {
    setRefreshing(true);
    setError(null);
    try {
      applyPayload(await api.refreshMood());
    } catch (err) {
      setError(err);
    } finally {
      setRefreshing(false);
    }
  }

  async function saveCooldown() {
    if (draftCooldown == null) return;
    setSaving(true);
    setSaveOk(false);
    setError(null);
    try {
      applyPayload(await api.updateMood({ cooldownMinutes: draftCooldown }));
      setSaveOk(true);
      window.setTimeout(() => setSaveOk(false), 2000);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  async function saveCurrent() {
    if (!draftCurrent) return;
    setSaving(true);
    setSaveOk(false);
    setError(null);
    try {
      applyPayload(await api.updateMood({ current: draftCurrent }));
      setSaveOk(true);
      window.setTimeout(() => setSaveOk(false), 2000);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  async function resetCurrent() {
    setSaving(true);
    setError(null);
    try {
      const updated = await api.resetMood();
      applyPayload(updated);
    } catch (err) {
      setError(err);
    } finally {
      setSaving(false);
    }
  }

  if (loading && !payload) {
    return (
      <div className="page">
        <p className="loading">Loading mood…</p>
      </div>
    );
  }

  const effective = payload?.current?.effectiveValues;
  const defaultsLabel = payload?.activePersonalityName
    ? `"${payload.activePersonalityName}" mood defaults`
    : "base mood defaults";

  return (
    <div className="page">
      <header className="page-header">
        <h2>Mood</h2>
        <p className="page-desc">
          Global mood state and cooldown. Default baselines are set per character
          on the Character page; cooldown drifts current mood back toward the
          active character&apos;s defaults in the background.
        </p>
      </header>

      {error != null ? (
        <ErrorBanner error={error} compact onRetry={() => void load()} />
      ) : null}

      {saveOk ? (
        <div className="alert success page-alert">Saved</div>
      ) : null}

      {draftCooldown != null ? (
        <section className="card">
          <h3>Cooldown</h3>
          <p className="hint">
            After inactivity, each trait drifts back toward {defaultsLabel} over
            this period.
          </p>

          <SettingsNumberField
            id="moodCooldown"
            label="Cooldown (minutes)"
            hint="Time until mood fully returns to the active character's defaults (5–1440)."
            value={draftCooldown}
            min={5}
            max={1440}
            step={5}
            disabled={saving}
            onChange={setDraftCooldown}
          />

          <div className="actions">
            <button
              type="button"
              className="primary"
              disabled={saving}
              onClick={() => void saveCooldown()}
            >
              {saving ? "Saving…" : "Save cooldown"}
            </button>
          </div>
        </section>
      ) : null}

      {draftCurrent ? (
        <section className="card">
          <div className="section-head">
            <h3 className="section-title">Current mood</h3>
            <button
              type="button"
              className="secondary"
              disabled={refreshing || saving}
              onClick={() => void refreshCurrent()}
            >
              {refreshing ? "Applying…" : "Apply cooldown now"}
            </button>
          </div>
          <p className="hint">
            Background cooldown updates these values toward {defaultsLabel}.
            {payload?.current?.updatedAt
              ? ` Last interaction ${formatTime(payload.current.updatedAt)}.`
              : " Not set yet — character defaults apply until the first reply."}
          </p>

          {effective &&
          payload?.current &&
          MOOD_KEYS.some((key) => effective[key] !== payload.current!.values[key]) ? (
            <p className="hint">
              Live decay (next background tick):{" "}
              <span className="mood-summary">
                {MOOD_KEYS.map((key) => (
                  <span key={key} title={payload?.traitHints[key]}>
                    {key.slice(0, 3)}:{effective[key]}
                  </span>
                ))}
              </span>
            </p>
          ) : null}

          <div className="mood-grid">
            {MOOD_KEYS.map((key) => (
              <SettingsNumberField
                key={key}
                id={`current-${key}`}
                label={key}
                hint={payload?.traitHints[key]}
                value={draftCurrent[key]}
                min={0}
                max={5}
                step={1}
                variant="slider"
                disabled={saving}
                onChange={(value) =>
                  setDraftCurrent({ ...draftCurrent, [key]: value })
                }
              />
            ))}
          </div>

          <div className="actions">
            <button
              type="button"
              className="secondary danger"
              disabled={saving || !payload?.current}
              onClick={() => void resetCurrent()}
            >
              Reset to defaults
            </button>
            <button
              type="button"
              className="primary"
              disabled={saving}
              onClick={() => void saveCurrent()}
            >
              {saving ? "Saving…" : "Save current mood"}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}
