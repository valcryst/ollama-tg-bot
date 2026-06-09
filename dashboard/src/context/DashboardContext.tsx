import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { api, type OllamaModel, type Settings, type Stats } from "../api";
import {
  calculateContextBudget,
  modelContextFromTags,
} from "../contextBudgetCalc";
import {
  analyzeModelConfig,
  hasModelConfigErrors,
} from "../modelConfig";
import { buildModelOptions, resolveModelSelection } from "../modelOptions";

export type SectionKey = "settings" | "stats" | "ollama" | "models" | "save";

export function isValidOllamaHost(host: string): boolean {
  try {
    const url = new URL(host.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

interface DashboardContextValue {
  settings: Settings | null;
  draft: Settings | null;
  setDraft: React.Dispatch<React.SetStateAction<Settings | null>>;
  stats: Stats | null;
  models: OllamaModel[];
  vramAvailableGb: number | undefined;
  ollamaOk: boolean | null;
  tavilyConfigured: boolean | null;
  apiOnline: boolean | null;
  loading: boolean;
  saving: boolean;
  modelsLoading: boolean;
  testingOllama: boolean;
  verifiedOllamaHost: string | null;
  sectionErrors: Partial<Record<SectionKey, unknown>>;
  saveOk: boolean;
  setSectionError: (key: SectionKey, err: unknown | null) => void;
  load: () => Promise<void>;
  fetchModelsForHost: (host: string) => Promise<void>;
  testOllamaConnection: () => Promise<void>;
  invalidateOllamaVerification: (newHost: string) => void;
  save: () => Promise<void>;
  modelOptions: ReturnType<typeof buildModelOptions>;
  showModelSelection: boolean;
  configBlocked: boolean;
  apiUnreachable: boolean;
  primaryLoadError: unknown;
}

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function DashboardProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [draft, setDraft] = useState<Settings | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [models, setModels] = useState<OllamaModel[]>([]);
  const [vramAvailableGb, setVramAvailableGb] = useState<number | undefined>(
    undefined,
  );
  const [ollamaOk, setOllamaOk] = useState<boolean | null>(null);
  const [tavilyConfigured, setTavilyConfigured] = useState<boolean | null>(
    null,
  );
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [testingOllama, setTestingOllama] = useState(false);
  const [verifiedOllamaHost, setVerifiedOllamaHost] = useState<string | null>(
    null,
  );
  const [sectionErrors, setSectionErrors] = useState<
    Partial<Record<SectionKey, unknown>>
  >({});
  const [saveOk, setSaveOk] = useState(false);

  const setSectionError = (key: SectionKey, err: unknown | null) => {
    setSectionErrors((prev) => {
      const next = { ...prev };
      if (err == null) delete next[key];
      else next[key] = err;
      return next;
    });
  };

  const applyModels = useCallback((list: OllamaModel[]) => {
    setModels(list);
    setDraft((d) =>
      d ? { ...d, model: resolveModelSelection(list, d.model) } : d,
    );
  }, []);

  const load = useCallback(async () => {
    setLoading(true);

    const [health, settingsRes, statsRes] = await Promise.allSettled([
      api.checkHealth(),
      api.getSettings(),
      api.getStats(),
    ]);

    const nextErrors: Partial<Record<SectionKey, unknown>> = {};

    if (health.status === "fulfilled") {
      setApiOnline(health.value.ok);
    } else {
      setApiOnline(false);
      nextErrors.settings = health.reason;
      nextErrors.stats = health.reason;
    }

    if (settingsRes.status === "fulfilled") {
      setSettings(settingsRes.value);
      setDraft(settingsRes.value);
      setVramAvailableGb(settingsRes.value.vramAvailableGb);
    } else {
      nextErrors.settings = settingsRes.reason;
    }

    if (statsRes.status === "fulfilled") {
      setStats(statsRes.value);
    } else {
      nextErrors.stats = statsRes.reason;
    }

    const savedHost =
      settingsRes.status === "fulfilled"
        ? settingsRes.value.ollamaHost.trim()
        : "";

    let ollamaReachable = false;
    if (savedHost) {
      try {
        ollamaReachable = await api.ollamaHealth(savedHost);
        setOllamaOk(ollamaReachable);
      } catch (err) {
        setOllamaOk(false);
        nextErrors.ollama = err;
      }
    } else {
      setOllamaOk(false);
    }

    if (savedHost && ollamaReachable) {
      try {
        const list = await api.getModels(savedHost);
        setVerifiedOllamaHost(savedHost);
        applyModels(list);
      } catch (err) {
        setVerifiedOllamaHost(null);
        setModels([]);
        nextErrors.models = err;
      }
    } else {
      setVerifiedOllamaHost(null);
      setModels([]);
    }

    try {
      const tavily = await api.tavilyStatus();
      setTavilyConfigured(tavily.configured);
    } catch {
      setTavilyConfigured(null);
    }

    setSectionErrors(nextErrors);
    setLoading(false);
  }, [applyModels]);

  useEffect(() => {
    void load();
    const id = setInterval(async () => {
      try {
        await api.checkHealth();
        setApiOnline(true);
      } catch (err) {
        setApiOnline(false);
        setSectionErrors((prev) => ({ ...prev, stats: err }));
        return;
      }

      try {
        const st = await api.getStats();
        setStats(st);
        setSectionErrors((prev) => {
          const next = { ...prev };
          delete next.stats;
          return next;
        });
      } catch (err) {
        setSectionErrors((prev) => ({ ...prev, stats: err }));
      }

      try {
        const ok = await api.ollamaHealth();
        setOllamaOk(ok);
        setSectionErrors((prev) => {
          const next = { ...prev };
          delete next.ollama;
          return next;
        });
      } catch (err) {
        setOllamaOk(false);
        setSectionErrors((prev) => ({ ...prev, ollama: err }));
      }

      try {
        const tavily = await api.tavilyStatus();
        setTavilyConfigured(tavily.configured);
      } catch {
        setTavilyConfigured(null);
      }
    }, 5000);
    return () => clearInterval(id);
  }, [load]);

  const fetchModelsForHost = async (host: string) => {
    setModelsLoading(true);
    setSectionError("models", null);
    try {
      const list = await api.getModels(host);
      applyModels(list);
      setSectionErrors((prev) => {
        const next = { ...prev };
        delete next.models;
        return next;
      });
    } catch (err) {
      setModels([]);
      setSectionError("models", err);
      throw err;
    } finally {
      setModelsLoading(false);
    }
  };

  const testOllamaConnection = async () => {
    if (!draft) return;
    const host = draft.ollamaHost.trim();
    setSectionError("ollama", null);

    if (!host) {
      setSectionError(
        "ollama",
        new Error("Enter an Ollama host URL before testing"),
      );
      return;
    }
    if (!isValidOllamaHost(host)) {
      setSectionError(
        "ollama",
        new Error("Host must be a valid http:// or https:// URL"),
      );
      return;
    }

    setTestingOllama(true);
    setVerifiedOllamaHost(null);
    setModels([]);

    try {
      const ok = await api.ollamaHealth(host);
      if (!ok) {
        throw new Error(
          "Ollama did not respond at this address. Is ollama serve running?",
        );
      }
      setVerifiedOllamaHost(host);
      setOllamaOk(true);
      await fetchModelsForHost(host);
      setSectionErrors((prev) => {
        const next = { ...prev };
        delete next.ollama;
        return next;
      });
    } catch (err) {
      setVerifiedOllamaHost(null);
      setModels([]);
      setOllamaOk(false);
      setSectionError("ollama", err);
    } finally {
      setTestingOllama(false);
    }
  };

  const invalidateOllamaVerification = (newHost: string) => {
    if (verifiedOllamaHost && newHost.trim() !== verifiedOllamaHost) {
      setVerifiedOllamaHost(null);
      setModels([]);
      setSectionError("models", null);
      setSectionError("ollama", null);
    }
  };

  const save = async () => {
    if (!draft) return;
    const tag = models.find((m) => m.name === draft.model);
    if (vramAvailableGb == null) {
      setSectionError(
        "save",
        new Error(
          "VRAM_AVAILABLE is not configured on the server. Set it in .env and restart.",
        ),
      );
      return;
    }
    const budget = calculateContextBudget(
      vramAvailableGb,
      modelContextFromTags(draft.model, tag),
      draft.numPredict,
    );
    const analysis = analyzeModelConfig(draft, budget);
    if (hasModelConfigErrors(analysis.issues)) {
      setSectionError(
        "save",
        new Error(
          analysis.issues
            .filter((issue) => issue.severity === "error")
            .map((issue) => issue.message)
            .join(" "),
        ),
      );
      return;
    }
    setSaving(true);
    setSaveOk(false);
    setSectionError("save", null);
    try {
      const updated = await api.updateSettings(analysis.settings);
      setSettings(updated);
      setDraft(updated);
      setVramAvailableGb(updated.vramAvailableGb);
      setSaveOk(true);
      setTimeout(() => setSaveOk(false), 2500);
    } catch (err) {
      setSectionError("save", err);
    } finally {
      setSaving(false);
    }
  };

  const modelOptions = useMemo(() => buildModelOptions(models), [models]);

  const draftHost = draft?.ollamaHost.trim() ?? "";
  const ollamaHostReady =
    draftHost.length > 0 && isValidOllamaHost(draftHost);
  const ollamaVerified =
    ollamaHostReady && verifiedOllamaHost === draftHost;
  const showModelSelection = ollamaVerified;

  const apiUnreachable = apiOnline === false;
  const configBlocked = apiUnreachable || !!sectionErrors.settings;

  const primaryLoadError =
    sectionErrors.settings ?? sectionErrors.stats ?? null;

  const value: DashboardContextValue = {
    settings,
    draft,
    setDraft,
    stats,
    models,
    vramAvailableGb,
    ollamaOk,
    tavilyConfigured,
    apiOnline,
    loading,
    saving,
    modelsLoading,
    testingOllama,
    verifiedOllamaHost,
    sectionErrors,
    saveOk,
    setSectionError,
    load,
    fetchModelsForHost,
    testOllamaConnection,
    invalidateOllamaVerification,
    save,
    modelOptions,
    showModelSelection,
    configBlocked,
    apiUnreachable,
    primaryLoadError,
  };

  return (
    <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>
  );
}

export function useDashboard(): DashboardContextValue {
  const ctx = useContext(DashboardContext);
  if (!ctx) {
    throw new Error("useDashboard must be used within DashboardProvider");
  }
  return ctx;
}
