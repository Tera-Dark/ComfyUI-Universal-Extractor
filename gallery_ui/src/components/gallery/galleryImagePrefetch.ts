import type { ImageRecord } from "../../types/universal-gallery";

const loadedImageUrls = new Set<string>();
const prefetchedImageUrls = new Set<string>();
const queuedImageUrls = new Set<string>();
const imagePrefetchQueue: string[] = [];
const MAX_IMAGE_PREFETCH_CONCURRENCY = 4;
let activeImagePrefetches = 0;

export const getGalleryImageUrl = (image: ImageRecord) => image.thumb_url || image.url;

export const isGalleryImageLoaded = (imageUrl: string) => loadedImageUrls.has(imageUrl);

export const markGalleryImageLoaded = (imageUrl: string) => {
  loadedImageUrls.add(imageUrl);
};

const pumpImagePrefetchQueue = () => {
  while (activeImagePrefetches < MAX_IMAGE_PREFETCH_CONCURRENCY && imagePrefetchQueue.length) {
    const imageUrl = imagePrefetchQueue.shift();
    if (!imageUrl) {
      continue;
    }

    queuedImageUrls.delete(imageUrl);
    activeImagePrefetches += 1;
    const preloadImage = new Image();
    preloadImage.decoding = "async";
    const finish = (loaded: boolean) => {
      if (loaded) {
        loadedImageUrls.add(imageUrl);
      } else {
        prefetchedImageUrls.delete(imageUrl);
      }
      activeImagePrefetches = Math.max(0, activeImagePrefetches - 1);
      pumpImagePrefetchQueue();
    };

    preloadImage.onload = () => finish(true);
    preloadImage.onerror = () => finish(false);
    preloadImage.src = imageUrl;
  }
};

export const prefetchGalleryImage = (image: ImageRecord) => {
  const imageUrl = getGalleryImageUrl(image);
  if (!imageUrl || loadedImageUrls.has(imageUrl) || prefetchedImageUrls.has(imageUrl) || queuedImageUrls.has(imageUrl)) {
    return;
  }

  prefetchedImageUrls.add(imageUrl);
  queuedImageUrls.add(imageUrl);
  imagePrefetchQueue.push(imageUrl);
  pumpImagePrefetchQueue();
};
