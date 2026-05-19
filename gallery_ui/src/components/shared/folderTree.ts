import type { GallerySource } from "../../types/universal-gallery";

export interface TreeNode {
  path: string;
  name: string;
  children: TreeNode[];
}

export const DEFAULT_OUTPUT_SOURCE_ID = "default_output";
export const FOLDER_REF_SEPARATOR = "::";
export const TRASH_SUBFOLDER_KEY = "__trash__";

const splitFolderPath = (subfolder: string) => subfolder.split(/[\\/]+/).filter(Boolean);

export type FolderSortMode = "modified" | "name";

export const PINNED_FOLDERS_STORAGE_KEY = "universal-extractor:pinned-folders";
export const FOLDER_SORT_STORAGE_KEY = "universal-extractor:folder-sort";

export const getStoredPinnedFolders = () => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PINNED_FOLDERS_STORAGE_KEY) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set<string>();
  }
};

export const getStoredFolderSort = (): FolderSortMode =>
  window.localStorage.getItem(FOLDER_SORT_STORAGE_KEY) === "name" ? "name" : "modified";

export const parseFolderRef = (folderRef: string) => {
  const value = folderRef.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (value.includes(FOLDER_REF_SEPARATOR)) {
    const [sourceId, ...rest] = value.split(FOLDER_REF_SEPARATOR);
    return {
      sourceId: sourceId || DEFAULT_OUTPUT_SOURCE_ID,
      relativePath: rest.join(FOLDER_REF_SEPARATOR).replace(/^\/+|\/+$/g, ""),
    };
  }
  return { sourceId: DEFAULT_OUTPUT_SOURCE_ID, relativePath: value };
};

export const makeSourceRootRef = (sourceId: string) => `${sourceId || DEFAULT_OUTPUT_SOURCE_ID}${FOLDER_REF_SEPARATOR}`;

export const makeFolderRef = (sourceId: string, relativePath: string) => {
  const normalizedPath = relativePath.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalizedPath) {
    return makeSourceRootRef(sourceId);
  }
  return `${sourceId || DEFAULT_OUTPUT_SOURCE_ID}${FOLDER_REF_SEPARATOR}${normalizedPath}`;
};

export const getFolderBaseName = (folderRef: string) => {
  const { relativePath } = parseFolderRef(folderRef);
  const segments = splitFolderPath(relativePath);
  return segments.at(-1) ?? "";
};

export const makeChildFolderRef = (parentFolderRef: string, childName: string) => {
  const { sourceId, relativePath } = parseFolderRef(parentFolderRef);
  const normalizedChild = childName.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return makeFolderRef(sourceId, relativePath ? `${relativePath}/${normalizedChild}` : normalizedChild);
};

export const getFolderSourceId = (folderRef: string) => parseFolderRef(folderRef).sourceId;

export const isSourceRootRef = (folderRef: string) => {
  const { relativePath } = parseFolderRef(folderRef);
  return !relativePath;
};

export const isSameFolderSource = (left: string, right: string) =>
  parseFolderRef(left).sourceId === parseFolderRef(right).sourceId;

export const isFolderDescendant = (folderRef: string, possibleAncestorRef: string) => {
  const folder = parseFolderRef(folderRef);
  const ancestor = parseFolderRef(possibleAncestorRef);
  if (folder.sourceId !== ancestor.sourceId || !ancestor.relativePath) {
    return false;
  }
  return folder.relativePath.startsWith(`${ancestor.relativePath}/`);
};

export const getFolderPinAliases = (folderRef: string) => {
  const { sourceId, relativePath } = parseFolderRef(folderRef);
  return sourceId === DEFAULT_OUTPUT_SOURCE_ID && relativePath ? [folderRef, relativePath] : [folderRef];
};

export const isFolderPinned = (folderRef: string, pinnedFolders: Set<string>) =>
  getFolderPinAliases(folderRef).some((alias) => pinnedFolders.has(alias));

export const compareFolderKey = (
  left: string,
  right: string,
  pinnedFolders: Set<string>,
  sortMode: FolderSortMode,
  folderModifiedAt: Map<string, number> = new Map(),
) => {
  const leftPinned = isFolderPinned(left, pinnedFolders);
  const rightPinned = isFolderPinned(right, pinnedFolders);
  if (leftPinned !== rightPinned) {
    return leftPinned ? -1 : 1;
  }
  if (sortMode === "modified") {
    const modifiedResult = (folderModifiedAt.get(right) ?? 0) - (folderModifiedAt.get(left) ?? 0);
    if (modifiedResult !== 0) {
      return modifiedResult;
    }
  }
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
};

export const defaultSourceLabel = (source: GallerySource | undefined, fallbackId: string) => source?.name || fallbackId;

export const formatFolderLabel = (
  folderRef: string,
  sources: GallerySource[],
  getSourceLabel: (source: GallerySource | undefined, fallbackId: string) => string,
  currentSourceId = "",
) => {
  const { sourceId, relativePath } = parseFolderRef(folderRef);
  if (currentSourceId && sourceId === currentSourceId) {
    return relativePath || "./";
  }
  if (sourceId === DEFAULT_OUTPUT_SOURCE_ID) {
    return relativePath || "./";
  }
  const source = sources.find((item) => item.id === sourceId);
  const sourceLabel = getSourceLabel(source, sourceId);
  return relativePath ? `${sourceLabel} / ${relativePath}` : sourceLabel;
};

const sortTreeNodes = (
  nodes: TreeNode[],
  pinnedFolders: Set<string>,
  sortMode: FolderSortMode,
  folderModifiedAt: Map<string, number> = new Map(),
): TreeNode[] =>
  [...nodes]
    .sort((left, right) => compareFolderKey(left.path, right.path, pinnedFolders, sortMode, folderModifiedAt))
    .map((node) => ({ ...node, children: sortTreeNodes(node.children, pinnedFolders, sortMode, folderModifiedAt) }));

export const buildFolderTree = (
  subfolders: string[],
  pinnedFolders: Set<string>,
  sortMode: FolderSortMode,
  sources: GallerySource[] = [],
  getSourceLabel: (source: GallerySource | undefined, fallbackId: string) => string = defaultSourceLabel,
  rootSourceId = "",
  folderModifiedAt: Map<string, number> = new Map(),
) => {
  const root: TreeNode[] = [];
  const nodeMap = new Map<string, TreeNode>();
  const sourceMap = new Map(sources.map((source) => [source.id, source]));

  subfolders.forEach((subfolder) => {
    const { sourceId, relativePath } = parseFolderRef(subfolder);
    if (rootSourceId && sourceId !== rootSourceId) {
      return;
    }
    const segments = splitFolderPath(relativePath);
    let currentPath = "";
    let currentLevel = root;

    if (!rootSourceId && sourceId !== DEFAULT_OUTPUT_SOURCE_ID) {
      currentPath = makeSourceRootRef(sourceId);
      let sourceNode = nodeMap.get(currentPath);
      if (!sourceNode) {
        sourceNode = { path: currentPath, name: getSourceLabel(sourceMap.get(sourceId), sourceId), children: [] };
        nodeMap.set(currentPath, sourceNode);
        root.push(sourceNode);
      }
      currentLevel = sourceNode.children;
    }

    segments.forEach((segment) => {
      const currentRelativePath = currentPath ? parseFolderRef(currentPath).relativePath : "";
      const nextRelativePath = currentRelativePath ? `${currentRelativePath}/${segment}` : segment;
      currentPath = makeFolderRef(sourceId, nextRelativePath);
      let node = nodeMap.get(currentPath);

      if (!node) {
        node = { path: currentPath, name: segment, children: [] };
        nodeMap.set(currentPath, node);
        currentLevel.push(node);
      }

      currentLevel = node.children;
    });
  });

  return sortTreeNodes(root, pinnedFolders, sortMode, folderModifiedAt);
};

export const getAncestorPaths = (path: string) => {
  const { sourceId, relativePath } = parseFolderRef(path);
  const segments = splitFolderPath(relativePath);
  const ancestors = sourceId === DEFAULT_OUTPUT_SOURCE_ID ? [] : [makeSourceRootRef(sourceId)];
  return segments
    .slice(0, -1)
    .map((_, index) => makeFolderRef(sourceId, segments.slice(0, index + 1).join("/")))
    .reduce((paths, ancestor) => [...paths, ancestor], ancestors);
};

export const collectFolderSearchPaths = (subfolders: string[], query: string) => {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return subfolders;
  }

  const paths = new Set<string>();
  subfolders.forEach((subfolder) => {
    if (!subfolder.toLowerCase().includes(normalizedQuery)) {
      return;
    }
    getAncestorPaths(subfolder).forEach((ancestor) => paths.add(ancestor));
    paths.add(subfolder);
  });
  return subfolders.filter((subfolder) => paths.has(subfolder));
};

export const filterSubfoldersBySource = (subfolders: string[], sourceId: string) =>
  subfolders.filter((subfolder) => getFolderSourceId(subfolder) === sourceId);
