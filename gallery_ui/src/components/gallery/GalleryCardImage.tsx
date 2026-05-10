import { useEffect, useState, type MouseEvent } from "react";

import type { ImageRecord } from "../../types/universal-gallery";
import { getGalleryImageUrl, isGalleryImageLoaded, markGalleryImageLoaded } from "./galleryImagePrefetch";

export const GalleryCardImage = ({
  image,
  priority = false,
  onOpenDetail,
}: {
  image: ImageRecord;
  priority?: boolean;
  onOpenDetail: (image: ImageRecord, event: MouseEvent<HTMLImageElement>) => void;
}) => {
  const imageUrl = getGalleryImageUrl(image);
  const [loaded, setLoaded] = useState(() => isGalleryImageLoaded(imageUrl));

  useEffect(() => {
    setLoaded(isGalleryImageLoaded(imageUrl));
  }, [imageUrl]);

  const markLoaded = () => {
    markGalleryImageLoaded(imageUrl);
    setLoaded(true);
  };

  return (
    <div className={`ue-gallery-image-shell ${loaded ? "is-loaded" : ""}`}>
      <img
        src={imageUrl}
        alt={image.title || image.filename}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        onLoad={markLoaded}
        onError={markLoaded}
        onClick={(event) => onOpenDetail(image, event)}
      />
    </div>
  );
};
