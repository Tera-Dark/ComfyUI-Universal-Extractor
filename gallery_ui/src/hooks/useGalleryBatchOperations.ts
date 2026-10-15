import type { Dispatch, SetStateAction } from "react";
import { useI18n } from "../i18n/I18nProvider";
import { galleryApi } from "../services/galleryApi";
import type { GalleryContext, ImageRecord } from "../types/universal-gallery";
import { getDeleteOutcome, getMoveOutcome } from "../utils/galleryOperationResults";
import { applyBatchImageState } from "./galleryBatchState";

interface GalleryBatchOptions {
  selectedImage: ImageRecord | null;
  setImages: Dispatch<SetStateAction<ImageRecord[]>>;
  setSelectedImage: Dispatch<SetStateAction<ImageRecord | null>>;
  setSelectedImagePaths: Dispatch<SetStateAction<string[]>>;
  applyContextPatch: (updater: (context: GalleryContext) => GalleryContext) => void;
  refresh: () => void;
  stateFiltersActive: boolean;
}

const normalizeUpdatedPaths = (value: unknown, fallback: string[]) => {
  if (Array.isArray(value)) {
    return value.filter((path): path is string => typeof path === "string");
  }
  if (typeof value === "string") {
    return [value];
  }
  return fallback;
};

/** Applies actual per-item outcomes and keeps unfinished selections. */
export const useGalleryBatchOperations = ({ selectedImage, setImages, setSelectedImage, setSelectedImagePaths, applyContextPatch, refresh, stateFiltersActive }: GalleryBatchOptions) => {
  const { t } = useI18n();
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
    const normalizedUpdatedPaths = normalizeUpdatedPaths(response.updated, relativePaths);
    applyContextPatch((current) => ({
      ...current,
      categories: response.categories ?? current.categories,
      boards: response.boards ?? current.boards,
      pinned_count: shouldOptimisticallyPatchPin
        ? Math.max(
            0,
            current.pinned_count +
              normalizedUpdatedPaths.reduce((delta, path) => {
                const previous = previousImages.get(path);
                if (!previous || !response.last_state || typeof response.last_state.pinned !== "boolean") {
                  return delta;
                }
                return delta + (response.last_state.pinned ? 1 : 0) - (previous.pinned ? 1 : 0);
              }, 0),
          )
        : current.pinned_count,
    }));
    const updatedPaths = new Set(normalizedUpdatedPaths);
    setImages((current) => current.map((image) => updatedPaths.has(image.relative_path)
      ? applyBatchImageState(image, response, updates) : previousImages.get(image.relative_path) ?? image));
    setSelectedImage((current) => current && updatedPaths.has(current.relative_path)
        ? applyBatchImageState(current, response, updates)
        : current && previousSelectedImage?.relative_path === current.relative_path && relativePathSet.has(current.relative_path)
          ? previousSelectedImage : current);
    setSelectedImagePaths((current) => current.filter((path) => !updatedPaths.has(path)));
    if (stateFiltersActive) {
      refresh();
    }
    return response;
  };

  const moveImages = async (relativePaths: string[], targetSubfolder: string, targetSourceId = "") => {
    const response = await galleryApi.moveImages(relativePaths, targetSubfolder, targetSourceId);
    if (!response.ok) throw new Error(t("dual_moveError"));
    applyContextPatch((current) => ({
      ...current,
      categories: response.categories ?? current.categories,
      subfolders: response.subfolders ?? current.subfolders,
    }));
    const { movedSources } = getMoveOutcome(relativePaths, response);
    setSelectedImagePaths((current) => current.filter((path) => !movedSources.has(path)));
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
    if (!response.ok) throw new Error(t("dual_deleteError"));
    applyContextPatch((current) => ({
      ...current,
      categories: response.categories ?? current.categories,
    }));
    const { deletedPaths } = getDeleteOutcome(relativePaths, response);
    setSelectedImagePaths((current) => current.filter((path) => !deletedPaths.has(path)));
    refresh();
    return response;
  };

  return { batchUpdateImages, moveImages, batchRenameImages, deleteImages };
};
