export interface SelectionBoxState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

export interface RectLike {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export const dedupeVisibleSelection = (relativePaths: string[], visibleSelectionPaths: string[]) => {
  const visiblePathSet = new Set(visibleSelectionPaths);
  return relativePaths.filter((path, index, paths) => visiblePathSet.has(path) && paths.indexOf(path) === index);
};

export const togglePathSelection = (selectedPaths: string[], relativePath: string) =>
  selectedPaths.includes(relativePath)
    ? selectedPaths.filter((path) => path !== relativePath)
    : [...selectedPaths, relativePath];

export const selectPathRange = ({
  anchorPath,
  targetPath,
  selectedPaths,
  visibleSelectionPaths,
}: {
  anchorPath: string;
  targetPath: string;
  selectedPaths: string[];
  visibleSelectionPaths: string[];
}) => {
  const anchorIndex = visibleSelectionPaths.indexOf(anchorPath);
  const targetIndex = visibleSelectionPaths.indexOf(targetPath);
  if (anchorIndex < 0 || targetIndex < 0) {
    return togglePathSelection(selectedPaths, targetPath);
  }

  const startIndex = Math.min(anchorIndex, targetIndex);
  const endIndex = Math.max(anchorIndex, targetIndex);
  return dedupeVisibleSelection([...selectedPaths, ...visibleSelectionPaths.slice(startIndex, endIndex + 1)], visibleSelectionPaths);
};

export const getSelectionBoxRect = (box: SelectionBoxState): RectLike => ({
  left: Math.min(box.startX, box.currentX),
  right: Math.max(box.startX, box.currentX),
  top: Math.min(box.startY, box.currentY),
  bottom: Math.max(box.startY, box.currentY),
});

export const rectsIntersect = (a: RectLike, b: RectLike) =>
  !(b.right < a.left || b.left > a.right || b.bottom < a.top || b.top > a.bottom);
