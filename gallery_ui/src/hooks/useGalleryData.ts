import { useGalleryRefresh } from "./useGalleryRefresh";
import { useGalleryQueries } from "./useGalleryQueries";
import { useGalleryBatchOperations } from "./useGalleryBatchOperations";
import { startTransition, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "../i18n/I18nProvider";
import { galleryApi } from "../services/galleryApi";
import type { BoardSummary, DetailNavigationState, GalleryContext, ImageRecord, MoveTargetOption, TrashItem } from "../types/universal-gallery";
import { PAGE_SIZE } from "../utils/formatters";
import { readStorageItem, writeStorageItem } from "../utils/safeStorage";
import type { GalleryUrlScope } from "../utils/workspaceLocation";

const TRASH_SUBFOLDER_KEY = "__trash__";
const DEFAULT_OUTPUT_SOURCE_ROOT = "default_output::";
const FOLDER_REF_SEPARATOR = "::";
const LIVE_GALLERY_REFRESH_INTERVAL_MS = 6_000;
const LIVE_GALLERY_REFRESH_FOCUS_DEBOUNCE_MS = 4_000;
const INITIAL_THUMBNAIL_PREWARM_LIMIT = 24;
const EMPTY_IMAGES: ImageRecord[] = [];
const EMPTY_TRASH: TrashItem[] = [];

interface UseGalleryDataOptions {
  isActive?: boolean;
  liveRefreshEnabled?: boolean;
  thumbnailPrewarmEnabled?: boolean;
  initialScope?: GalleryUrlScope;
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
  const thumbnailPrewarmEnabled = options.thumbnailPrewarmEnabled ?? true;
  const { t } = useI18n();
  const [page, setPage] = useState(() => options.initialScope?.page ?? 1);
  const [searchTerm, setSearchTerm] = useState(() => options.initialScope?.query ?? "");
  const [selectedCategory, setSelectedCategory] = useState(() => options.initialScope?.category ?? "");
  const [selectedSubfolder, setSelectedSubfolder] = useState(() => options.initialScope?.folder ?? DEFAULT_OUTPUT_SOURCE_ROOT);
  const [selectedBoardId, setSelectedBoardId] = useState(() => options.initialScope?.board ?? "");
  const [dateFrom, setDateFrom] = useState(() => options.initialScope?.dateFrom ?? "");
  const [dateTo, setDateTo] = useState(() => options.initialScope?.dateTo ?? "");
  const [favoritesOnly, setFavoritesOnly] = useState(() => options.initialScope?.favorites ?? false);
  const [selectedColorFamily, setSelectedColorFamily] = useState(() => options.initialScope?.color ?? "");
  const [sortBy, setSortBy] = useState(() => options.initialScope?.sort ?? "created_at");
  const [sortOrder, setSortOrder] = useState(() => options.initialScope?.order ?? "desc");
  const [gridColumns, setGridColumns] = useState(() => {
    const stored = readStorageItem("universal-extractor:grid-columns");
    const parsed = Number(stored);
    // Only change the first-use desktop default. Respect a saved density;
    // the masonry hook and mobile preset still clamp columns to actual width.
    return Number.isFinite(parsed) && parsed >= 3 && parsed <= 8 ? parsed : 6;
  });
  const [hasPendingLiveRefresh, setHasPendingLiveRefresh] = useState(false);
  const [selectedImage, setSelectedImage] = useState<ImageRecord | null>(null);
  const [detailNavigation, setDetailNavigation] = useState<DetailNavigationState | null>(null);
  const [selectedImagePaths, setSelectedImagePaths] = useState<string[]>([]);
  const [importMessage, setImportMessage] = useState("");
  const [importFolderRef, setImportFolderRef] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const refreshSequenceRef = useRef(0);
  const { completeRefreshPart, waitForRefresh } = useGalleryRefresh(t("galleryRefreshInterrupted"));
  const liveRefreshRunningRef = useRef(false);
  const lastLiveRefreshAtRef = useRef(0);
  const liveRefreshFingerprintsRef = useRef<Map<string, string>>(new Map());
  const thumbnailPrewarmTimerRef = useRef<number | null>(null);
  const thumbnailPrewarmIdleRef = useRef<number | null>(null);
  const [debouncedSearchTerm, setDebouncedSearchTerm] = useState(searchTerm);
  useEffect(() => {
    if (searchTerm === debouncedSearchTerm) return;
    const timer = window.setTimeout(() => setDebouncedSearchTerm(searchTerm), searchTerm ? 280 : 0);
    return () => window.clearTimeout(timer);
  }, [debouncedSearchTerm, searchTerm]);
  const deferredSearchTerm = useDeferredValue(debouncedSearchTerm);
  const isTrashView = selectedSubfolder === TRASH_SUBFOLDER_KEY;
  // A response belongs to one exact browse scope. Never expose the previous
  // source/page's actionable cards under a newly selected scope.
  const liveRefreshViewKey = useMemo(
    () =>
      JSON.stringify({
        subfolder: selectedSubfolder,
        search: deferredSearchTerm,
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
    if (!thumbnailPrewarmEnabled) return;
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
  }, [clearScheduledThumbnailPrewarm, thumbnailPrewarmEnabled]);

  useEffect(() => {
    if (!thumbnailPrewarmEnabled) clearScheduledThumbnailPrewarm();
  }, [clearScheduledThumbnailPrewarm, thumbnailPrewarmEnabled]);
  useEffect(() => () => clearScheduledThumbnailPrewarm(), [clearScheduledThumbnailPrewarm]);

  useEffect(() => {
    writeStorageItem("universal-extractor:grid-columns", String(gridColumns));
  }, [gridColumns]);

  const { images, setImages, context, setContext, colorIndexStatus, setColorIndexStatus, total, setTotal, isLoading, isRefreshing, error, trashItems, hasLoadedImagesRef, loadedViewKey } = useGalleryQueries({
    page, deferredSearchTerm, selectedCategory, selectedSubfolder, selectedBoardId, dateFrom, dateTo, favoritesOnly, selectedColorFamily, sortBy, sortOrder, refreshKey, isTrashView, isActive, scheduleThumbnailPrewarm, liveRefreshViewKey, completeRefreshPart
  });

  useEffect(() => {
    if (!liveRefreshEnabled || !isActive || isTrashView) {
      return;
    }

    let cancelled = false;
    const controller = new AbortController();
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
        const freshness = await galleryApi.getImageFreshness(selectedSubfolder, knownFingerprint, controller.signal);
        if (cancelled) return;
        liveRefreshFingerprintsRef.current.set(liveRefreshViewKey, freshness.fingerprint);
        if (!freshness.changed) {
          return;
        }

        const canReplaceCurrentPage = page === 1 && sortBy === "created_at" && sortOrder === "desc" &&
          (document.querySelector<HTMLElement>(".ue-main-shell")?.scrollTop ?? 0) <= 80;
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
          controller.signal,
        );
        if (cancelled) return;
        if ((document.querySelector<HTMLElement>(".ue-main-shell")?.scrollTop ?? 0) > 80) {
          setHasPendingLiveRefresh(true);
          return;
        }
        const nextImages = imageResponse.images ?? [];

        setTotal(imageResponse.total ?? 0);
        setColorIndexStatus(imageResponse.color_index_status ?? null);
        setHasPendingLiveRefresh(false);
        setImages(nextImages);
        scheduleThumbnailPrewarm(nextImages);

        const contextResponse = await galleryApi.getContext(false, controller.signal);
        if (cancelled) return;
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
      cancelled = true;
      controller.abort();
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
    setColorIndexStatus,
    setContext,
    setImages,
    setTotal,
  ]);

  useEffect(() => {
    setHasPendingLiveRefresh(false);
  }, [liveRefreshViewKey]);

  useEffect(() => {
    if (!isActive || !colorIndexStatus || colorIndexStatus.complete || isTrashView) {
      return;
    }

    const interval = window.setInterval(() => {
      void galleryApi
        .getColorIndexStatus()
        .then(setColorIndexStatus)
        .catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(interval);
  }, [colorIndexStatus, isTrashView, isActive, setColorIndexStatus]);

  const triggerRefresh = useCallback(() => {
    const key = ++refreshSequenceRef.current;
    setHasPendingLiveRefresh(false);
    setRefreshKey(key);
    return key;
  }, []);

  useEffect(() => {
    if (!liveRefreshEnabled || !isActive || isTrashView || !hasLoadedImagesRef.current) return;
    triggerRefresh();
  }, [liveRefreshEnabled, isActive, isTrashView, triggerRefresh, hasLoadedImagesRef]);

  const applyUrlScope = (next: GalleryUrlScope) => {
    setPage(next.page);
    setSearchTerm(next.query);
    setDebouncedSearchTerm(next.query);
    setSelectedSubfolder(next.folder);
    setSelectedBoardId(next.board);
    setSelectedCategory(next.category);
    setDateFrom(next.dateFrom);
    setDateTo(next.dateTo);
    setFavoritesOnly(next.favorites);
    setSelectedColorFamily(next.color);
    setSortBy(next.sort);
    setSortOrder(next.order);
    setSelectedImagePaths([]);
    setSelectedImage(null);
    setDetailNavigation(null);
  };

  const refresh = () => { triggerRefresh(); };
  const refreshAndWait = () => waitForRefresh(triggerRefresh);

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

  const { batchUpdateImages, moveImages, batchRenameImages, deleteImages } = useGalleryBatchOperations({
    selectedImage, setImages, setSelectedImage, setSelectedImagePaths, applyContextPatch, refresh,
    stateFiltersActive: Boolean(deferredSearchTerm.trim() || selectedCategory || selectedBoardId || favoritesOnly),
  });

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
    setImportMessage("");
    setImportFolderRef("");
    const response = await galleryApi.importFiles(files, targetSourceId);
    const importedCount = response.imported_images.length + response.imported_libraries.length;
    const skippedCount = response.skipped.length;
    // Use the path returned by the server rather than assuming the requested
    // source won the import-target fallback or that filenames were unchanged.
    const firstPath = response.imported_images[0]?.relative_path ?? "";
    const serverFolder = firstPath.includes("/") ? firstPath.slice(0, firstPath.lastIndexOf("/")) : "";
    // The API returns legacy unprefixed refs for default_output, but includes
    // `source::` for other sources. Normalize the server result for sidebar/URL.
    const folderRef = serverFolder && !serverFolder.includes(FOLDER_REF_SEPARATOR)
      ? `${DEFAULT_OUTPUT_SOURCE_ROOT}${serverFolder}` : serverFolder;
    setImportFolderRef(folderRef);
    const sourceId = getSourceRootRef(folderRef).replace(FOLDER_REF_SEPARATOR, "");
    const sourceName = context?.sources.find((source) => source.id === sourceId)?.name || sourceId;
    const folderName = folderRef.split(FOLDER_REF_SEPARATOR).pop() || context?.import_image_subfolder || "universal_gallery_imports";

    const messages = [];
    if (importedCount > 0) messages.push(t("galleryImportSuccess", { count: importedCount }));
    if (response.imported_images.length) messages.push(t("galleryImportSavedTo", { target: `${sourceName} / ${folderName}/` }));
    if (response.imported_libraries.length) messages.push(t("galleryImportLibrariesSavedTo", { count: response.imported_libraries.length }));
    if (skippedCount > 0) messages.push(t("galleryImportSkipped", { count: skippedCount }));

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

  const viewReady = loadedViewKey === liveRefreshViewKey && (isTrashView || searchTerm === deferredSearchTerm);
  const scopedTotal = viewReady ? total : 0;

  return {
    images: viewReady ? images : EMPTY_IMAGES,
    context,
    colorIndexStatus,
    total: scopedTotal,
    page,
    setPage,
    totalPages: Math.max(1, Math.ceil(scopedTotal / PAGE_SIZE)),
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
    isLoading: isLoading || !viewReady,
    isRefreshing: isRefreshing && viewReady,
    hasPendingLiveRefresh,
    error: viewReady ? error : null,
    selectedImage,
    setSelectedImage,
    detailNavigation,
    setDetailNavigation,
    selectedImagePaths: viewReady ? selectedImagePaths : [],
    setSelectedImagePaths,
    trashItems: viewReady ? trashItems : EMPTY_TRASH,
    isTrashView,
    importMessage,
    importFolderRef,
    setImportMessage,
    targetFolderOptions,
    boards,
    refresh,
    refreshAndWait,
    applyUrlScope,
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
