import { useCallback, useState, type MouseEvent } from "react";
import { ImageOff, RotateCcw } from "lucide-react";

import { useI18n } from "../../i18n/I18nProvider";
import type { ImageRecord } from "../../types/universal-gallery";
import { getGalleryImageUrl, isGalleryImageLoaded, markGalleryImageLoaded } from "./galleryImagePrefetch";

interface Props {
  image: ImageRecord;
  priority?: boolean;
  onOpenDetail: (image: ImageRecord, event: MouseEvent<HTMLElement>) => void;
}

export const GalleryCardImage = (props: Props) => {
  const imageUrl = getGalleryImageUrl(props.image);
  // A new source/version owns its own state and retry counter immediately.
  // Old load/error events cannot hide a replacement or mark its URL as loaded.
  return <GalleryImageRequest key={imageUrl} {...props} imageUrl={imageUrl} />;
};

const GalleryImageRequest = ({
  image,
  priority = false,
  onOpenDetail,
  imageUrl,
}: Props & { imageUrl: string }) => {
  const { t } = useI18n();
  const [loaded, setLoaded] = useState(() => isGalleryImageLoaded(imageUrl));
  const [hasError, setHasError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  const markLoaded = useCallback(() => {
    markGalleryImageLoaded(imageUrl);
    setLoaded(true);
    setHasError(false);
  }, [imageUrl]);
  const captureImage = useCallback((node: HTMLImageElement | null) => {
    // A cached image can already be complete before React receives onLoad.
    if (node?.complete && node.naturalWidth > 0) markLoaded();
  }, [markLoaded]);

  const handleError = () => {
    setLoaded(true);
    setHasError(true);
  };

  const handleRetry = (event: MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setHasError(false);
    setLoaded(false);
    setRetryKey((prev) => prev + 1);
  };

  const effectiveUrl = retryKey > 0 ? `${imageUrl}${imageUrl.includes("?") ? "&" : "?"}_retry=${retryKey}` : imageUrl;

  return (
    <div className={`ue-gallery-image-shell ${loaded ? "is-loaded" : ""} ${hasError ? "has-error" : ""}`}>
      {hasError ? (
        <div
          className="ue-gallery-image-fallback"
          onClick={(event) => onOpenDetail(image, event)}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault(); event.currentTarget.click();
            }
          }}
          title={image.filename}
        >
          <div className="ue-gallery-image-fallback-icon">
            <ImageOff size={22} />
          </div>
          <span className="ue-gallery-image-fallback-text">{image.filename}</span>
          <button
            type="button"
            className="ue-gallery-image-retry-btn"
            onClick={handleRetry}
            title={t("imageRetry")}
            aria-label={t("imageRetry")}
          >
            <RotateCcw size={12} />
            <span>{t("imageRetryShort")}</span>
          </button>
        </div>
      ) : (
        <img
          key={retryKey}
          ref={captureImage}
          src={effectiveUrl}
          alt={image.title || image.filename}
          role="button"
          tabIndex={0}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault(); event.currentTarget.click();
            }
          }}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          onLoad={markLoaded}
          onError={handleError}
          onClick={(event) => onOpenDetail(image, event)}
        />
      )}
    </div>
  );
};

