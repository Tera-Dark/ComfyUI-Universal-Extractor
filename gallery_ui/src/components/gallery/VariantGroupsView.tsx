import { CopyCheck, FileStack, Fingerprint, GitBranch, Image as ImageIcon, Layers3, RotateCcw } from "lucide-react";

import { useI18n } from "../../i18n/I18nProvider";
import type { FingerprintIndexStatus, VariantGroup, VariantGroupType } from "../../types/universal-gallery";
import { formatCompactDate } from "../../utils/formatters";
import { getGalleryImageUrl } from "./galleryImagePrefetch";

const FILTERS: Array<{ value: VariantGroupType | ""; icon: typeof Layers3; key: string }> = [
  { value: "", icon: Layers3, key: "variantFilterAll" },
  { value: "exact_duplicate", icon: CopyCheck, key: "variantType_exact_duplicate" },
  { value: "near_duplicate", icon: Fingerprint, key: "variantType_near_duplicate" },
  { value: "same_prompt", icon: FileStack, key: "variantType_same_prompt" },
  { value: "same_workflow", icon: GitBranch, key: "variantType_same_workflow" },
  { value: "filename_series", icon: ImageIcon, key: "variantType_filename_series" },
];

interface VariantGroupsViewProps {
  groups: VariantGroup[];
  selectedType: VariantGroupType | "";
  status: FingerprintIndexStatus | null;
  loading: boolean;
  error: string;
  onTypeChange: (type: VariantGroupType | "") => void;
  onRefresh: () => void;
  onOpenGroup: (group: VariantGroup) => void;
}

export const VariantGroupsView = ({
  groups,
  selectedType,
  status,
  loading,
  error,
  onTypeChange,
  onRefresh,
  onOpenGroup,
}: VariantGroupsViewProps) => {
  const { t } = useI18n();
  return (
    <div className="ue-variant-workspace">
      <header className="ue-variant-hero">
        <div>
          <span className="ue-section-kicker">{t("variantKicker")}</span>
          <h2>{t("variantTitle")}</h2>
          <p>{t("variantSubtitle")}</p>
        </div>
        <button className="ue-secondary-action" type="button" onClick={onRefresh} disabled={loading}>
          <RotateCcw size={15} />
          <span>{loading ? t("variantAnalyzing") : t("variantRefresh")}</span>
        </button>
      </header>

      <div className="ue-variant-filter-row" aria-label={t("variantFilters")}>
        {FILTERS.map(({ value, icon: Icon, key }) => (
          <button
            key={value || "all"}
            className={selectedType === value ? "is-active" : ""}
            type="button"
            onClick={() => onTypeChange(value)}
          >
            <Icon size={14} />
            <span>{t(key)}</span>
          </button>
        ))}
      </div>

      {status ? (
        <div className="ue-variant-status">
          <span>{t("variantIndexed", { count: status.indexed })}</span>
          <span>{t("variantPending", { count: status.pending })}</span>
          {status.failed ? <span>{t("variantFailed", { count: status.failed })}</span> : null}
        </div>
      ) : null}

      {error ? <div className="ue-inline-error">{error}</div> : null}
      {loading && !groups.length ? (
        <div className="ue-gallery-state">
          <div className="ue-loading-orb" />
          <p>{t("variantAnalyzing")}</p>
        </div>
      ) : groups.length === 0 ? (
        <div className="ue-gallery-state ue-gallery-state--empty">
          <Layers3 size={42} strokeWidth={1.2} />
          <div>
            <h3>{t("variantEmptyTitle")}</h3>
            <p>{t("variantEmptyText")}</p>
          </div>
        </div>
      ) : (
        <div className="ue-variant-grid">
          {groups.map((group) => (
            <button key={group.id} className="ue-variant-card" type="button" onClick={() => onOpenGroup(group)}>
              <span className="ue-variant-cover">
                <img src={getGalleryImageUrl(group.cover_image)} alt={group.cover_image.filename} loading="lazy" decoding="async" />
              </span>
              <span className="ue-variant-card-main">
                <span className="ue-variant-card-topline">
                  <strong>{t(`variantType_${group.type}`)}</strong>
                  <em>{Math.round(group.confidence * 100)}%</em>
                </span>
                <span className="ue-variant-card-title" title={group.title}>{group.title}</span>
                <span className="ue-variant-card-meta">
                  {t("variantImageCount", { count: group.count })}
                  <span>{formatCompactDate(group.latest_created_at)}</span>
                </span>
                <span className="ue-variant-preview-strip">
                  {group.images_preview.slice(0, 4).map((image) => (
                    <img key={image.relative_path} src={getGalleryImageUrl(image)} alt={image.filename} loading="lazy" decoding="async" />
                  ))}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
