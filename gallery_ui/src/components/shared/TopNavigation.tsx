import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import {
  Bell,
  ExternalLink,
  LayoutGrid,
  Library,
  Loader2,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Settings,
  Wrench,
} from "lucide-react";

import { useI18n } from "../../i18n/I18nProvider";
import { galleryApi } from "../../services/galleryApi";
import type { Locale } from "../../i18n/translations";
import type { UpdateStatus, WorkspaceTab } from "../../types/universal-gallery";
import { FloatingLayerPortal, placeMenuNearRect, useDismissableLayer, type FloatingMenuPosition } from "../../utils/interaction";

interface TopNavigationProps {
  activeTab: WorkspaceTab;
  onTabChange: (tab: WorkspaceTab) => void;
  searchValue: string;
  onSearchChange: (value: string) => void;
  onRefresh: () => void;
  sidebarCollapsed: boolean;
  onSidebarToggle: () => void;
}

export const TopNavigation = ({
  activeTab,
  onTabChange,
  searchValue,
  onSearchChange,
  onRefresh,
  sidebarCollapsed,
  onSidebarToggle,
}: TopNavigationProps) => {
  const { locale, setLocale, t } = useI18n();
  const [searchExpanded, setSearchExpanded] = useState(false);
  const [inputValue, setInputValue] = useState(searchValue);
  const [isComposing, setIsComposing] = useState(false);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [updateError, setUpdateError] = useState("");
  const [updateLoading, setUpdateLoading] = useState(false);
  const [updatesOpen, setUpdatesOpen] = useState(false);
  const [updatesPosition, setUpdatesPosition] = useState<FloatingMenuPosition>({ x: 12, y: 56 });
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const updatesButtonRef = useRef<HTMLButtonElement | null>(null);
  const searchEnabled = activeTab === "gallery" || activeTab === "library";
  const searchOpen = searchEnabled && (searchExpanded || Boolean(searchValue.trim()));
  const updateAvailable = Boolean(updateStatus?.update_available);

  const closeUpdates = useCallback(() => setUpdatesOpen(false), []);
  useDismissableLayer(updatesOpen, closeUpdates, { closeOnScroll: true });

  const loadUpdateStatus = useCallback(async (force = false) => {
    setUpdateLoading(true);
    setUpdateError("");
    try {
      const status = await galleryApi.getUpdateStatus(force);
      setUpdateStatus(status);
      setUpdateError(status.error || "");
    } catch (error) {
      setUpdateError(error instanceof Error ? error.message : t("updatesCheckFailed"));
    } finally {
      setUpdateLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadUpdateStatus(false);
  }, [loadUpdateStatus]);

  useEffect(() => {
    if (!isComposing) {
      setInputValue(searchValue);
    }
  }, [isComposing, searchValue]);

  useEffect(() => {
    if (searchOpen) {
      searchInputRef.current?.focus();
    }
  }, [searchOpen]);

  useEffect(() => {
    if (!searchEnabled) {
      setSearchExpanded(false);
    }
  }, [searchEnabled]);

  const toggleLocale = () => {
    setLocale((locale === "zh-CN" ? "en" : "zh-CN") as Locale);
  };

  const toggleUpdates = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    const rect = updatesButtonRef.current?.getBoundingClientRect();
    if (rect) {
      setUpdatesPosition(placeMenuNearRect(rect, { width: 360, height: 520 }));
    }
    setUpdatesOpen((current) => !current);
  };

  const formatReleaseDate = (value: string) => {
    if (!value) {
      return "";
    }
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric" }).format(date);
  };

  return (
    <header className="ue-topbar">
      <div className="ue-topbar-brand">
        <button
          className="ue-topbar-icon-btn"
          onClick={onSidebarToggle}
          aria-label={t("navToggleSidebar")}
          title={t("navToggleSidebar")}
          data-tour-id="topbar-sidebar-toggle"
        >
          {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
        <strong>Gallery</strong>
        <span className="ue-topbar-scope">{t("topStatus", { tab: activeTab })}</span>
      </div>

      <nav className="ue-topbar-tabs" aria-label="Primary navigation" data-tour-id="topbar-tabs">
        <button
          className={`ue-topbar-tab ${activeTab === "gallery" ? "active" : ""}`}
          onClick={() => onTabChange("gallery")}
        >
          <LayoutGrid size={16} />
          <span>{t("navGallery")}</span>
        </button>
        <button
          className={`ue-topbar-tab ${activeTab === "library" ? "active" : ""}`}
          onClick={() => onTabChange("library")}
        >
          <Library size={16} />
          <span>{t("navLibrary")}</span>
        </button>
        <button
          className={`ue-topbar-tab ${activeTab === "workbench" ? "active" : ""}`}
          onClick={() => onTabChange("workbench")}
        >
          <Wrench size={16} />
          <span>{t("navWorkbench")}</span>
        </button>
        <button
          className={`ue-topbar-tab ${activeTab === "settings" ? "active" : ""}`}
          onClick={() => onTabChange("settings")}
        >
          <Settings size={16} />
          <span>{t("navSettings")}</span>
        </button>
      </nav>

      <div className="ue-topbar-tools">
        <div className={`ue-topbar-search-wrap ${searchOpen ? "is-open" : ""}`} data-tour-id="topbar-search">
          <button
            className={`ue-topbar-icon-btn ${searchOpen ? "is-active" : ""}`}
            onClick={() => {
              if (!searchEnabled) {
                return;
              }
              setSearchExpanded((current) => !current);
            }}
            aria-label={t("navToggleSearch")}
            title={t("navToggleSearch")}
            disabled={!searchEnabled}
          >
            <Search size={16} />
          </button>

          <label className="ue-topbar-search" htmlFor="ue-topbar-search">
            <input
              ref={searchInputRef}
              id="ue-topbar-search"
              value={inputValue}
              placeholder={
                activeTab === "gallery"
                  ? t("navSearchGalleryPlaceholder")
                  : activeTab === "library"
                    ? t("navSearchLibraryPlaceholder")
                    : ""
              }
              onCompositionStart={() => setIsComposing(true)}
              onCompositionEnd={(event) => {
                setIsComposing(false);
                setInputValue(event.currentTarget.value);
                onSearchChange(event.currentTarget.value);
              }}
              onChange={(event) => {
                setInputValue(event.target.value);
                if (!isComposing) {
                  onSearchChange(event.target.value);
                }
              }}
            />
          </label>
        </div>

        <button
          className="ue-topbar-icon-btn ue-locale-toggle"
          onClick={toggleLocale}
          aria-label={t("navLanguage")}
          title={locale === "zh-CN" ? t("navSwitchToEnglish") : t("navSwitchToChinese")}
          data-tour-id="topbar-language"
        >
          <span>{locale === "zh-CN" ? t("navLanguageZhShort") : t("navLanguageEnShort")}</span>
        </button>

        <button
          className="ue-topbar-icon-btn"
          onClick={onRefresh}
          aria-label={t("navRefresh")}
          title={t("navRefresh")}
          data-tour-id="topbar-refresh"
        >
          <RefreshCw size={16} />
        </button>

        <button
          ref={updatesButtonRef}
          className={`ue-topbar-icon-btn ue-update-bell ${updatesOpen ? "is-open" : ""} ${updateAvailable ? "has-update" : ""}`}
          onClick={toggleUpdates}
          aria-label={t("updatesTitle")}
          title={t("updatesTitle")}
          data-tour-id="topbar-updates"
        >
          <Bell size={16} />
          {updateAvailable && <span className="ue-update-dot" aria-hidden="true" />}
        </button>
      </div>

      {updatesOpen && (
        <FloatingLayerPortal>
          <section
            className="ue-update-popover"
            style={{ left: updatesPosition.x, top: updatesPosition.y }}
            onClick={(event) => event.stopPropagation()}
            aria-label={t("updatesTitle")}
          >
            <header className="ue-update-popover-head">
              <div>
                <strong>{t("updatesTitle")}</strong>
                <span>{updateStatus ? t(updateAvailable ? "updatesAvailable" : "updatesCurrent") : t("updatesChecking")}</span>
              </div>
              <button
                type="button"
                className="ue-icon-action"
                onClick={() => void loadUpdateStatus(true)}
                disabled={updateLoading}
                aria-label={t("updatesCheckNow")}
                title={t("updatesCheckNow")}
              >
                {updateLoading ? <Loader2 className="ue-spin" size={16} /> : <RefreshCw size={16} />}
              </button>
            </header>

            <div className="ue-update-version-box">
              <div>
                <span>{t("updatesCurrentVersion")}</span>
                <strong>{updateStatus?.current_version || "-"}</strong>
              </div>
              <div>
                <span>{t("updatesLatestVersion")}</span>
                <strong className={updateAvailable ? "is-new" : ""}>{updateStatus?.latest_version || "-"}</strong>
              </div>
              <a
                className="ue-secondary-btn"
                href={updateStatus?.release_url || updateStatus?.repository_url || "https://github.com/Tera-Dark/ComfyUI-Universal-Extractor"}
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink size={16} />
                <span>{t("updatesOpenGithub")}</span>
              </a>
            </div>

            {updateError && <p className="ue-update-error">{updateError}</p>}

            <div className="ue-update-log">
              <h2>{t("updatesChangelog")}</h2>
              {updateStatus?.releases?.length ? (
                updateStatus.releases.map((release) => (
                  <article key={`${release.tag_name}-${release.published_at}`} className="ue-update-release">
                    <div className="ue-update-release-title">
                      <strong>{release.name || release.version}</strong>
                      <span>{formatReleaseDate(release.published_at)}</span>
                    </div>
                    <p>{release.body || t("updatesNoChangelog")}</p>
                  </article>
                ))
              ) : (
                <p className="ue-update-empty">{updateLoading ? t("updatesChecking") : t("updatesNoChangelog")}</p>
              )}
            </div>
          </section>
        </FloatingLayerPortal>
      )}
    </header>
  );
};
