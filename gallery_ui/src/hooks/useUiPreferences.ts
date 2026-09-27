import { useCallback, useEffect, useState } from "react";

import type { UiPreferences } from "../types/universal-gallery";
import { readStorageItem, writeStorageItem } from "../utils/safeStorage";

const STORAGE_KEY = "universal-extractor:ui-preferences";

export const DEFAULT_UI_PREFERENCES: UiPreferences = {
  defaultSelectionMode: false,
  collapseSidebarOnLaunch: false,
  enableImagePrefetch: true,
  enableLiveGalleryRefresh: true,
  defaultFolderTreeView: true,
};

export const readStoredUiPreferences = (): UiPreferences => {
  try {
    const parsed = JSON.parse(readStorageItem(STORAGE_KEY) || "{}") as Partial<UiPreferences>;
    return {
      defaultSelectionMode: typeof parsed.defaultSelectionMode === "boolean" ? parsed.defaultSelectionMode : DEFAULT_UI_PREFERENCES.defaultSelectionMode,
      collapseSidebarOnLaunch: typeof parsed.collapseSidebarOnLaunch === "boolean" ? parsed.collapseSidebarOnLaunch : DEFAULT_UI_PREFERENCES.collapseSidebarOnLaunch,
      enableImagePrefetch: typeof parsed.enableImagePrefetch === "boolean" ? parsed.enableImagePrefetch : DEFAULT_UI_PREFERENCES.enableImagePrefetch,
      enableLiveGalleryRefresh: typeof parsed.enableLiveGalleryRefresh === "boolean" ? parsed.enableLiveGalleryRefresh : DEFAULT_UI_PREFERENCES.enableLiveGalleryRefresh,
      defaultFolderTreeView: typeof parsed.defaultFolderTreeView === "boolean" ? parsed.defaultFolderTreeView : DEFAULT_UI_PREFERENCES.defaultFolderTreeView,
    };
  } catch {
    return DEFAULT_UI_PREFERENCES;
  }
};

export const useUiPreferences = () => {
  // Read once: sidebar, folder layout and Gallery all need the same snapshot.
  const [preferences, setPreferences] = useState(readStoredUiPreferences);
  const update = useCallback((updates: Partial<UiPreferences>) => {
    setPreferences((current) => ({ ...current, ...updates }));
  }, []);

  // Keep storage I/O out of React's state updater. Some browsers disable local
  // storage entirely; browsing and in-memory preferences must still work.
  useEffect(() => {
    writeStorageItem(STORAGE_KEY, JSON.stringify(preferences));
  }, [preferences]);

  return { preferences, update };
};
