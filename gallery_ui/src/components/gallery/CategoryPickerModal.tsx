import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";

import { useI18n } from "../../i18n/I18nProvider";

interface CategoryPickerModalProps {
  open: boolean;
  categories: string[];
  selectedCategory: string;
  onClose: () => void;
  onSelect: (category: string) => void;
}

export const CategoryPickerModal = ({
  open,
  categories,
  selectedCategory,
  onClose,
  onSelect,
}: CategoryPickerModalProps) => {
  const { t } = useI18n();
  const [query, setQuery] = useState("");

  const filteredCategories = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return categories;
    }
    return categories.filter((category) => category.toLowerCase().includes(normalizedQuery));
  }, [categories, query]);

  if (!open) {
    return null;
  }

  return (
    <div className="ue-modal-backdrop" onClick={onClose}>
      <div className="ue-library-modal" onClick={(event) => event.stopPropagation()}>
        <button className="ue-modal-close ue-modal-close--light" onClick={onClose} aria-label={t("modalClose")}>
          <X size={18} />
        </button>

        <div className="ue-pane-copy">
          <p className="ue-pane-kicker">{t("galleryAllCategories")}</p>
          <h2>{t("galleryCategoryBrowse")}</h2>
          <p>{t("galleryCategoryBrowseHint")}</p>
        </div>

        <label className="ue-import-text-field">
          <span>{t("navSearchGalleryPlaceholder")}</span>
          <div className="ue-picker-search">
            <Search size={14} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} />
          </div>
        </label>

        <div className="ue-category-picker-list">
          <button
            className={`ue-pill ue-pill--block ${selectedCategory === "" ? "active" : ""}`}
            onClick={() => {
              onSelect("");
              onClose();
            }}
          >
            {t("galleryAllCategories")}
          </button>
          {filteredCategories.map((category) => (
            <button
              key={category}
              className={`ue-pill ue-pill--block ${selectedCategory === category ? "active" : ""}`}
              onClick={() => {
                onSelect(category);
                onClose();
              }}
            >
              {category}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};
