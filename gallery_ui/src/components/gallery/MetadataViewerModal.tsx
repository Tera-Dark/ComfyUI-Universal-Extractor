import { useEffect, useState } from "react";
import { ClipboardCopy, FileJson, X } from "lucide-react";

import { useI18n } from "../../i18n/I18nProvider";
import { galleryApi } from "../../services/galleryApi";
import type { ImageMetadata, ImageRecord } from "../../types/universal-gallery";
import { getPositivePromptText, stringifyImageMetadata } from "../../utils/metadata";
import { useToast } from "../shared/ToastViewport";

interface MetadataViewerModalProps {
  image: ImageRecord;
  onClose: () => void;
}

export const MetadataViewerModal = ({ image, onClose }: MetadataViewerModalProps) => {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const [metadata, setMetadata] = useState<ImageMetadata | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setError(null);

    const loadMetadata = async () => {
      try {
        const response = await galleryApi.getImageMetadata(image.relative_path);
        if (!cancelled) {
          setMetadata(response);
        }
      } catch (fetchError) {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : t("metadataLoadError"));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadMetadata();

    return () => {
      cancelled = true;
    };
  }, [image.relative_path, t]);

  const copyText = async (value: string, successMessage: string) => {
    if (!value.trim()) {
      pushToast(t("metadataNoPositivePrompt"), "info");
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      pushToast(successMessage, "success");
    } catch (copyError) {
      pushToast(copyError instanceof Error ? copyError.message : t("contextCopyError"), "error");
    }
  };

  const positivePrompt = getPositivePromptText(metadata);
  const rawMetadata = stringifyImageMetadata(metadata);
  const hasMetadata = Boolean(
    metadata?.metadata ||
      metadata?.workflow ||
      metadata?.summary?.positive_prompt ||
      metadata?.summary?.negative_prompt,
  );

  return (
    <div className="ue-modal-backdrop ue-metadata-backdrop" onClick={onClose}>
      <section className="ue-metadata-modal" onClick={(event) => event.stopPropagation()} aria-label={t("metadataView")}>
        <header className="ue-metadata-head">
          <div>
            <span>{t("metadataView")}</span>
            <h2 title={image.filename}>{image.filename}</h2>
          </div>
          <button className="ue-icon-action" type="button" onClick={onClose} aria-label={t("modalClose")}>
            <X size={15} />
          </button>
        </header>

        {isLoading ? (
          <div className="ue-detail-state">
            <div className="ue-loading-orb" />
            <p>{t("modalLoading")}</p>
          </div>
        ) : error ? (
          <div className="ue-inline-error">{error}</div>
        ) : !hasMetadata ? (
          <div className="ue-detail-state ue-detail-state--empty">
            <p>{t("modalNoMetadata")}</p>
          </div>
        ) : (
          <>
            <div className="ue-metadata-actions">
              <button
                className="ue-secondary-btn"
                type="button"
                onClick={() => void copyText(positivePrompt, t("metadataCopyPositiveSuccess"))}
              >
                <ClipboardCopy size={14} />
                <span>{t("metadataCopyPositive")}</span>
              </button>
              <button
                className="ue-secondary-btn"
                type="button"
                onClick={() => void copyText(rawMetadata, t("metadataCopyRawSuccess"))}
              >
                <FileJson size={14} />
                <span>{t("metadataCopyRaw")}</span>
              </button>
            </div>

            <div className="ue-metadata-summary">
              <label>
                <span>{t("metadataPositivePrompt")}</span>
                <textarea value={positivePrompt || t("metadataNoPositivePrompt")} readOnly />
              </label>
              <label>
                <span>{t("metadataNegativePrompt")}</span>
                <textarea value={metadata?.summary?.negative_prompt || t("metadataNoNegativePrompt")} readOnly />
              </label>
            </div>

            <details className="ue-detail-disclosure" open>
              <summary>
                <FileJson size={15} />
                <span>{t("modalRawMetadata")}</span>
              </summary>
              <pre className="ue-meta-raw">{rawMetadata}</pre>
            </details>
          </>
        )}
      </section>
    </div>
  );
};
