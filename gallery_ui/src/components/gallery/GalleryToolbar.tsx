import { useEffect, useRef, useState } from "react";
import {
  Calendar,
  CheckSquare,
  Columns2,
  LayoutGrid,
  Layers3,
  List,
  MoreHorizontal,
  Palette,
  Pin,
  RotateCcw,
  Search,
  Share2,
  SlidersHorizontal,
  Tag,
  Trash2,
  X,
} from "lucide-react";

import { DisclosureMenu } from "../shared/DisclosureMenu";
import { DEFAULT_OUTPUT_SOURCE_ID, parseFolderRef } from "../shared/folderTree";
import { useI18n } from "../../i18n/I18nProvider";
import type { BoardSummary, ColorIndexStatus, GallerySource } from "../../types/universal-gallery";
import { isEditableTarget } from "../../utils/interaction";
import { GalleryDensityControl } from "./GalleryDensityControl";
import { GalleryFilterMenu } from "./GalleryFilterMenu";
import type { ContentViewMode } from "./galleryWorkspaceModel";

interface GalleryToolbarProps {
  isTrashView: boolean;
  selectedBoard: BoardSummary | null;
  selectedSubfolder: string;
  total: number;
  trashCount: number;
  favoritesOnly: boolean;
  isRefreshing: boolean;
  hasPendingLiveRefresh: boolean;
  activeFilterControlCount: number;
  showFiltersMenu: boolean;
  showColumnsMenu: boolean;
  galleryViewMode: ContentViewMode;
  gridColumns: number;
  effectiveColumns?: number;
  isMobile?: boolean;
  mobileDensity?: "single" | "double";
  onMobileDensityChange?: (preset: "single" | "double") => void;
  dualFolderMode: boolean;
  variantMode?: boolean;
  selectionMode: boolean;
  writableSources: GallerySource[];
  sources: GallerySource[];
  importSubfolder: string;
  activeImportSourceId: string;
  categories: string[];
  selectedCategory: string;
  dateFrom: string;
  dateTo: string;
  selectedColorFamily: string;
  colorIndexStatus: ColorIndexStatus | null;
  sortBy: string;
  sortOrder: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  onApplyPendingLiveRefresh: () => void;
  onToggleFiltersMenu: () => void;
  onCloseFiltersMenu: () => void;
  onToggleColumnsMenu: () => void;
  onCloseColumnsMenu: () => void;
  onOpenCategoryPicker: () => void;
  onGalleryViewModeChange: (mode: ContentViewMode) => void;
  onGridColumnsChange: (value: number) => void;
  onDualFolderModeChange: (value: boolean) => void;
  onVariantModeChange?: (value: boolean) => void;
  onSelectionModeChange: (value: boolean) => void;
  onImportTargetSourceIdChange: (value: string) => void;
  onShareBoard: (boardId: string) => void;
  onDeleteBoard: () => void;
  onClearSelection: () => void;
  onCategoryChange: (category: string) => void;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onFavoritesOnlyChange: (value: boolean) => void;
  onColorFamilyChange: (value: string) => void;
  onSortByChange: (value: string) => void;
  onSortOrderChange: (value: string) => void;
  onPageChange: (page: number) => void;
}

export const GalleryToolbar = ({
  isTrashView,
  selectedBoard,
  selectedSubfolder,
  total,
  trashCount,
  favoritesOnly,
  isRefreshing,
  hasPendingLiveRefresh,
  activeFilterControlCount,
  showFiltersMenu,
  showColumnsMenu,
  galleryViewMode,
  gridColumns,
  effectiveColumns,
  isMobile = false,
  mobileDensity = "single",
  onMobileDensityChange,
  dualFolderMode,
  variantMode = false,
  selectionMode,
  writableSources,
  sources,
  importSubfolder,
  activeImportSourceId,
  categories,
  selectedCategory,
  dateFrom,
  dateTo,
  selectedColorFamily,
  colorIndexStatus,
  sortBy,
  sortOrder,
  searchValue = "",
  onSearchChange,
  onApplyPendingLiveRefresh,
  onToggleFiltersMenu,
  onCloseFiltersMenu,
  onToggleColumnsMenu,
  onCloseColumnsMenu,
  onOpenCategoryPicker,
  onGalleryViewModeChange,
  onGridColumnsChange,
  onDualFolderModeChange,
  onVariantModeChange,
  onSelectionModeChange,
  onImportTargetSourceIdChange,
  onShareBoard,
  onDeleteBoard,
  onClearSelection,
  onCategoryChange,
  onDateFromChange,
  onDateToChange,
  onFavoritesOnlyChange,
  onColorFamilyChange,
  onSortByChange,
  onSortOrderChange,
  onPageChange,
}: GalleryToolbarProps) => {
  const { t } = useI18n();
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const composingRef = useRef(false);
  const [searchDraft, setSearchDraft] = useState(searchValue);
  useEffect(() => {
    if (!composingRef.current) setSearchDraft(searchValue);
  }, [searchValue]);
  const resultCount = isTrashView ? trashCount : total;
  const { sourceId, relativePath } = parseFolderRef(selectedSubfolder);
  const sourceLabel = sources.find((source) => source.id === sourceId)?.name ||
    (sourceId === DEFAULT_OUTPUT_SOURCE_ID ? t("galleryOutputFolder") : sourceId);
  const folderLabel = relativePath ? `${sourceLabel} / ${relativePath}` : sourceLabel;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('[aria-modal="true"]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        searchInputRef.current?.focus();
      } else if (event.key === "/" && !isEditableTarget(event.target)) {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const hasActiveFilters = Boolean(
    searchValue.trim() ||
    selectedCategory ||
    selectedColorFamily ||
    dateFrom ||
    dateTo ||
    favoritesOnly,
  );

  const handleClearAllFilters = () => {
    onSearchChange?.("");
    onCategoryChange("");
    onColorFamilyChange("");
    onDateFromChange("");
    onDateToChange("");
    onFavoritesOnlyChange(false);
    onPageChange(1);
  };

  const viewModeToggle = (
    <div className="ue-segmented-control ue-segmented-control--compact ue-view-toggle" aria-label={t("viewMode")}>
      <button
        className={galleryViewMode === "grid" ? "active" : ""}
        onClick={() => onGalleryViewModeChange("grid")}
        aria-pressed={galleryViewMode === "grid"}
        type="button"
        aria-label={t("viewGrid")}
        title={t("viewGrid")}
      >
        <LayoutGrid size={13} />
        <span>{t("viewGrid")}</span>
      </button>
      <button
        className={galleryViewMode === "list" ? "active" : ""}
        onClick={() => onGalleryViewModeChange("list")}
        aria-pressed={galleryViewMode === "list"}
        type="button"
        aria-label={t("viewList")}
        title={t("viewList")}
      >
        <List size={13} />
        <span>{t("viewList")}</span>
      </button>
    </div>
  );

  return (
    <div className={`ue-filter-bar ue-filter-bar--gallery ${dualFolderMode ? "is-organizer" : variantMode ? "is-variants" : ""}`} data-tour-id="gallery-toolbar">
      <div className="ue-filter-copy">
        <p className="ue-filter-kicker">
          {isTrashView ? t("trashTitle") : dualFolderMode ? t("dual_title") : selectedBoard ? selectedBoard.name : favoritesOnly ? t("galleryPinnedOnly") : folderLabel}
        </p>
        <div className="ue-filter-summary">
          <strong>{resultCount}</strong>
          <span>{t(isTrashView ? "trashItemCount" : "galleryFilterResult", { count: resultCount })}</span>
          {favoritesOnly ? <em>{t("galleryPinnedOnly")}</em> : null}
          {selectedBoard ? <em>{t("sidebarBoards")}</em> : null}
          {isRefreshing ? <em>{t("commonLoading")}</em> : null}
          {hasPendingLiveRefresh && !isTrashView ? (
            <button
              className="ue-live-refresh-pill"
              type="button"
              onClick={onApplyPendingLiveRefresh}
              title={t("galleryLiveRefreshAction")}
            >
              <RotateCcw size={12} />
              <span>{t("galleryLiveRefreshPending")}</span>
            </button>
          ) : null}
        </div>
      </div>

      {!isTrashView ? (
        <>
          {onSearchChange ? (
            <div className="ue-gallery-search-box" data-tour-id="gallery-search">
              <Search size={14} className="ue-gallery-search-icon" />
              <input
                ref={searchInputRef}
                className="ue-gallery-search-input"
                value={searchDraft}
                onCompositionStart={() => { composingRef.current = true; }}
                onCompositionEnd={(event) => {
                  composingRef.current = false;
                  setSearchDraft(event.currentTarget.value);
                  onSearchChange(event.currentTarget.value);
                }}
                onChange={(event) => {
                  setSearchDraft(event.target.value);
                  if (!composingRef.current && !(event.nativeEvent as InputEvent).isComposing) onSearchChange(event.target.value);
                }}
                placeholder={t("navSearchGalleryPlaceholder")}
                aria-label={t("navSearchGalleryPlaceholder")}
              />
              {searchValue ? (
                <button
                  className="ue-gallery-search-clear"
                  onClick={() => { setSearchDraft(""); onSearchChange(""); }}
                  type="button"
                  aria-label={t("sidebarClearFolderSearch")}
                >
                  <X size={12} />
                </button>
              ) : (
                <span className="ue-gallery-search-shortcut">/</span>
              )}
            </div>
          ) : null}

          <div className="ue-filter-controls ue-filter-controls--gallery">
            <div className="ue-toolbar-group ue-toolbar-group--browse">
              <div className="ue-filter-popover">
                <button
                  className={`ue-filter-trigger ${showFiltersMenu ? "is-open" : ""} ${activeFilterControlCount ? "active" : ""}`}
                  data-tour-id="gallery-filters"
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleFiltersMenu();
                  }}
                  type="button"
                  aria-expanded={showFiltersMenu}
                  aria-label={t("galleryFilters")}
                  title={t("galleryFilters")}
                >
                  <SlidersHorizontal size={14} />
                  <span>{t("galleryFilters")}</span>
                  {activeFilterControlCount ? <strong>{activeFilterControlCount}</strong> : null}
                </button>
                {showFiltersMenu ? (
                  <GalleryFilterMenu
                    total={total}
                    activeFilterControlCount={activeFilterControlCount}
                    categories={categories}
                    selectedCategory={selectedCategory}
                    dateFrom={dateFrom}
                    dateTo={dateTo}
                    favoritesOnly={favoritesOnly}
                    selectedColorFamily={selectedColorFamily}
                    colorIndexStatus={colorIndexStatus}
                    sortBy={sortBy}
                    sortOrder={sortOrder}
                    onClose={onCloseFiltersMenu}
                    onOpenCategoryPicker={onOpenCategoryPicker}
                    onCategoryChange={onCategoryChange}
                    onDateFromChange={onDateFromChange}
                    onDateToChange={onDateToChange}
                    onFavoritesOnlyChange={onFavoritesOnlyChange}
                    onColorFamilyChange={onColorFamilyChange}
                    onSortByChange={onSortByChange}
                    onSortOrderChange={onSortOrderChange}
                    onPageChange={onPageChange}
                  />
                ) : null}
              </div>

              {viewModeToggle}
              {galleryViewMode === "grid" ? <GalleryDensityControl value={gridColumns} effectiveColumns={effectiveColumns}
                isMobile={isMobile} mobilePreset={mobileDensity} onMobilePresetChange={onMobileDensityChange}
                onListView={() => { onGalleryViewModeChange("list"); onCloseColumnsMenu(); }} open={showColumnsMenu}
                onToggle={onToggleColumnsMenu} onClose={onCloseColumnsMenu} onChange={onGridColumnsChange} /> : null}
            </div>

              <button
                className={`ue-chip-toggle ue-chip-toggle--icon ${selectionMode ? "active" : ""}`}
                data-tour-id="gallery-selection"
                aria-pressed={selectionMode}
                title={t("bulkSelectionHint")}
                aria-label={t("bulkSelectMode")}
                onClick={() => {
                  onSelectionModeChange(!selectionMode);
                  onClearSelection();
                }}
                type="button"
              >
                <CheckSquare size={15} /><span>{t("bulkSelectMode")}</span>
              </button>
            <DisclosureMenu label={t("moreActions")} icon={<MoreHorizontal size={18} />} className="ue-toolbar-more">
            <div className="ue-toolbar-group ue-toolbar-group--state">
              <button
                className={`ue-chip-toggle ue-chip-toggle--icon ${dualFolderMode ? "active" : ""}`}
                title={t(dualFolderMode ? "organizeFoldersClose" : "organizeFoldersOpen")}
                aria-label={t(dualFolderMode ? "organizeFoldersClose" : "organizeFoldersOpen")}
                onClick={() => {
                  onDualFolderModeChange(!dualFolderMode);
                  onVariantModeChange?.(false);
                  onClearSelection();
                }}
                type="button"
              >
                <Columns2 size={15} /><span>{t("organizeFolders")}</span>
              </button>
              <button
                className={`ue-chip-toggle ue-chip-toggle--icon ${variantMode ? "active" : ""}`}
                title={t("variantToolbar")}
                aria-label={t("variantToolbar")}
                onClick={() => {
                  onVariantModeChange?.(!variantMode);
                  onDualFolderModeChange(false);
                  onClearSelection();
                }}
                type="button"
              >
                <Layers3 size={15} /><span>{t("variantToolbar")}</span>
              </button>
              {selectedBoard ? (
                <>
                  <button
                    className="ue-chip-toggle ue-chip-toggle--icon"
                    onClick={() => onShareBoard(selectedBoard.id)}
                    aria-label={t("boardShareTitle")}
                    title={t("boardShareTitle")}
                    type="button"
                  >
                    <Share2 size={15} /><span>{t("boardShareTitle")}</span>
                  </button>
                  <button
                    className="ue-chip-toggle ue-chip-toggle--icon"
                    onClick={onDeleteBoard}
                    aria-label={t("boardDeleteTitle")}
                    title={t("boardDeleteTitle")}
                    type="button"
                  >
                    <Trash2 size={15} /><span>{t("boardDeleteTitle")}</span>
                  </button>
                </>
              ) : null}

            </div>
            {writableSources.length > 0 ? (
              <div className="ue-toolbar-group ue-toolbar-group--source">
                <label className="ue-select-field ue-select-field--compact" title={t("galleryImportTarget")}>
                  <select
                    value={activeImportSourceId}
                    onChange={(event) => onImportTargetSourceIdChange(event.target.value)}
                    aria-label={t("galleryImportTarget")}
                  >
                    {writableSources.map((source) => (
                      <option key={source.id} value={source.id}>
                        {source.name} / {importSubfolder}/
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
            </DisclosureMenu>
          </div>

          {/* Active Filter Badges */}
          {hasActiveFilters ? (
            <div className="ue-active-filters-row">
              {searchValue ? (
                <div className="ue-filter-active-chip">
                  <Search size={11} />
                  <span>&quot;{searchValue}&quot;</span>
                  <button onClick={() => onSearchChange?.("")} type="button" aria-label={t("clearSearch")}>
                    <X size={10} />
                  </button>
                </div>
              ) : null}

              {selectedCategory ? (
                <div className="ue-filter-active-chip">
                  <Tag size={11} />
                  <span>{selectedCategory}</span>
                  <button onClick={() => onCategoryChange("")} type="button" aria-label={t("clearCategory")}>
                    <X size={10} />
                  </button>
                </div>
              ) : null}

              {selectedColorFamily ? (
                <div className="ue-filter-active-chip">
                  <Palette size={11} />
                  <span>{selectedColorFamily}</span>
                  <button onClick={() => onColorFamilyChange("")} type="button" aria-label={t("clearColor")}>
                    <X size={10} />
                  </button>
                </div>
              ) : null}

              {dateFrom || dateTo ? (
                <div className="ue-filter-active-chip">
                  <Calendar size={11} />
                  <span>{dateFrom || "..."} ~ {dateTo || "..."}</span>
                  <button
                    onClick={() => {
                      onDateFromChange("");
                      onDateToChange("");
                    }}
                    type="button"
                    aria-label={t("clearDate")}
                  >
                    <X size={10} />
                  </button>
                </div>
              ) : null}

              {favoritesOnly ? (
                <div className="ue-filter-active-chip">
                  <Pin size={11} />
                  <span>{t("galleryPinnedOnly")}</span>
                  <button onClick={() => onFavoritesOnlyChange(false)} type="button" aria-label={t("clearPinned")}>
                    <X size={10} />
                  </button>
                </div>
              ) : null}

              <button className="ue-filter-clear-all-btn" onClick={handleClearAllFilters} type="button">
                {t("filterReset")}
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <div className="ue-filter-controls ue-filter-controls--gallery">
          {viewModeToggle}
        </div>
      )}
    </div>
  );
};
