import { CalendarX, Check, Pin } from "lucide-react";

import { useI18n } from "../../i18n/I18nProvider";
import type { ColorIndexStatus } from "../../types/universal-gallery";
import { COLOR_FILTERS, SORT_OPTIONS, SORT_ORDER_OPTIONS, getColorFamilyShortLabel } from "./galleryWorkspaceModel";

interface GalleryFilterMenuProps {
  total: number;
  activeFilterControlCount: number;
  categories: string[];
  selectedCategory: string;
  dateFrom: string;
  dateTo: string;
  favoritesOnly: boolean;
  selectedColorFamily: string;
  colorIndexStatus: ColorIndexStatus | null;
  sortBy: string;
  sortOrder: string;
  onClose: () => void;
  onOpenCategoryPicker: () => void;
  onCategoryChange: (category: string) => void;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onFavoritesOnlyChange: (value: boolean) => void;
  onColorFamilyChange: (value: string) => void;
  onSortByChange: (value: string) => void;
  onSortOrderChange: (value: string) => void;
  onPageChange: (page: number) => void;
}

export const GalleryFilterMenu = ({
  total,
  activeFilterControlCount,
  categories,
  selectedCategory,
  dateFrom,
  dateTo,
  favoritesOnly,
  selectedColorFamily,
  colorIndexStatus,
  sortBy,
  sortOrder,
  onClose,
  onOpenCategoryPicker,
  onCategoryChange,
  onDateFromChange,
  onDateToChange,
  onFavoritesOnlyChange,
  onColorFamilyChange,
  onSortByChange,
  onSortOrderChange,
  onPageChange,
}: GalleryFilterMenuProps) => {
  const { t } = useI18n();
  const selectedColorFilter = COLOR_FILTERS.find((option) => option.value === selectedColorFamily);
  const selectedSortOption = SORT_OPTIONS.find((option) => option.value === sortBy) ?? SORT_OPTIONS[0];
  const selectedSortOrderOption = SORT_ORDER_OPTIONS.find((option) => option.value === sortOrder) ?? SORT_ORDER_OPTIONS[0];
  const topCategories = categories.slice(0, 8);
  const getColorFamilyLabel = (value: string) => t(`colorFamily_${value}`);
  const getShortColorFamilyLabel = (value: string) => getColorFamilyShortLabel(value, getColorFamilyLabel(value));

  const resetFilters = () => {
    onCategoryChange("");
    onDateFromChange("");
    onDateToChange("");
    onFavoritesOnlyChange(false);
    onColorFamilyChange("");
    onSortByChange("created_at");
    onSortOrderChange("desc");
    onPageChange(1);
  };

  const activeFilterChips = [
    selectedCategory
      ? {
          key: "category",
          label: selectedCategory,
          onClear: () => {
            onCategoryChange("");
            onPageChange(1);
          },
        }
      : null,
    selectedColorFilter
      ? {
          key: "color",
          label: getColorFamilyLabel(selectedColorFilter.value),
          color: selectedColorFilter.color,
          onClear: () => {
            onColorFamilyChange("");
            onPageChange(1);
          },
        }
      : null,
    dateFrom
      ? {
          key: "dateFrom",
          label: `${t("galleryDateFrom")} ${dateFrom}`,
          onClear: () => {
            onDateFromChange("");
            onPageChange(1);
          },
        }
      : null,
    dateTo
      ? {
          key: "dateTo",
          label: `${t("galleryDateTo")} ${dateTo}`,
          onClear: () => {
            onDateToChange("");
            onPageChange(1);
          },
        }
      : null,
    favoritesOnly
      ? {
          key: "favorites",
          label: t("galleryPinnedOnly"),
          onClear: () => {
            onFavoritesOnlyChange(false);
            onPageChange(1);
          },
        }
      : null,
  ].filter(Boolean) as Array<{ key: string; label: string; color?: string; onClear: () => void }>;

  return (
    <div className="ue-filter-menu" onClick={(event) => event.stopPropagation()}>
      <div className="ue-filter-menu-head">
        <div>
          <span>{t("galleryFilters")}</span>
          <strong>
            {t("galleryFilterResult", { count: total })} · {t("galleryFiltersRealtime")}
          </strong>
        </div>
        <div className="ue-filter-menu-head-actions">
          {activeFilterControlCount ? (
            <button
              className="ue-filter-reset-btn"
              onClick={resetFilters}
              aria-label={t("galleryDateClear")}
              title={t("galleryDateClear")}
              type="button"
            >
              <CalendarX size={13} />
              <span>{t("galleryDateClear")}</span>
            </button>
          ) : null}
        </div>
      </div>

      <div className="ue-filter-menu-body">
        <section className="ue-filter-section ue-filter-section--summary">
          <div className="ue-filter-section-head">
            <span>{t("galleryActiveFilters")}</span>
          </div>
          <div className="ue-active-filter-row">
            {activeFilterChips.length ? (
              activeFilterChips.map((chip) => (
                <button
                  key={chip.key}
                  className="ue-active-filter-chip"
                  onClick={chip.onClear}
                  type="button"
                  title={`${chip.label} · ${t("galleryDateClear")}`}
                >
                  {chip.color ? <span className="ue-active-filter-dot" style={{ background: chip.color }} /> : null}
                  <span>{chip.label}</span>
                  <span aria-hidden="true">×</span>
                </button>
              ))
            ) : (
              <span className="ue-active-filter-empty">{t("galleryFilterNone")}</span>
            )}
          </div>
        </section>

        <section className="ue-filter-section">
          <div className="ue-filter-section-head">
            <span>{t("galleryCategory")}</span>
            {categories.length > 8 ? (
              <button className="ue-filter-link" onClick={onOpenCategoryPicker} type="button">
                {t("galleryMoreCategories")}
              </button>
            ) : null}
          </div>
          <div className="ue-filter-chip-grid">
            <button
              className={`ue-filter-chip ${selectedCategory === "" ? "active" : ""}`}
              onClick={() => {
                onCategoryChange("");
                onPageChange(1);
              }}
              type="button"
            >
              {t("galleryAllCategories")}
            </button>
            {topCategories.map((category) => (
              <button
                key={category}
                className={`ue-filter-chip ${selectedCategory === category ? "active" : ""}`}
                onClick={() => {
                  onCategoryChange(category);
                  onPageChange(1);
                }}
                type="button"
              >
                {category}
              </button>
            ))}
          </div>
        </section>

        <section className="ue-filter-section">
          <div className="ue-filter-section-head">
            <span>{t("gallerySort")}</span>
          </div>
          <div className="ue-filter-sort-row">
            <div className="ue-sort-segment" role="group" aria-label={t("gallerySort")}>
              {SORT_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  className={sortBy === option.value ? "active" : ""}
                  onClick={() => {
                    onSortByChange(option.value);
                    onPageChange(1);
                  }}
                  type="button"
                  title={t(option.hintKey)}
                >
                  {t(option.labelKey)}
                </button>
              ))}
            </div>
            <div className="ue-sort-direction">
              {SORT_ORDER_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  className={sortOrder === option.value ? "active" : ""}
                  onClick={() => {
                    onSortOrderChange(option.value);
                    onPageChange(1);
                  }}
                  type="button"
                >
                  <strong>{t(option.labelKey)}</strong>
                  <span>{t(option.hintKey)}</span>
                </button>
              ))}
            </div>
          </div>
          <p className="ue-sort-current">
            {t(selectedSortOption.hintKey)} · {t(selectedSortOrderOption.hintKey)}
          </p>
        </section>

        <section className="ue-filter-section">
          <div className="ue-filter-section-head ue-filter-section-head--inline">
            <span>{t("galleryColorFamily")}</span>
            <em>{t("galleryColorThreshold")}</em>
          </div>
          <div className="ue-color-palette-grid">
            <button
              className={`ue-color-palette ${selectedColorFamily === "" ? "active" : ""}`}
              onClick={() => {
                onColorFamilyChange("");
                onPageChange(1);
              }}
              type="button"
            >
              <span className="ue-color-palette-swatch ue-color-swatch--all" />
              <em>{t("galleryAllColors").replace(/色系$/, "").replace(/ colors$/i, "")}</em>
            </button>
            {COLOR_FILTERS.map((option) => (
              <button
                key={option.value}
                className={`ue-color-palette ${selectedColorFamily === option.value ? "active" : ""}`}
                onClick={() => {
                  onColorFamilyChange(option.value);
                  onPageChange(1);
                }}
                type="button"
                title={getColorFamilyLabel(option.value)}
              >
                <span className="ue-color-palette-swatch" style={{ background: option.color }} />
                <em>{getShortColorFamilyLabel(option.value)}</em>
              </button>
            ))}
          </div>
          {colorIndexStatus && !colorIndexStatus.complete ? (
            <p className="ue-color-index-note">
              {t("galleryColorIndexing")} {colorIndexStatus.indexed}/{colorIndexStatus.total}
            </p>
          ) : null}
        </section>

        <section className="ue-filter-section">
          <div className="ue-filter-section-head">
            <span>{t("galleryDateRange")}</span>
          </div>
          <div className="ue-filter-menu-grid ue-filter-menu-grid--date">
            <label className="ue-select-field ue-select-field--input ue-date-filter-field">
              <span>{t("galleryDateFrom")}</span>
              <input
                type="date"
                value={dateFrom}
                max={dateTo || undefined}
                onChange={(event) => {
                  onDateFromChange(event.target.value);
                  onPageChange(1);
                }}
              />
            </label>

            <label className="ue-select-field ue-select-field--input ue-date-filter-field">
              <span>{t("galleryDateTo")}</span>
              <input
                type="date"
                value={dateTo}
                min={dateFrom || undefined}
                onChange={(event) => {
                  onDateToChange(event.target.value);
                  onPageChange(1);
                }}
              />
            </label>

            <button
              className={`ue-filter-option ${favoritesOnly ? "active" : ""}`}
              onClick={() => {
                onFavoritesOnlyChange(!favoritesOnly);
                onPageChange(1);
              }}
              type="button"
            >
              <Pin size={14} fill={favoritesOnly ? "currentColor" : "none"} />
              <span>{t("galleryPinnedOnly")}</span>
              <Check size={14} />
            </button>
          </div>
        </section>
      </div>

      <div className="ue-filter-menu-foot">
        <span>{t("galleryFilterStickyHint")}</span>
        <button type="button" onClick={onClose}>
          {t("galleryFilterClose")}
        </button>
      </div>
    </div>
  );
};
