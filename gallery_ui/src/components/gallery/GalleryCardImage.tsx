import { useEffect, useState, type MouseEvent } from "react";
import { ImageOff, RotateCcw } from "lucide-react";

import type { ImageRecord } from "../../types/universal-gallery";
import { getGalleryImageUrl, isGalleryImageLoaded, markGalleryImageLoaded } from "./galleryImagePrefetch";

export const GalleryCardImage = ({
  image,
  priority = false,
  onOpenDetail,
}: {
  image: ImageRecord;
  priority?: boolean;
  onOpenDetail: (image: ImageRecord, event: MouseEvent<HTMLElement>) => void;
}) => {
  const imageUrl = getGalleryImageUrl(image);
  const [loaded, setLoaded] = useState(() => isGalleryImageLoaded(imageUrl));
  const [hasError, setHasError] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    setLoaded(isGalleryImageLoaded(imageUrl));
    setHasError(false);
  }, [imageUrl]);

  const markLoaded = () => {
    markGalleryImageLoaded(imageUrl);
    setLoaded(true);
    setHasError(false);
  };

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
            title="重试加载"
            aria-label="重试加载"
          >
            <RotateCcw size={12} />
            <span>重试</span>
          </button>
        </div>
      ) : (
        <img
          key={retryKey}
          src={effectiveUrl}
          alt={image.title || image.filename}
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

