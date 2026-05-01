import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "../i18n/I18nProvider";
import { galleryApi } from "../services/galleryApi";
import type { BoardSummary, ColorIndexStatus, DetailNavigationState, GalleryContext, ImageRecord, MoveTargetOption, TrashItem } from "../types/universal-gallery";
import { PAGE_SIZE } from "../utils/formatters";

const TRASH_SUBFOLDER_KEY = "__trash__";

export const useGalleryData = () => {
  const { t } = useI18n();
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [context, setContext] = useState<GalleryContext | null>(null);
  const [colorIndexStatus, setColorIndexStatus] = useState<ColorIndexStatus | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedSubfolder, setSelectedSubfolder] = useState("");
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
  const [selectedImage, setSelectedImage] = useState<ImageRecord | null>(null);
  const [detailNavigation, setDetailNavigation] = useState<DetailNavigationState | null>(null);
  const [selectedImagePaths, setSelectedImagePaths] = useState<string[]>([]);
  const [trashItems, setTrashItems] = useState<TrashItem[]>([]);
  const [importMessage, setImportMessage] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const hasLoadedImagesRef = useRef(false);
  const consumedContextRefreshKeyRef = useRef(0);
  const consumedImagesRefreshKeyRef = useRef(0);
  const deferredSearchTerm = useDeferredValue(searchTerm);
  const isTrashView = selectedSubfolder === TRASH_SUBFOLDER_KEY;

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

    if (hasLoadedImagesRef.current) {
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
          setImages([]);
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
        void galleryApi
          .prewarmThumbnails((imageResponse.images ?? []).map((image) => image.relative_path), PAGE_SIZE)
          .catch(() => undefined);
      } catch (fetchError) {
        if (!isCancelled) {
          setError(fetchError instanceof Error ? fetchError.message : t("galleryLoading"));
        }
      } finally {
        if (!isCancelled) {
          hasLoadedImagesRef.current = true;
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    };

    loadImages();

    return () => {
      isCancelled = true;
    };
  }, [page, deferredSearchTerm, selectedCategory, selectedSubfolder, selectedBoardId, dateFrom, dateTo, favoritesOnly, selectedColorFamily, sortBy, sortOrder, refreshKey, t, isTrashView]);

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

  const refresh = () => setRefreshKey((value) => value + 1);

  const applyContextPatch = (
    updater: (current: GalleryContext) => GalleryContext,
  ) => {
    setContext((current) => (current ? updater(current) : current));
  };

  const updateImageState = async (relativePath: string, updates: Record<string, unknown>) => {
    const response = await galleryApi.updateImageState(relativePath, updates);
    applyContextPatch((current) => ({
      ...current,
      categories: response.categories ?? current.categories,
      boards: response.boards ?? current.boards,
    }));
    setImages((current) =>
      current.map((image) =>
        image.relative_path === relativePath ? { ...image, ...response.state } : image,
      ),
    );
    setSelectedImage((current) =>
      current && current.relative_path === relativePath ? { ...current, ...response.state } : current,
    );
    if ("pinned" in updates || "favorite" in updates) {
      refresh();
    }
  };

  const batchUpdateImages = async (relativePaths: string[], updates: Record<string, unknown>) => {
    const response = await galleryApi.batchUpdateImages(relativePaths, updates);
    applyContextPatch((current) => ({
      ...current,
      categories: response.categories ?? current.categories,
      boards: response.boards ?? current.boards,
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
    if (deferredSearchTerm.trim() || selectedCategory || selectedBoardId || favoritesOnly || "pinned" in updates || "favorite" in updates) {
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
      setSelectedSubfolder("");
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
      setSelectedSubfolder(targetPath);
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
      setSelectedSubfolder(`${targetPath}${suffix}`);
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
