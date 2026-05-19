import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "../i18n/I18nProvider";
import { galleryApi } from "../services/galleryApi";
import type { BoardSummary, ColorIndexStatus, DetailNavigationState, GalleryContext, ImageRecord, MoveTargetOption, TrashItem } from "../types/universal-gallery";
import { PAGE_SIZE } from "../utils/formatters";

const TRASH_SUBFOLDER_KEY = "__trash__";
const DEFAULT_OUTPUT_SOURCE_ROOT = "default_output::";
const FOLDER_REF_SEPARATOR = "::";
const LIVE_GALLERY_REFRESH_INTERVAL_MS = 6_000;
const LIVE_GALLERY_REFRESH_FOCUS_DEBOUNCE_MS = 4_000;
const INITIAL_THUMBNAIL_PREWARM_LIMIT = 24;

interface UseGalleryDataOptions {
  isActive?: boolean;
  liveRefreshEnabled?: boolean;
}

const getSourceRootRef = (folderRef: string) => {
  if (folderRef.includes(FOLDER_REF_SEPARATOR)) {
    return `${folderRef.split(FOLDER_REF_SEPARATOR, 1)[0]}${FOLDER_REF_SEPARATOR}`;
  }
  return DEFAULT_OUTPUT_SOURCE_ROOT;
};

export const useGalleryData = (options: UseGalleryDataOptions = {}) => {
  const isActive = options.isActive ?? true;
  const liveRefreshEnabled = options.liveRefreshEnabled ?? true;
  const { t } = useI18n();
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [context, setContext] = useState<GalleryContext | null>(null);
  const [colorIndexStatus, setColorIndexStatus] = useState<ColorIndexStatus | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedSubfolder, setSelectedSubfolder] = useState(DEFAULT_OUTPUT_SOURCE_ROOT);
  const [selectedBoardId, setSelectedBoardId] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [selectedColorFamily, setSelectedColorFamily] = useState("");
  const [sortBy, setSortBy] = useState("created_at");
  const [sortOrder, setSortOrder] = useState("desc");
  const [gridColumns, setGridColumns] = useState(() => {
    const stored = window.localStorage.getItem("universal-extractor:grid-columns");
    const parsed = Number(stored);
    return Number.isFinite(parsed) && parsed >= 3 && parsed <= 8 ? parsed : 4;
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasPendingLiveRefresh, setHasPendingLiveRefresh] = useState(false);
  const [selectedImage, setSelectedImage] = useState<ImageRecord | null>(null);
  const [detailNavigation, setDetailNavigation] = useState<DetailNavigationState | null>(null);
  const [selectedImagePaths, setSelectedImagePaths] = useState<string[]>([]);
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [importMessage, setImportMessage] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const hasLoadedImagesRef = useRef(false);
  const hasLoadedTrashRef = useRef(false);
  const consumedContextRefreshKeyRef = useRef(0);
  const consumedImagesRefreshKeyRef = useRef(0);
  const liveRefreshRunningRef = useRef(false);
  const lastLiveRefreshAtRef = useRef(0);
  const liveRefreshFingerprintsRef = useRef<Map<string, string>>(new Map());
  const thumbnailPrewarmTimerRef = useRef<number | null>(null);
  const thumbnailPrewarmIdleRef = useRef<number | null>(null);
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const isTrashView = selectedSubfolder === TRASH_SUBFOLDER_KEY;
  const liveRefreshViewKey = useMemo(
    () =>
      JSON.stringify({
        subfolder: selectedSubfolder,
        search: deferredSearchTerm.trim(),
        category: selectedCategory,
        board: selectedBoardId,
        dateFrom,
        dateTo,
        favoritesOnly,
        color: selectedColorFamily,
        sortBy,
        sortOrder,
        page,
      }),
    [dateFrom, dateTo, deferredSearchTerm, favoritesOnly, page, selectedBoardId, selectedCategory, selectedColorFamily, selectedSubfolder, sortBy, sortOrder],
  );

  const clearScheduledThumbnailPrewarm = useCallback(() => {
    const idleWindow = window as Window & typeof globalThis & {
      cancelIdleCallback?: (handle: number) => void;
    };
    if (thumbnailPrewarmIdleRef.current !== null) {
      idleWindow.cancelIdleCallback?.(thumbnailPrewarmIdleRef.current);
      thumbnailPrewarmIdleRef.current = null;
    }
    if (thumbnailPrewarmTimerRef.current !== null) {
      window.clearTimeout(thumbnailPrewarmTimerRef.current);
      thumbnailPrewarmTimerRef.current = null;
    }
  }, []);

  const scheduleThumbnailPrewarm = useCallback((nextImages: ImageRecord[]) => {
    const relativePaths = nextImages.slice(0, INITIAL_THUMBNAIL_PREWARM_LIMIT).map((image) => image.relative_path);
    if (!relativePaths.length) {
      return;
    }

    clearScheduledThumbnailPrewarm();
    const task = () => {
      thumbnailPrewarmIdleRef.current = null;
      thumbnailPrewarmTimerRef.current = null;
      void galleryApi.prewarmThumbnails(relativePaths, INITIAL_THUMBNAIL_PREWARM_LIMIT).catch(() => undefined);
    };
    const idleWindow = window as Window & typeof globalThis & {
      requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number;
    };
    if (typeof idleWindow.requestIdleCallback === "function") {
      thumbnailPrewarmIdleRef.current = idleWindow.requestIdleCallback(task, { timeout: 1500 });
      return;
    }
    thumbnailPrewarmTimerRef.current = window.setTimeout(task, 250);
  }, [clearScheduledThumbnailPrewarm]);

  useEffect(() => () => clearScheduledThumbnailPrewarm(), [clearScheduledThumbnailPrewarm]);

  useEffect(() => {
    window.localStorage.setItem("universal-extractor:grid-columns", String(gridColumns));
  }, [gridColumns]);

  useEffect(() => {
    let isCancelled = false;
    const shouldForceRefresh = refreshKey > 0 && consumedContextRefreshKeyRef.current !== refreshKey;
    if (shouldForceRefresh) {
      consumedContextRefreshKeyRef.current = refreshKey;
    }

    const loadContext = async () => {
      try {
        const contextResponse = await galleryApi.getContext(shouldForceRefresh);
        if (isCancelled) {
          return;
        }
        setContext(contextResponse);
        setColorIndexStatus(contextResponse.color_index_status ?? null);
      } catch (fetchError) {
        if (!isCancelled) {
          setError(fetchError instanceof Error ? fetchError.message : t("galleryLoading"));
        }
      }
    };

    loadContext();

    return () => {
      isCancelled = true;
    };
  }, [refreshKey, t]);

  useEffect(() => {
    let isCancelled = false;
    const shouldForceRefresh = refreshKey > 0 && consumedImagesRefreshKeyRef.current !== refreshKey;
    if (shouldForceRefresh) {
      consumedImagesRefreshKeyRef.current = refreshKey;
    }

    const hasLoadedCurrentView = isTrashView ? hasLoadedTrashRef.current : hasLoadedImagesRef.current;

    if (hasLoadedCurrentView) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    const loadImages = async () => {
      try {
        if (isTrashView) {
          const items = await galleryApi.listTrash();
          if (isCancelled) {
            return;
          }
          setTrashItems(items);
          setTotal(items.length);
          return;
        }

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
          shouldForceRefresh,
        );

        if (isCancelled) {
          return;
        }

        setImages(imageResponse.images ?? []);
        setTrashItems([]);
        setTotal(imageResponse.total ?? 0);
        setColorIndexStatus(imageResponse.color_index_status ?? null);
        if (shouldForceRefresh) {
          const contextResponse = await galleryApi.getContext(false);
          if (!isCancelled) {
            setContext(contextResponse);
            setColorIndexStatus(contextResponse.color_index_status ?? imageResponse.color_index_status ?? null);
          }
        }
        scheduleThumbnailPrewarm(imageResponse.images ?? []);
      } catch (fetchError) {
        if (!isCancelled) {
          setError(fetchError instanceof Error ? fetchError.message : t("galleryLoading"));
        }
      } finally {
        if (!isCancelled) {
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

    loadImages();

    return () => {
      isCancelled = true;
    };
  }, [page, deferredSearchTerm, selectedCategory, selectedSubfolder, selectedBoardId, dateFrom, dateTo, favoritesOnly, selectedColorFamily, sortBy, sortOrder, refreshKey, t, isTrashView, scheduleThumbnailPrewarm]);

  useEffect(() => {
    if (!liveRefreshEnabled || !isActive || isTrashView) {
      return;
    }

    const refreshSilently = async (reason: "interval" | "focus") => {
      if (liveRefreshRunningRef.current || document.visibilityState === "hidden") {
        return;
      }

      const now = Date.now();
      if (reason === "focus" && now - lastLiveRefreshAtRef.current < LIVE_GALLERY_REFRESH_FOCUS_DEBOUNCE_MS) {
        return;
      }

      liveRefreshRunningRef.current = true;
      lastLiveRefreshAtRef.current = now;
      try {
        const knownFingerprint = liveRefreshFingerprintsRef.current.get(liveRefreshViewKey) ?? "";
        const freshness = await galleryApi.getImageFreshness(selectedSubfolder, knownFingerprint);
        liveRefreshFingerprintsRef.current.set(liveRefreshViewKey, freshness.fingerprint);
        if (!freshness.changed) {
          return;
        }

        const canReplaceCurrentPage = page === 1 && sortBy === "created_at" && sortOrder === "desc";
        if (!canReplaceCurrentPage) {
          setHasPendingLiveRefresh(true);
          return;
        }

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
          true,
        );
        const nextImages = imageResponse.images ?? [];

        setTotal(imageResponse.total ?? 0);
        setColorIndexStatus(imageResponse.color_index_status ?? null);
        setHasPendingLiveRefresh(false);
        setImages(nextImages);
        scheduleThumbnailPrewarm(nextImages);

        const contextResponse = await galleryApi.getContext(false);
        setContext(contextResponse);
        setColorIndexStatus(contextResponse.color_index_status ?? imageResponse.color_index_status ?? null);
      } catch {
        // Silent refresh should never interrupt browsing; manual refresh still reports errors.
      } finally {
        liveRefreshRunningRef.current = false;
      }
    };

    const interval = window.setInterval(() => {
      void refreshSilently("interval");
    }, LIVE_GALLERY_REFRESH_INTERVAL_MS);
    const handleVisibleRefresh = () => {
      if (document.visibilityState === "visible") {
        void refreshSilently("focus");
      }
    };

    window.addEventListener("focus", handleVisibleRefresh);
    document.addEventListener("visibilitychange", handleVisibleRefresh);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", handleVisibleRefresh);
      document.removeEventListener("visibilitychange", handleVisibleRefresh);
    };
  }, [
    liveRefreshEnabled,
    isActive,
    isTrashView,
    page,
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
    liveRefreshViewKey,
    scheduleThumbnailPrewarm,
  ]);

  useEffect(() => {
    setHasPendingLiveRefresh(false);
  }, [liveRefreshViewKey]);

  useEffect(() => {
    if (!colorIndexStatus || colorIndexStatus.complete || isTrashView) {
      return;
    }

    const interval = window.setInterval(() => {
      void galleryApi
        .getColorIndexStatus()
        .then(setColorIndexStatus)
        .catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(interval);
  }, [colorIndexStatus, isTrashView]);

  useEffect(() => {
    if (!liveRefreshEnabled || !isActive || isTrashView || !hasLoadedImagesRef.current) {
      return;
    }
    setRefreshKey((value) => value + 1);
  }, [liveRefreshEnabled, isActive, isTrashView]);

  const refresh = () => {
    setHasPendingLiveRefresh(false);
    setRefreshKey((value) => value + 1);
  };

  const applyContextPatch = (
    updater: (current: GalleryContext) => GalleryContext,
  ) => {
    setContext((current) => (current ? updater(current) : current));
  };

  const updateImageState = async (relativePath: string, updates: Record<string, unknown>) => {
    const shouldOptimisticallyPatchPin = "pinned" in updates || "favorite" in updates;
    let previousImage: ImageRecord | null = null;
    let previousSelectedImage: ImageRecord | null = null;
    if (shouldOptimisticallyPatchPin) {
      const nextPinned = Boolean(updates.pinned ?? updates.favorite);
      setImages((current) =>
        current.map((image) => {
          if (image.relative_path !== relativePath) {
            return image;
          }
          previousImage = image;
          return { ...image, favorite: nextPinned, pinned: nextPinned };
        }),
      );
      setSelectedImage((current) => {
        if (!current || current.relative_path !== relativePath) {
          return current;
        }
        previousSelectedImage = current;
        return { ...current, favorite: nextPinned, pinned: nextPinned };
      });
    }

    let response: Awaited<ReturnType<typeof galleryApi.updateImageState>>;
    try {
      response = await galleryApi.updateImageState(relativePath, updates);
    } catch (error) {
      if (previousImage) {
        const rollbackImage = previousImage;
        setImages((current) =>
          current.map((image) => (image.relative_path === relativePath ? rollbackImage : image)),
        );
      }
      if (previousSelectedImage) {
        const rollbackSelectedImage = previousSelectedImage;
        setSelectedImage((current) =>
          current && current.relative_path === relativePath ? rollbackSelectedImage : current,
        );
      }
      throw error;
    }

    applyContextPatch((current) => {
      const pinnedDelta = shouldOptimisticallyPatchPin && previousImage && typeof response.state.pinned === "boolean"
        ? (response.state.pinned ? 1 : 0) - (previousImage.pinned ? 1 : 0)
        : 0;
      return {
        ...current,
        categories: response.categories ?? current.categories,
        boards: response.boards ?? current.boards,
        pinned_count: Math.max(0, current.pinned_count + pinnedDelta),
      };
    });
    setImages((current) =>
      current.map((image) =>
        image.relative_path === relativePath ? { ...image, ...response.state } : image,
      ),
    );
    setSelectedImage((current) =>
      current && current.relative_path === relativePath ? { ...current, ...response.state } : current,
    );
    if (!shouldOptimisticallyPatchPin && (deferredSearchTerm.trim() || selectedCategory || selectedBoardId)) {
      refresh();
    }
  };

  const batchUpdateImages = async (relativePaths: string[], updates: Record<string, unknown>) => {
    const shouldOptimisticallyPatchPin = "pinned" in updates || "favorite" in updates;
    const relativePathSet = new Set(relativePaths);
    const previousImages = new Map<string, ImageRecord>();
    const previousSelectedImage = selectedImage;
    if (shouldOptimisticallyPatchPin) {
      const nextPinned = Boolean(updates.pinned ?? updates.favorite);
      setImages((current) =>
        current.map((image) => {
          if (!relativePathSet.has(image.relative_path)) {
            return image;
          }
          previousImages.set(image.relative_path, image);
          return { ...image, favorite: nextPinned, pinned: nextPinned };
        }),
      );
      setSelectedImage((current) =>
        current && relativePathSet.has(current.relative_path)
          ? { ...current, favorite: nextPinned, pinned: nextPinned }
          : current,
      );
    }

    let response: Awaited<ReturnType<typeof galleryApi.batchUpdateImages>>;
    try {
      response = await galleryApi.batchUpdateImages(relativePaths, updates);
    } catch (error) {
      if (previousImages.size > 0) {
        setImages((current) =>
          current.map((image) => previousImages.get(image.relative_path) ?? image),
        );
      }
      setSelectedImage(previousSelectedImage);
      throw error;
    }
    applyContextPatch((current) => ({
      ...current,
      categories: response.categories ?? current.categories,
      boards: response.boards ?? current.boards,
      pinned_count: shouldOptimisticallyPatchPin
        ? Math.max(
            0,
            current.pinned_count +
              (response.updated ?? relativePaths).reduce((delta, path) => {
                const previous = previousImages.get(path);
                if (!previous || !response.last_state || typeof response.last_state.pinned !== "boolean") {
                  return delta;
                }
                return delta + (response.last_state.pinned ? 1 : 0) - (previous.pinned ? 1 : 0);
              }, 0),
          )
        : current.pinned_count,
    }));
    const updatedPaths = new Set(response.updated ?? relativePaths);
    const imagePatch = response.last_state
      ? {
          favorite: response.last_state.favorite,
          pinned: response.last_state.pinned,
          boards: response.last_state.boards,
          category: response.last_state.category,
          title: response.last_state.title,
          notes: response.last_state.notes,
        }
      : updates;
    setImages((current) =>
      current.map((image) => (updatedPaths.has(image.relative_path) ? { ...image, ...imagePatch } : image)),
    );
    setSelectedImage((current) =>
      current && updatedPaths.has(current.relative_path) ? { ...current, ...imagePatch } : current,
    );
    if (deferredSearchTerm.trim() || selectedCategory || selectedBoardId || favoritesOnly) {
      refresh();
    }
    return response;
  };

  const moveImages = async (relativePaths: string[], targetSubfolder: string, targetSourceId = "") => {
    const response = await galleryApi.moveImages(relativePaths, targetSubfolder, targetSourceId);
    applyContextPatch((current) => ({
      ...current,
      categories: response.categories ?? current.categories,
      subfolders: response.subfolders ?? current.subfolders,
    }));
    setSelectedImagePaths([]);
    refresh();
    return response;
  };

  const batchRenameImages = async (
    relativePaths: string[],
    template: string,
    startNumber: number,
    padding: number,
    currentPage: number,
  ) => {
    const response = await galleryApi.batchRenameImages(relativePaths, template, startNumber, padding, currentPage);
    setSelectedImagePaths([]);
    refresh();
    return response;
  };

  const deleteImages = async (relativePaths: string[]) => {
    const response = await galleryApi.deleteImages(relativePaths);
    applyContextPatch((current) => ({
      ...current,
      categories: response.categories ?? current.categories,
    }));
    setSelectedImagePaths((current) => current.filter((path) => !relativePaths.includes(path)));
    refresh();
    return response;
  };

  const renameImage = async (relativePath: string, newFilename: string) => {
    const response = await galleryApi.renameImage(relativePath, newFilename);
    applyContextPatch((current) => ({
      ...current,
      categories: response.categories ?? current.categories,
    }));
    setSelectedImage((current) =>
      current && current.relative_path === relativePath ? response.image : current,
    );
    setSelectedImagePaths((current) =>
      current.map((path) => (path === relativePath ? response.image.relative_path : path)),
    );
    refresh();
    return response;
  };

  const createFolder = async (path: string) => {
    const response = await galleryApi.createFolder(path);
    applyContextPatch((current) => ({
      ...current,
      subfolders: response.subfolders ?? current.subfolders,
    }));
    if (response.path) {
      setSelectedSubfolder(response.path);
      setSelectedBoardId("");
      setFavoritesOnly(false);
      setPage(1);
    }
    return response;
  };

  const deleteFolder = async (path: string) => {
    const response = await galleryApi.deleteFolder(path);
    applyContextPatch((current) => ({
      ...current,
      subfolders: response.subfolders ?? current.subfolders,
      categories: response.categories ?? current.categories,
    }));
    if (selectedSubfolder === path || selectedSubfolder.startsWith(`${path}/`)) {
      setSelectedSubfolder(getSourceRootRef(path));
    }
    refresh();
    return response;
  };

  const mergeFolder = async (sourcePath: string, targetPath: string) => {
    const response = await galleryApi.mergeFolder(sourcePath, targetPath);
    applyContextPatch((current) => ({
      ...current,
      subfolders: response.subfolders ?? current.subfolders,
      categories: response.categories ?? current.categories,
    }));
    if (selectedSubfolder === sourcePath || selectedSubfolder.startsWith(`${sourcePath}/`)) {
      setSelectedSubfolder(response.target_path ?? targetPath);
    }
    refresh();
    return response;
  };

  const renameFolder = async (sourcePath: string, targetPath: string) => {
    const response = await galleryApi.renameFolder(sourcePath, targetPath);
    applyContextPatch((current) => ({
      ...current,
      subfolders: response.subfolders ?? current.subfolders,
      categories: response.categories ?? current.categories,
    }));
    if (selectedSubfolder === sourcePath || selectedSubfolder.startsWith(`${sourcePath}/`)) {
      const suffix = selectedSubfolder.slice(sourcePath.length);
      setSelectedSubfolder(`${response.target_path ?? targetPath}${suffix}`);
    }
    refresh();
    return response;
  };

  const importFiles = async (files: File[], targetSourceId = "") => {
    const response = await galleryApi.importFiles(files, targetSourceId);
    const importedCount = response.imported_images.length + response.imported_libraries.length;
    const skippedCount = response.skipped.length;

    const messages = [];
    if (importedCount > 0) {
      messages.push(t("galleryImportSuccess", { count: importedCount }));
    }
    if (skippedCount > 0) {
      messages.push(t("galleryImportSkipped", { count: skippedCount }));
    }

    setImportMessage(messages.join(" · "));
    startTransition(() => {
      refresh();
    });
    return response;
  };

  const targetFolderOptions = useMemo<MoveTargetOption[]>(() => context?.move_targets ?? [], [context?.move_targets]);
  const boards = useMemo<BoardSummary[]>(() => context?.boards ?? [], [context?.boards]);

  const patchBoards = (nextBoards: BoardSummary[]) => {
    applyContextPatch((current) => ({
      ...current,
      boards: nextBoards,
    }));
  };

  const createBoard = async (name: string, description = "") => {
    const response = await galleryApi.createBoard(name, description);
    patchBoards(response.boards ?? boards);
    return response;
  };

  const updateBoard = async (id: string, updates: Record<string, unknown>) => {
    const response = await galleryApi.updateBoard(id, updates);
    patchBoards(response.boards ?? boards);
    return response;
  };

  const deleteBoard = async (id: string) => {
    const response = await galleryApi.deleteBoard(id);
    applyContextPatch((current) => ({
      ...current,
      boards: response.boards ?? current.boards,
      categories: response.categories ?? current.categories,
    }));
    if (selectedBoardId === id) {
      setSelectedBoardId("");
    }
    refresh();
    return response;
  };

  const updateBoardPins = async (id: string, relativePaths: string[], pinned = true) => {
    const response = await galleryApi.updateBoardPins(id, relativePaths, pinned);
    applyContextPatch((current) => ({
      ...current,
      boards: response.boards ?? current.boards,
      categories: response.categories ?? current.categories,
    }));
    refresh();
    return response;
  };

  const restoreTrashItem = async (id: string) => {
    await galleryApi.restoreTrashItem(id);
    refresh();
  };

  const purgeTrashItem = async (id: string) => {
    await galleryApi.purgeTrashItem(id);
    refresh();
  };

  return {
    images,
    context,
    colorIndexStatus,
    total,
    page,
    setPage,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    searchTerm,
    setSearchTerm,
    selectedCategory,
    setSelectedCategory,
    selectedSubfolder,
    setSelectedSubfolder,
    selectedBoardId,
    setSelectedBoardId,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    favoritesOnly,
    selectedColorFamily,
    setFavoritesOnly,
    setSelectedColorFamily,
    sortBy,
    setSortBy,
    sortOrder,
    setSortOrder,
    gridColumns,
    setGridColumns,
    isLoading,
    isRefreshing,
    hasPendingLiveRefresh,
    error,
    selectedImage,
    setSelectedImage,
    detailNavigation,
    setDetailNavigation,
    selectedImagePaths,
    setSelectedImagePaths,
    trashItems,
    isTrashView,
    importMessage,
    setImportMessage,
    targetFolderOptions,
    boards,
    refresh,
    updateImageState,
    batchUpdateImages,
    moveImages,
    batchRenameImages,
    deleteImages,
    renameImage,
    createFolder,
    deleteFolder,
    mergeFolder,
    renameFolder,
    createBoard,
    updateBoard,
    deleteBoard,
    updateBoardPins,
    importFiles,
    restoreTrashItem,
    purgeTrashItem,
  };
};
