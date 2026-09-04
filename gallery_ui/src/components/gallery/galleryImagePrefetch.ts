import type { ImageRecord } from "../../types/universal-gallery";

class BoundedSet {
  private readonly capacity: number;
  private readonly set = new Set<string>();

  constructor(capacity = 2500) {
    this.capacity = capacity;
  }

  has(key: string): boolean {
    return this.set.has(key);
  }

  add(key: string): void {
    if (this.set.has(key)) {
      this.set.delete(key);
      this.set.add(key);
      return;
    }
    if (this.set.size >= this.capacity) {
      const oldest = this.set.values().next().value;
      if (oldest !== undefined) {
        this.set.delete(oldest);
      }
    }
    this.set.add(key);
  }

  delete(key: string): boolean {
    return this.set.delete(key);
  }

  clear(): void {
    this.set.clear();
  }

  get size(): number {
    return this.set.size;
  }
}

const loadedImageUrls = new BoundedSet(2500);
const prefetchedImageUrls = new BoundedSet(2500);
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
      preloadImage.onload = null;
      preloadImage.onerror = null;
      try {
        preloadImage.src = "";
      } catch {
        // Safe fallback
      }
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
