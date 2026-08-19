import { useEffect, useRef } from "react";
import {
  Calendar,
  CheckSquare,
  ChevronDown,
  Columns2,
  LayoutGrid,
  Layers3,
  List,
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

import { useI18n } from "../../i18n/I18nProvider";
import type { BoardSummary, ColorIndexStatus, GallerySource } from "../../types/universal-gallery";
import { isEditableTarget } from "../../utils/interaction";
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
  dualFolderMode: boolean;
  variantMode?: boolean;
  selectionMode: boolean;
  writableSources: GallerySource[];
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
  dualFolderMode,
  variantMode = false,
  selectionMode,
  writableSources,
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
  const resultCount = isTrashView ? trashCount : total;

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
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
    <div className="ue-filter-bar ue-filter-bar--gallery" data-tour-id="gallery-toolbar">
      <div className="ue-filter-copy">
        <p className="ue-filter-kicker">
          {isTrashView ? t("trashTitle") : selectedBoard ? selectedBoard.name : selectedSubfolder || t("galleryOutputFolder")}
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
            <div className="ue-gallery-search-box">
              <Search size={14} className="ue-gallery-search-icon" />
              <input
                ref={searchInputRef}
                className="ue-gallery-search-input"
                value={searchValue}
                onChange={(event) => onSearchChange(event.target.value)}
                placeholder={t("navSearchGalleryPlaceholder")}
                aria-label={t("navSearchGalleryPlaceholder")}
              />
              {searchValue ? (
                <button
                  className="ue-gallery-search-clear"
                  onClick={() => onSearchChange("")}
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
              {galleryViewMode === "grid" ? (
                <div className="ue-select-field ue-select-field--menu">
                  <span>{t("galleryColumns")}</span>
                  <button
                    className={`ue-select-field__menu-trigger ${showColumnsMenu ? "is-open" : ""}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleColumnsMenu();
                    }}
                    type="button"
                  >
                    <span>{gridColumns}</span>
                    <ChevronDown size={14} />
                  </button>
                  {showColumnsMenu ? (
                    <div className="ue-select-field__menu" onClick={(event) => event.stopPropagation()}>
                      {Array.from({ length: 6 }, (_, index) => index + 3).map((count) => (
                        <button
                          key={count}
                          className={gridColumns === count ? "is-active" : ""}
                          onClick={() => {
                            onGridColumnsChange(count);
                            onCloseColumnsMenu();
                          }}
                          type="button"
                        >
                          {count}
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="ue-toolbar-group ue-toolbar-group--state">
              <button
                className={`ue-chip-toggle ue-chip-toggle--icon ${dualFolderMode ? "active" : ""}`}
                title={dualFolderMode ? "关闭双栏目录整理" : "开启双栏目录整理"}
                aria-label={dualFolderMode ? "关闭双栏目录整理" : "开启双栏目录整理"}
                onClick={() => {
                  onDualFolderModeChange(!dualFolderMode);
                  onVariantModeChange?.(false);
                  onClearSelection();
                }}
                type="button"
              >
                <Columns2 size={13} />
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
                <Layers3 size={13} />
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
                    <Share2 size={13} />
                  </button>
                  <button
                    className="ue-chip-toggle ue-chip-toggle--icon"
                    onClick={onDeleteBoard}
                    aria-label={t("boardDeleteTitle")}
                    title={t("boardDeleteTitle")}
                    type="button"
                  >
                    <Trash2 size={13} />
                  </button>
                </>
              ) : null}
              <button
                className={`ue-chip-toggle ue-chip-toggle--icon ${selectionMode ? "active" : ""}`}
                data-tour-id="gallery-selection"
                title={t("bulkSelectionHint")}
                aria-label={t("bulkSelectMode")}
                onClick={() => {
                  onSelectionModeChange(!selectionMode);
                  onClearSelection();
                }}
                type="button"
              >
                <CheckSquare size={13} />
              </button>
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
                        {source.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
          </div>

          {/* Active Filter Badges */}
          {hasActiveFilters ? (
            <div className="ue-active-filters-row">
              {searchValue ? (
                <div className="ue-filter-active-chip">
                  <Search size={11} />
                  <span>&quot;{searchValue}&quot;</span>
                  <button onClick={() => onSearchChange?.("")} type="button" aria-label="Clear search">
                    <X size={10} />
                  </button>
                </div>
              ) : null}

              {selectedCategory ? (
                <div className="ue-filter-active-chip">
                  <Tag size={11} />
                  <span>{selectedCategory}</span>
                  <button onClick={() => onCategoryChange("")} type="button" aria-label="Clear category">
                    <X size={10} />
                  </button>
                </div>
              ) : null}

              {selectedColorFamily ? (
                <div className="ue-filter-active-chip">
                  <Palette size={11} />
                  <span>{selectedColorFamily}</span>
                  <button onClick={() => onColorFamilyChange("")} type="button" aria-label="Clear color">
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
                    aria-label="Clear date"
                  >
                    <X size={10} />
                  </button>
                </div>
              ) : null}

              {favoritesOnly ? (
                <div className="ue-filter-active-chip">
                  <Pin size={11} />
                  <span>{t("galleryPinnedOnly")}</span>
                  <button onClick={() => onFavoritesOnlyChange(false)} type="button" aria-label="Clear pin filter">
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
