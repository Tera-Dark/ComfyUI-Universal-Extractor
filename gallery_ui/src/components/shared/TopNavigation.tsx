import { useEffect, useRef, useState } from "react";
import {
  LayoutGrid,
  Library,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Search,
  Settings,
  Wrench,
} from "lucide-react";

import { useI18n } from "../../i18n/I18nProvider";
import type { Locale } from "../../i18n/translations";
import type { WorkspaceTab } from "../../types/universal-gallery";

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
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const searchEnabled = activeTab === "gallery" || activeTab === "library";
  const searchOpen = searchEnabled && (searchExpanded || Boolean(searchValue.trim()));

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
      </div>
    </header>
  );
};
