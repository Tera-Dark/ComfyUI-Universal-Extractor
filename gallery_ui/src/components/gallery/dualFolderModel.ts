import type { ImageRecord } from "../../types/universal-gallery";

export type PaneId = "left" | "right";

export const INTERNAL_IMAGE_MIME = "application/x-universal-gallery-image";

export interface PaneSelectionState {
  selectedPaths: string[];
  focusedPath: string;
  lastSelectedPath: string;
}

export interface DragState {
  from: PaneId;
  relativePaths: string[];
  image: ImageRecord;
  sourceFolder: string;
}

export type DualFolderShortcutAction =
  | "selectAll"
  | "moveToOtherPane"
  | "refresh"
  | "escape"
  | "delete"
  | "openDetail"
  | "togglePane"
  | null;

export const emptySelectionState = (): PaneSelectionState => ({
  selectedPaths: [],
  focusedPath: "",
  lastSelectedPath: "",
});

export const dragHasInternalImage = (types: Iterable<string>) =>
  Array.from(types).includes(INTERNAL_IMAGE_MIME);

const isPaneId = (value: unknown): value is PaneId => value === "left" || value === "right";

const isDragState = (value: unknown): value is DragState => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<DragState>;
  return (
    isPaneId(candidate.from) &&
    Array.isArray(candidate.relativePaths) &&
    candidate.relativePaths.every((item) => typeof item === "string" && item.trim().length > 0) &&
    Boolean(candidate.image && typeof candidate.image === "object" && typeof candidate.image.relative_path === "string") &&
    typeof candidate.sourceFolder === "string"
  );
};

export const readInternalDragPayload = (getData: (format: string) => string): DragState | null => {
  try {
    const raw = getData(INTERNAL_IMAGE_MIME);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    return isDragState(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

export const selectPaneImage = ({
  current,
  paths,
  path,
  shiftKey,
  toggleKey,
}: {
  current: PaneSelectionState;
  paths: string[];
  path: string;
  shiftKey: boolean;
  toggleKey: boolean;
}): PaneSelectionState => {
  if (shiftKey && current.lastSelectedPath) {
    const startIndex = paths.indexOf(current.lastSelectedPath);
    const endIndex = paths.indexOf(path);
    if (startIndex !== -1 && endIndex !== -1) {
      const [start, end] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
      return {
        selectedPaths: paths.slice(start, end + 1),
        focusedPath: path,
        lastSelectedPath: current.lastSelectedPath,
      };
    }
  }

  if (toggleKey) {
    const selectedPaths = current.selectedPaths.includes(path)
      ? current.selectedPaths.filter((item) => item !== path)
      : [...current.selectedPaths, path];
    return { selectedPaths, focusedPath: path, lastSelectedPath: path };
  }

  return { selectedPaths: [path], focusedPath: path, lastSelectedPath: path };
};

export const invertPaneSelection = (paths: string[], current: PaneSelectionState): PaneSelectionState => {
  const selectedSet = new Set(current.selectedPaths);
  const selectedPaths = paths.filter((path) => !selectedSet.has(path));
  return {
    selectedPaths,
    focusedPath: selectedPaths[0] || current.focusedPath,
    lastSelectedPath: selectedPaths[0] || current.lastSelectedPath,
  };
};

export const togglePaneBadgeSelection = (path: string, current: PaneSelectionState): PaneSelectionState => {
  const selected = current.selectedPaths.includes(path);
  const selectedPaths = selected
    ? current.selectedPaths.filter((item) => item !== path)
    : [...current.selectedPaths, path];
  return {
    selectedPaths,
    focusedPath: selected ? selectedPaths.at(-1) ?? "" : path,
    lastSelectedPath: selected ? current.lastSelectedPath : path,
  };
};

export const getDualFolderShortcutAction = (event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey">): DualFolderShortcutAction => {
  const normalizedKey = event.key.toLowerCase();
  if ((event.ctrlKey || event.metaKey) && normalizedKey === "a") {
    return "selectAll";
  }
  if ((event.ctrlKey || event.metaKey) && normalizedKey === "m") {
    return "moveToOtherPane";
  }
  if ((event.ctrlKey || event.metaKey) && normalizedKey === "r") {
    return "refresh";
  }
  if (event.key === "Escape") {
    return "escape";
  }
  if (event.key === "Delete") {
    return "delete";
  }
  if (event.key === "Enter") {
    return "openDetail";
  }
  if (event.key === "Tab") {
    return "togglePane";
  }
  return null;
};
