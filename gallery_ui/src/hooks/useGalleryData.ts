import { startTransition, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { useI18n } from "../i18n/I18nProvider";
import { galleryApi } from "../services/galleryApi";
import type { DetailNavigationState, GalleryContext, ImageRecord, TrashItem } from "../types/universal-gallery";
import { PAGE_SIZE } from "../utils/formatters";

const TRASH_SUBFOLDER_KEY = "__trash__";

export const useGalleryData = () => {
  const { t } = useI18n();
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [context, setContext] = useState<GalleryContext | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [selectedSubfolder, setSelectedSubfolder] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
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

    const hasLoadedBefore = images.length > 0 || total > 0 || context !== null;
    if (hasLoadedBefore) {
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
          favoritesOnly,
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
      } catch (fetchError) {
        if (!isCancelled) {
          setError(fetchError instanceof Error ? fetchError.message : t("galleryLoading"));
        }
      } finally {
        if (!isCancelled) {
          setIsLoading(false);
          setIsRefreshing(false);
        }
      }
    };

    loadImages();

    return () => {
      isCancelled = true;
    };
  }, [page, deferredSearchTerm, selectedCategory, selectedSubfolder, favoritesOnly, sortBy, sortOrder, refreshKey, t, isTrashView]);

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
    }));
    setImages((current) =>
      current.map((image) =>
        image.relative_path === relativePath ? { ...image, ...response.state } : image,
      ),
    );
    setSelectedImage((current) =>
      current && current.relative_path === relativePath ? { ...current, ...response.state } : current,
    );
  };

  const batchUpdateImages = async (relativePaths: string[], updates: Record<string, unknown>) => {
    const response = await galleryApi.batchUpdateImages(relativePaths, updates);
    applyContextPatch((current) => ({
      ...current,
      categories: response.categories ?? current.categories,
    }));
    refresh();
    return response;
  };

  const moveImages = async (relativePaths: string[], targetSubfolder: string) => {
    const response = await galleryApi.moveImages(relativePaths, targetSubfolder);
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

  const importFiles = async (files: File[]) => {
    const response = await galleryApi.importFiles(files);
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

  const targetFolderOptions = useMemo(() => ["", ...(context?.subfolders ?? [])], [context?.subfolders]);

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
    favoritesOnly,
    setFavoritesOnly,
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
    importFiles,
    restoreTrashItem,
    purgeTrashItem,
  };
};
