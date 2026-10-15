import { useCallback, useRef } from "react";
import type { MouseEvent } from "react";
import { dedupeVisibleSelection, selectPathRange, togglePathSelection } from "./gallerySelectionModel";

interface GallerySelectionOptions {
  visibleSelectionPaths: string[];
  pageSelectedPaths: string[];
  onSelectionChange: (paths: string[]) => void;
}

/** Selection commands share one anchor across clicks, keyboard and box selection. */
export const useGallerySelection = ({ visibleSelectionPaths, pageSelectedPaths, onSelectionChange }: GallerySelectionOptions) => {
  const lastSelectedPathRef = useRef("");
  const setSelection = useCallback((relativePaths: string[]) => {
    onSelectionChange(dedupeVisibleSelection(relativePaths, visibleSelectionPaths));
  }, [onSelectionChange, visibleSelectionPaths]);

  const handleImageSelectionClick = (relativePath: string, event?: Pick<MouseEvent, "shiftKey" | "ctrlKey" | "metaKey">) => {
    if (event?.shiftKey) {
      const anchorPath = lastSelectedPathRef.current || pageSelectedPaths[pageSelectedPaths.length - 1] || relativePath;
      setSelection(selectPathRange({ anchorPath, targetPath: relativePath, selectedPaths: pageSelectedPaths, visibleSelectionPaths }));
      lastSelectedPathRef.current = anchorPath;
      return;
    }
    setSelection(togglePathSelection(pageSelectedPaths, relativePath));
    lastSelectedPathRef.current = relativePath;
  };

  const selectAllVisible = useCallback(() => {
    setSelection(visibleSelectionPaths);
    lastSelectedPathRef.current = visibleSelectionPaths[0] || "";
  }, [setSelection, visibleSelectionPaths]);

  const clearSelection = useCallback(() => {
    onSelectionChange([]);
    lastSelectedPathRef.current = "";
  }, [onSelectionChange]);

  return { setSelection, handleImageSelectionClick, selectAllVisible, clearSelection, lastSelectedPathRef };
};
