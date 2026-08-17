export type ContentViewMode = "grid" | "list";

export const COLOR_FILTERS = [
  { value: "red", color: "#dc2626" },
  { value: "orange", color: "#f97316" },
  { value: "yellow", color: "#eab308" },
  { value: "green", color: "#16a34a" },
  { value: "cyan", color: "#06b6d4" },
  { value: "blue", color: "#2563eb" },
  { value: "purple", color: "#7c3aed" },
  { value: "pink", color: "#ec4899" },
  { value: "brown", color: "#92400e" },
  { value: "black", color: "#18181b" },
  { value: "white", color: "#ffffff" },
  { value: "gray", color: "#71717a" },
  { value: "warm", color: "linear-gradient(135deg, #dc2626, #f97316, #eab308)" },
  { value: "cool", color: "linear-gradient(135deg, #16a34a, #06b6d4, #2563eb)" },
  { value: "low_saturation", color: "linear-gradient(135deg, #d4d4d8, #71717a)" },
] as const;

export const SORT_OPTIONS = [
  { value: "created_at", labelKey: "gallerySortNewest", hintKey: "gallerySortNewestHint" },
  { value: "filename", labelKey: "gallerySortName", hintKey: "gallerySortNameHint" },
  { value: "size", labelKey: "gallerySortSize", hintKey: "gallerySortSizeHint" },
] as const;

export const SORT_ORDER_OPTIONS = [
  { value: "desc", labelKey: "gallerySortDesc", hintKey: "gallerySortDescHint" },
  { value: "asc", labelKey: "gallerySortAsc", hintKey: "gallerySortAscHint" },
] as const;

export const getStoredViewMode = (key: string, fallback: ContentViewMode): ContentViewMode => {
  const stored = window.localStorage.getItem(key);
  return stored === "grid" || stored === "list" ? stored : fallback;
};

export const getActiveFilterControlCount = ({
  selectedCategory,
  dateFrom,
  dateTo,
  favoritesOnly,
  selectedColorFamily,
  sortBy,
  sortOrder,
}: {
  selectedCategory: string;
  dateFrom: string;
  dateTo: string;
  favoritesOnly: boolean;
  selectedColorFamily: string;
  sortBy: string;
  sortOrder: string;
}) => {
  const activeFilterCount = [selectedCategory, dateFrom, dateTo, favoritesOnly, selectedColorFamily].filter(Boolean).length;
  return activeFilterCount + (sortBy !== "created_at" || sortOrder !== "desc" ? 1 : 0);
};

export const getColorFamilyShortLabel = (value: string, label: string) => {
  if (value === "low_saturation") {
    return label.includes(" ") ? label.split(" ")[0] : label;
  }
  if (label.endsWith("色") && label.length <= 3) {
    return label.slice(0, -1);
  }
  return label;
};
