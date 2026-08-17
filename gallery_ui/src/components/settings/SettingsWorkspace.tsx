import { useEffect, useMemo, useState } from "react";
import {
  Check,
  ChevronsLeft,
  CircleHelp,
  FolderPlus,
  HardDrive,
  ImagePlus,
  MousePointer2,
  RefreshCw,
  Save,
  Settings,
  ShieldCheck,
  SplitSquareVertical,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import { useConfirm } from "../shared/ConfirmDialog";
import { useOperationStatus } from "../shared/OperationStatusCenter";
import { useI18n } from "../../i18n/I18nProvider";
import { galleryApi } from "../../services/galleryApi";
import { formatFileSize } from "../../utils/formatters";
import type { FingerprintIndexStatus, GallerySource, GallerySourceDiagnostic, UiPreferences } from "../../types/universal-gallery";
import "../../styles/settings.css";

interface SettingsWorkspaceProps {
  sources: GallerySource[];
  preferences: UiPreferences;
  onPreferencesChange: (updates: Partial<UiPreferences>) => void;
  onSourcesChange: () => void;
  onRestartOnboarding: () => void;
}

type DraftSource = Partial<GallerySource> & {
  id?: string;
  name: string;
  path: string;
  kind: GallerySource["kind"];
  enabled: boolean;
  writable: boolean;
  recursive: boolean;
  import_target: boolean;
};

const emptyDraft = (): DraftSource => ({
  name: "",
  path: "",
  kind: "custom",
  enabled: true,
  writable: false,
  recursive: true,
  import_target: false,
});

const sourceIcon = (kind: GallerySource["kind"]) => {
  if (kind === "output") return <HardDrive size={16} />;
  return <FolderPlus size={16} />;
};

const preferenceItems = [
  {
    key: "defaultSelectionMode",
    icon: MousePointer2,
    titleKey: "settingsPrefDefaultSelection",
    descriptionKey: "settingsPrefDefaultSelectionHint",
  },
  {
    key: "collapseSidebarOnLaunch",
    icon: ChevronsLeft,
    titleKey: "settingsPrefCollapseSidebar",
    descriptionKey: "settingsPrefCollapseSidebarHint",
  },
  {
    key: "enableImagePrefetch",
    icon: ImagePlus,
    titleKey: "settingsPrefImagePrefetch",
    descriptionKey: "settingsPrefImagePrefetchHint",
  },
  {
    key: "enableLiveGalleryRefresh",
    icon: RefreshCw,
    titleKey: "settingsPrefLiveRefresh",
    descriptionKey: "settingsPrefLiveRefreshHint",
  },
  {
    key: "defaultFolderTreeView",
    icon: SplitSquareVertical,
    titleKey: "settingsPrefFolderTree",
    descriptionKey: "settingsPrefFolderTreeHint",
  },
] as const;

export const SettingsWorkspace = ({ sources, preferences, onPreferencesChange, onSourcesChange, onRestartOnboarding }: SettingsWorkspaceProps) => {
  const { t } = useI18n();
  const { confirm } = useConfirm();
  const { runOperation } = useOperationStatus();
  const [localSources, setLocalSources] = useState<GallerySource[]>(sources);
  const [selectedId, setSelectedId] = useState<string>(sources[0]?.id ?? "new");
  const [draft, setDraft] = useState<DraftSource>(() => emptyDraft());
  const [isBusy, setIsBusy] = useState(false);
  const [testResult, setTestResult] = useState<string>("");
  const [diagnostics, setDiagnostics] = useState<GallerySourceDiagnostic[]>([]);
  const [fingerprintStatus, setFingerprintStatus] = useState<FingerprintIndexStatus | null>(null);

  useEffect(() => {
    setLocalSources(sources);
    if (!sources.some((source) => source.id === selectedId) && sources[0]) {
      setSelectedId(sources[0].id);
    }
  }, [selectedId, sources]);

  const selectedSource = useMemo(
    () => localSources.find((source) => source.id === selectedId) ?? null,
    [localSources, selectedId],
  );

  useEffect(() => {
    if (selectedSource) {
      setDraft({ ...selectedSource });
      setTestResult("");
      return;
    }
    setDraft(emptyDraft());
  }, [selectedSource]);

  useEffect(() => {
    galleryApi.getFingerprintStatus().then(setFingerprintStatus).catch(() => setFingerprintStatus(null));
  }, []);

  const refreshSources = async (forceRefresh = false) => {
    const nextSources = await galleryApi.listGallerySources(forceRefresh);
    setLocalSources(nextSources);
    onSourcesChange();
    return nextSources;
  };

  const handleDiagnose = async () => {
    setIsBusy(true);
    try {
      const result = await runOperation(() => galleryApi.diagnoseGallerySources(), {
        pending: t("operationRunDiagnostics"),
        success: t("settingsDiagnosticsDone"),
        error: (error) => (error instanceof Error ? error.message : t("settingsDiagnosticsError")),
      });
      setDiagnostics(result);
    } catch {
      setDiagnostics([]);
    } finally {
      setIsBusy(false);
    }
  };

  const handleAddSource = () => {
    setSelectedId("new");
    setDraft(emptyDraft());
    setTestResult("");
  };

  const handleToggle = (key: keyof Pick<DraftSource, "enabled" | "writable" | "recursive" | "import_target">) => {
    setDraft((current) => ({ ...current, [key]: !current[key] }));
  };

  const handleTestPath = async () => {
    setIsBusy(true);
    try {
      const result = await runOperation(() => galleryApi.testGallerySourcePath(draft.path), {
        pending: t("operationTestPath"),
        success: (value) => (value.ok ? t("settingsPathOk", { count: value.image_count }) : t("settingsPathMissing")),
        error: (error) => (error instanceof Error ? error.message : t("settingsPathError")),
      });
      setTestResult(result.ok ? t("settingsPathOk", { count: result.image_count }) : t("settingsPathMissing"));
    } catch (error) {
      const message = error instanceof Error ? error.message : t("settingsPathError");
      setTestResult(message);
    } finally {
      setIsBusy(false);
    }
  };

  const handleSave = async () => {
    const approved = await confirm({
      title: t("settingsSourceSave"),
      message: selectedSource
        ? t("settingsSourceSaveConfirm", { name: selectedSource.name })
        : t("settingsSourceCreateConfirm", { name: draft.name || draft.path }),
      tone: "warning",
      confirmLabel: t("settingsSourceSave"),
      cancelLabel: t("libraryCancel"),
    });
    if (!approved) {
      return;
    }

    setIsBusy(true);
    try {
      const result = await runOperation(() => galleryApi.saveGallerySource(draft), {
        pending: t("operationSaveSource"),
        success: t("settingsSourceSaved"),
        error: (error) => (error instanceof Error ? error.message : t("settingsSourceSaveError")),
      });
      setLocalSources(result.sources);
      setSelectedId(result.source.id);
      onSourcesChange();
    } catch {
      // Status center already surfaces the failure.
    } finally {
      setIsBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedSource || selectedSource.locked) return;
    const approved = await confirm({
      title: t("settingsSourceDelete"),
      message: t("settingsSourceDeleteConfirm", { name: selectedSource.name }),
      tone: "danger",
      confirmLabel: t("commonDelete"),
      cancelLabel: t("libraryCancel"),
    });
    if (!approved) return;

    setIsBusy(true);
    try {
      const result = await runOperation(() => galleryApi.deleteGallerySource(selectedSource.id), {
        pending: t("operationDeleteSource"),
        success: t("settingsSourceDeleted"),
        error: (error) => (error instanceof Error ? error.message : t("settingsSourceDeleteError")),
      });
      setLocalSources(result.sources);
      setSelectedId(result.sources[0]?.id ?? "new");
      onSourcesChange();
    } catch {
      // Status center already surfaces the failure.
    } finally {
      setIsBusy(false);
    }
  };

  const totalImages = localSources.reduce((sum, source) => sum + (source.image_count ?? 0), 0);
  const activeSources = localSources.filter((source) => source.enabled && source.exists).length;

  return (
    <section className="ue-settings-workspace">
      <div className="ue-settings-hero">
        <div>
          <span className="ue-section-kicker">{t("settingsKicker")}</span>
          <h1>{t("settingsTitle")}</h1>
          <p>{t("settingsSubtitle")}</p>
        </div>
        <div className="ue-settings-metrics" aria-label={t("settingsSourcesTitle")}>
          <div>
            <strong>{activeSources}</strong>
            <span>{t("settingsActiveSources")}</span>
          </div>
          <div>
            <strong>{totalImages}</strong>
            <span>{t("settingsIndexedImages")}</span>
          </div>
        </div>
      </div>

      <div className="ue-settings-preferences">
        <div className="ue-settings-panel-heading">
          <div>
            <h2>{t("settingsPreferencesTitle")}</h2>
            <p>{t("settingsPreferencesHint")}</p>
          </div>
          <Settings size={18} />
        </div>

        <div className="ue-settings-onboarding-card" data-tour-id="settings-onboarding">
          <span className="ue-settings-onboarding-icon">
            <CircleHelp size={18} />
          </span>
          <span className="ue-settings-onboarding-copy">
            <strong>{t("settingsOnboardingTitle")}</strong>
            <small>{t("settingsOnboardingHint")}</small>
          </span>
          <button className="ue-secondary-action" type="button" onClick={onRestartOnboarding}>
            <CircleHelp size={16} />
            <span>{t("settingsOnboardingRestart")}</span>
          </button>
        </div>

        <div className="ue-preference-grid">
          {preferenceItems.map((item) => {
            const Icon = item.icon;
            const checked = preferences[item.key];
            return (
              <button
                key={item.key}
                className={`ue-preference-card ${checked ? "active" : ""}`}
                type="button"
                onClick={() => onPreferencesChange({ [item.key]: !checked })}
                aria-pressed={checked}
              >
                <span className="ue-preference-icon">
                  <Icon size={16} />
                </span>
                <span className="ue-preference-copy">
                  <strong>{t(item.titleKey)}</strong>
                  <small>{t(item.descriptionKey)}</small>
                </span>
                <span className="ue-toggle-dot">{checked ? <Check size={13} /> : null}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="ue-settings-layout">
        <aside className="ue-settings-source-list" data-tour-id="settings-sources">
          <div className="ue-settings-panel-heading">
            <div>
              <h2>{t("settingsSourcesTitle")}</h2>
              <p>{t("settingsSourcesHint")}</p>
            </div>
            <button className="ue-icon-btn" type="button" onClick={() => void refreshSources(true)} title={t("settingsSourceScan")}>
              <RefreshCw size={15} />
            </button>
            <button className="ue-icon-btn" type="button" onClick={() => void handleDiagnose()} title={t("settingsDiagnostics")}>
              <ShieldCheck size={15} />
            </button>
          </div>

          <div className="ue-source-stack">
            {localSources.map((source) => (
              <button
                key={source.id}
                className={`ue-source-card ${source.id === selectedId ? "active" : ""} ${!source.exists ? "is-missing" : ""}`}
                type="button"
                onClick={() => setSelectedId(source.id)}
              >
                <span className="ue-source-icon">{sourceIcon(source.kind)}</span>
                <span className="ue-source-main">
                  <strong>{source.name}</strong>
                  <small>{source.path}</small>
                </span>
                <span className="ue-source-meta">{source.image_count ?? 0}</span>
              </button>
            ))}
          </div>

          <button className="ue-secondary-action" type="button" onClick={handleAddSource}>
            <FolderPlus size={16} />
            <span>{t("settingsAddSource")}</span>
          </button>
        </aside>

        <div className="ue-settings-editor">
          <div className="ue-settings-panel-heading">
            <div>
              <h2>{selectedSource ? selectedSource.name : t("settingsNewSource")}</h2>
              <p>{selectedSource?.locked ? t("settingsDefaultLockedHint") : t("settingsCustomHint")}</p>
            </div>
            <Settings size={18} />
          </div>

          <div className="ue-settings-form">
            <label>
              <span>{t("settingsSourceName")}</span>
              <input
                value={draft.name}
                disabled={Boolean(selectedSource?.locked)}
                onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                placeholder={t("settingsSourceNamePlaceholder")}
              />
            </label>
            <label>
              <span>{t("settingsSourcePath")}</span>
              <input
                value={draft.path}
                disabled={Boolean(selectedSource?.locked)}
                onChange={(event) => setDraft((current) => ({ ...current, path: event.target.value }))}
                placeholder={t("settingsSourcePathPlaceholder")}
              />
            </label>

            <div className="ue-settings-toggle-grid">
              {(["enabled", "writable", "recursive", "import_target"] as const).map((key) => (
                <button
                  key={key}
                  className={`ue-toggle-row ${draft[key] ? "active" : ""}`}
                  type="button"
                  onClick={() => handleToggle(key)}
                >
                  <span>{t(`settingsSource${key === "import_target" ? "ImportTarget" : key[0].toUpperCase() + key.slice(1)}`)}</span>
                  <span className="ue-toggle-dot">{draft[key] ? <Check size={13} /> : null}</span>
                </button>
              ))}
            </div>

            {testResult ? <p className="ue-settings-test-result">{testResult}</p> : null}

            <div className="ue-settings-actions">
              <button className="ue-secondary-action" type="button" onClick={handleTestPath} disabled={isBusy}>
                <HardDrive size={16} />
                <span>{t("settingsSourceTest")}</span>
              </button>
              <button className="ue-primary-action" type="button" onClick={handleSave} disabled={isBusy}>
                <Save size={16} />
                <span>{t("settingsSourceSave")}</span>
              </button>
              {selectedSource && !selectedSource.locked ? (
                <button className="ue-danger-action" type="button" onClick={handleDelete} disabled={isBusy}>
                  <Trash2 size={16} />
                  <span>{t("settingsSourceDelete")}</span>
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="ue-settings-diagnostics" data-tour-id="settings-diagnostics">
        <div className="ue-settings-panel-heading">
          <div>
            <h2>{t("settingsDiagnostics")}</h2>
            <p>{t("settingsDiagnosticsHint")}</p>
          </div>
          <button className="ue-secondary-action" type="button" onClick={() => void handleDiagnose()} disabled={isBusy}>
            <ShieldCheck size={16} />
            <span>{t("settingsDiagnosticsRun")}</span>
          </button>
        </div>

        <div className="ue-diagnostics-grid">
          {fingerprintStatus ? (
            <div className="ue-diagnostic-card status-ok">
              <div className="ue-diagnostic-title">
                <ShieldCheck size={16} />
                <strong>{t("variantTitle")}</strong>
                <span>{t("variantIndexed", { count: fingerprintStatus.indexed })}</span>
              </div>
              <p>{t("variantSubtitle")}</p>
              <div className="ue-diagnostic-meta">
                <span>{t("settingsDiagnosticImages", { count: fingerprintStatus.total })}</span>
                <span>{t("variantPending", { count: fingerprintStatus.pending })}</span>
                {fingerprintStatus.failed ? <span>{t("variantFailed", { count: fingerprintStatus.failed })}</span> : null}
              </div>
              {fingerprintStatus.last_error ? <small>{fingerprintStatus.last_error}</small> : null}
            </div>
          ) : null}
          {(diagnostics.length ? diagnostics : localSources).map((source) => {
            const diagnostic = diagnostics.find((item) => item.id === source.id) ?? null;
            const status = diagnostic?.status ?? (source.exists ? "ok" : "missing");
            return (
              <div key={source.id} className={`ue-diagnostic-card status-${status}`}>
                <div className="ue-diagnostic-title">
                  {status === "ok" ? <ShieldCheck size={16} /> : <TriangleAlert size={16} />}
                  <strong>{source.name}</strong>
                  <span>{t(`settingsStatus_${status}`)}</span>
                </div>
                <p>{source.path}</p>
                <div className="ue-diagnostic-meta">
                  <span>{t("settingsDiagnosticImages", { count: source.image_count ?? 0 })}</span>
                  {diagnostic ? <span>{t("settingsDiagnosticFolders", { count: diagnostic.directory_count })}</span> : null}
                  {diagnostic?.free_bytes != null ? <span>{formatFileSize(diagnostic.free_bytes)}</span> : null}
                  {diagnostic?.overlaps.length ? <span>{t("settingsDiagnosticOverlap", { count: diagnostic.overlaps.length })}</span> : null}
                </div>
                {diagnostic?.error ? <small>{diagnostic.error}</small> : null}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};
