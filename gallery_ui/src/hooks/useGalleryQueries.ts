import { useEffect, useRef, useState } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { galleryApi } from "../services/galleryApi";
import { synchronizeGalleryIndex } from "../services/gallerySync";
import type { ColorIndexStatus, GalleryContext, ImageRecord, TrashItem } from "../types/universal-gallery";
import { PAGE_SIZE } from "../utils/formatters";

interface GalleryQueryOptions {
  page: number;
  deferredSearchTerm: string;
  selectedCategory: string;
  selectedSubfolder: string;
  selectedBoardId: string;
  dateFrom: string;
  dateTo: string;
  favoritesOnly: boolean;
  selectedColorFamily: string;
  sortBy: string;
  sortOrder: string;
  refreshKey: number;
  isTrashView: boolean;
  isActive: boolean;
  liveRefreshViewKey: string;
  scheduleThumbnailPrewarm: (images: ImageRecord[]) => void;
  completeRefreshPart: (key: number, part: "context" | "images", error?: Error) => void;
}

/** Owns scoped query results, request cancellation and refresh completion. */
export const useGalleryQueries = (options: GalleryQueryOptions) => {
  const { t } = useI18n();
  const { page, deferredSearchTerm, selectedCategory, selectedSubfolder, selectedBoardId, dateFrom, dateTo, favoritesOnly, selectedColorFamily, sortBy, sortOrder, refreshKey, isTrashView, isActive, scheduleThumbnailPrewarm, liveRefreshViewKey, completeRefreshPart } = options;
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [context, setContext] = useState<GalleryContext | null>(null);
  const [colorIndexStatus, setColorIndexStatus] = useState<ColorIndexStatus | null>(null);
  const [total, setTotal] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const hasLoadedImagesRef = useRef(false);
  const hasLoadedTrashRef = useRef(false);
  const consumedContextRefreshKeyRef = useRef(0);
  const consumedImagesRefreshKeyRef = useRef(0);
  const [loadedViewKey, setLoadedViewKey] = useState<string | null>(null);
  const loadedViewKeyRef = useRef<string | null>(null);

  useEffect(() => {
    let isCancelled = false;
    const controller = new AbortController();
    const shouldForceRefresh = refreshKey > 0 && consumedContextRefreshKeyRef.current !== refreshKey;
    if (shouldForceRefresh) {
      consumedContextRefreshKeyRef.current = refreshKey;
    }

    const loadContext = async () => {
      let requestError: Error | undefined;
      try {
        const legacyRefresh = shouldForceRefresh ? await synchronizeGalleryIndex("", controller.signal) : false;
        if (isCancelled) return;
        const contextResponse = await galleryApi.getContext(legacyRefresh, controller.signal);
        if (isCancelled) {
          return;
        }
        setContext(contextResponse);
        setColorIndexStatus(contextResponse.color_index_status ?? null);
        if (contextResponse.index_error || contextResponse.catalog_error) {
          const message = contextResponse.index_error || contextResponse.catalog_error || t("galleryLoading");
          setError(message);
          requestError = new Error(message);
        }
      } catch (fetchError) {
        if (!isCancelled) {
          requestError = fetchError instanceof Error ? fetchError : new Error(t("galleryLoading"));
          setError(requestError.message);
        }
      } finally {
        if (!isCancelled) completeRefreshPart(refreshKey, "context", requestError);
      }
    };

    void loadContext();

    return () => {
      isCancelled = true;
      controller.abort();
      if (shouldForceRefresh) completeRefreshPart(refreshKey, "context", new Error(t("galleryRefreshInterrupted")));
    };
  }, [completeRefreshPart, refreshKey, t]);

  useEffect(() => {
    let isCancelled = false;
    const controller = new AbortController();
    const shouldForceRefresh = refreshKey > 0 && consumedImagesRefreshKeyRef.current !== refreshKey;
    // Library/workbench entry only needs context for the sidebar. Do not load
    // the image page until Gallery is opened; Settings manual refresh still
    // deliberately loads it and can await both requests.
    if (!isActive && !shouldForceRefresh) return;
    if (shouldForceRefresh) {
      consumedImagesRefreshKeyRef.current = refreshKey;
    }

    const hasLoadedCurrentView = loadedViewKeyRef.current === liveRefreshViewKey;
    if (hasLoadedCurrentView) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
      setIsRefreshing(false);
    }
    setError(null);

    const loadImages = async () => {
      let requestError: Error | undefined;
      let loadedCurrentImages = false;
      try {
        if (isTrashView) {
          const items = await galleryApi.listTrash(controller.signal);
          if (isCancelled) {
            return;
          }
          setTrashItems(items);
          setTotal(items.length);
          return;
        }

        const legacyRefresh = shouldForceRefresh ? await synchronizeGalleryIndex(selectedSubfolder, controller.signal) : false;
        if (isCancelled) return;
        const imageResponse = await galleryApi.listImages(
          page,
          PAGE_SIZE,
          deferredSearchTerm,
          selectedCategory,
          selectedSubfolder,
          selectedBoardId,
          dateFrom,
          dateTo,
          favoritesOnly,
          selectedColorFamily,
          sortBy,
          sortOrder,
          legacyRefresh,
          controller.signal,
        );

        if (isCancelled) {
          return;
        }

        setImages(imageResponse.images ?? []);
        loadedCurrentImages = true;
        setTrashItems([]);
        setTotal(imageResponse.total ?? 0);
        setColorIndexStatus(imageResponse.color_index_status ?? null);
        if (imageResponse.index_error) {
          setError(imageResponse.index_error);
          requestError = new Error(imageResponse.index_error);
        }
        if (shouldForceRefresh) {
          const contextResponse = await galleryApi.getContext(false, controller.signal);
          if (!isCancelled) {
            setContext(contextResponse);
            setColorIndexStatus(contextResponse.color_index_status ?? imageResponse.color_index_status ?? null);
            if (contextResponse.index_error) {
              setError(contextResponse.index_error);
              requestError = new Error(contextResponse.index_error);
            }
          }
        }
        if (!isCancelled) scheduleThumbnailPrewarm(imageResponse.images ?? []);
      } catch (fetchError) {
        if (!isCancelled) {
          if (!hasLoadedCurrentView && !loadedCurrentImages) {
            setImages([]);
            setTrashItems([]);
            setTotal(0);
          }
          requestError = fetchError instanceof Error ? fetchError : new Error(t("galleryLoading"));
          setError(requestError.message);
        }
      } finally {
        if (!isCancelled) {
          completeRefreshPart(refreshKey, "images", requestError);
          loadedViewKeyRef.current = liveRefreshViewKey;
          setLoadedViewKey(liveRefreshViewKey);
          if (isTrashView) {
            hasLoadedTrashRef.current = true;
          } else {
            hasLoadedImagesRef.current = true;
          }
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    };

    void loadImages();

    return () => {
      isCancelled = true;
      controller.abort();
      if (shouldForceRefresh) completeRefreshPart(refreshKey, "images", new Error(t("galleryRefreshInterrupted")));
    };
  }, [page, deferredSearchTerm, selectedCategory, selectedSubfolder, selectedBoardId, dateFrom, dateTo, favoritesOnly, selectedColorFamily, sortBy, sortOrder, refreshKey, t, isTrashView, isActive, scheduleThumbnailPrewarm, liveRefreshViewKey, completeRefreshPart]);

  return { images, setImages, context, setContext, colorIndexStatus, setColorIndexStatus, total, setTotal, isLoading, isRefreshing, error, trashItems, setTrashItems, hasLoadedImagesRef, loadedViewKey };
};
