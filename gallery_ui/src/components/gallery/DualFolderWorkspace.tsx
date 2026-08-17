import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRightLeft,
  CheckSquare,
  ChevronDown,
  ClipboardCopy,
  ExternalLink,
  FileJson,
  Folder,
  FolderPlus,
  Image as ImageIcon,
  Loader2,
  MoveRight,
  Pin,
  RefreshCcw,
  Search,
  Send,
  Square,
  Trash2,
} from "lucide-react";

import { useI18n } from "../../i18n/I18nProvider";
import { galleryApi } from "../../services/galleryApi";
import type { BoardMutationResult, BoardSummary, GalleryContext, ImageRecord, MoveImagesResult } from "../../types/universal-gallery";
import { formatFileSize } from "../../utils/formatters";
import { getPositivePromptText } from "../../utils/metadata";
import { useConfirm } from "../shared/ConfirmDialog";
import { useToast } from "../shared/ToastViewport";
import { useOperationStatus } from "../shared/OperationStatusCenter";
import { DEFAULT_OUTPUT_SOURCE_ID, formatFolderLabel, makeSourceRootRef, parseFolderRef } from "../shared/folderTree";
import { FloatingLayerPortal, isEditableTarget, placeMenuForEvent, useDismissableLayer } from "../../utils/interaction";
import { BoardPickerModal } from "./BoardPickerModal";
import { DualFolderCard } from "./DualFolderCard";
import { MetadataViewerModal } from "./MetadataViewerModal";
import {
  INTERNAL_IMAGE_MIME,
  dragHasInternalImage,
  emptySelectionState,
  getDualFolderShortcutAction,
  invertPaneSelection,
  readInternalDragPayload,
  selectPaneImage,
  togglePaneBadgeSelection,
  type DragState,
  type PaneId,
  type PaneSelectionState,
} from "./dualFolderModel";
const pageSize = 80;

interface FolderPaneState {
  images: ImageRecord[];
  total: number;
  loading: boolean;
  error: string;
}

interface FolderOption {
  value: string;
  label: string;
  parent: string;
  sourceName: string;
  searchText: string;
}

interface ImageContextMenuState {
  pane: PaneId;
  image: ImageRecord;
  x: number;
  y: number;
}

interface DualFolderWorkspaceProps {
  context: GalleryContext | null;
  initialFolder: string;
  sortBy: string;
  sortOrder: string;
  boards: BoardSummary[];
  onOpenDetail: (image: ImageRecord) => void;
  onOpenWorkflow: (image: ImageRecord) => Promise<void>;
  onMoveImages: (relativePaths: string[], targetSubfolder: string, targetSourceId?: string) => Promise<MoveImagesResult>;
  onDeleteImages: (relativePaths: string[]) => Promise<unknown>;
  onUpdateImageState: (relativePath: string, updates: Record<string, unknown>) => Promise<void>;
  onCreateBoard: (name: string, description?: string) => Promise<BoardMutationResult>;
  onUpdateBoardPins: (boardId: string, relativePaths: string[], pinned?: boolean) => Promise<unknown>;
}

const emptyPaneState = (): FolderPaneState => ({
  images: [],
  total: 0,
  loading: false,
  error: "",
});

const getFolderSource = (folderRef: string, context: GalleryContext | null) => {
  const { sourceId } = parseFolderRef(folderRef);
  return context?.sources.find((source) => source.id === sourceId);
};

const getFolderLabel = (folderRef: string, context: GalleryContext | null) =>
  formatFolderLabel(
    folderRef,
    context?.sources ?? [],
    (source, fallbackId) => {
      if (source?.kind === "output") {
        return "输出图库";
      }
      if (source?.kind === "input") {
        return "输入图库";
      }
      return source?.name || fallbackId;
    },
  );

const getFolderOption = (folderRef: string, context: GalleryContext | null): FolderOption => {
  const { sourceId, relativePath } = parseFolderRef(folderRef);
  const source = context?.sources.find((item) => item.id === sourceId);
  const sourceName = source?.kind === "output"
    ? "输出图库"
    : source?.kind === "input"
      ? "输入图库"
      : source?.name || sourceId;
  const segments = relativePath.split("/").filter(Boolean);
  const label = segments.at(-1) || "./";
  const parent = segments.length > 1 ? segments.slice(0, -1).join("/") : sourceName;
  const fullLabel = getFolderLabel(folderRef, context);
  return {
    value: folderRef,
    label,
    parent,
    sourceName,
    searchText: `${fullLabel} ${sourceName} ${relativePath}`.toLowerCase(),
  };
};

const getTargetFolderPayload = (folderRef: string) => {
  const { sourceId, relativePath } = parseFolderRef(folderRef);
  return { targetSourceId: sourceId, targetSubfolder: relativePath };
};

const FolderCombobox = ({
  label,
  value,
  options,
  onChange,
  emptyText,
}: {
  label: string;
  value: string;
  options: FolderOption[];
  onChange: (value: string) => void;
  emptyText: string;
}) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];
  const normalizedQuery = query.trim().toLowerCase();
  const visibleOptions = normalizedQuery
    ? options.filter((option) => option.searchText.includes(normalizedQuery))
    : options;

  useEffect(() => {
    if (!open) {
      return;
    }
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  const commit = (option: FolderOption | undefined) => {
    if (!option) {
      return;
    }
    onChange(option.value);
    setOpen(false);
    setQuery("");
  };

  return (
    <div className="ue-folder-combobox" ref={rootRef}>
      <button
        className={`ue-folder-combobox-trigger ${open ? "is-open" : ""}`}
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-label={label}
      >
        <Folder size={14} />
        <span>
          <strong>{selected?.label ?? "./"}</strong>
          {selected?.parent ? <em>{selected.parent}</em> : null}
        </span>
        <ChevronDown size={14} />
      </button>
      {open ? (
        <div className="ue-folder-combobox-menu">
          <label className="ue-folder-combobox-search">
            <Search size={14} />
            <input
              autoFocus
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setOpen(false);
                  setQuery("");
                } else if (event.key === "ArrowDown") {
                  event.preventDefault();
                  setActiveIndex((current) => Math.min(current + 1, visibleOptions.length - 1));
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  setActiveIndex((current) => Math.max(current - 1, 0));
                } else if (event.key === "Enter") {
                  event.preventDefault();
                  commit(visibleOptions[activeIndex]);
                }
              }}
              placeholder="搜索目录"
            />
          </label>
          <div className="ue-folder-combobox-list" role="listbox" aria-label={label}>
            {visibleOptions.length ? (
              visibleOptions.map((option, index) => (
                <button
                  key={option.value}
                  className={`${option.value === value ? "is-selected" : ""} ${index === activeIndex ? "is-active" : ""}`}
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => commit(option)}
                  role="option"
                  aria-selected={option.value === value}
                >
                  <Folder size={14} />
                  <span>
                    <strong>{option.label}</strong>
                    <em>{option.parent}</em>
                  </span>
                </button>
              ))
            ) : (
              <div className="ue-folder-combobox-empty">{emptyText}</div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export const DualFolderWorkspace = ({
  context,
  initialFolder,
  sortBy,
  sortOrder,
  boards,
  onOpenDetail,
  onOpenWorkflow,
  onMoveImages,
  onDeleteImages,
  onUpdateImageState,
  onCreateBoard,
  onUpdateBoardPins,
}: DualFolderWorkspaceProps) => {
  const { t, locale } = useI18n();
  const { confirm } = useConfirm();
  const { pushToast } = useToast();
  const { runOperation } = useOperationStatus();
  const text = useMemo(() => locale === "en"
    ? ({
        title: "Dual folder mode",
        hint: "Open two folders side by side. Select, right-click, or drag images to organize them.",
        left: "Left folder",
        right: "Right folder",
        selected: (count: number) => `${count} selected`,
        selectAll: "Select all",
        invertSelection: "Invert",
        clearSelection: "Clear",
        refresh: "Refresh",
        moveOther: "Move to other pane",
        dropHint: "Drop here to move",
        readOnly: "Target is read-only",
        empty: "No images in this folder",
        loading: "Loading folder...",
        moving: "Moving images...",
        moved: "Moved",
        moveConfirmTitle: "Move selected images",
        moveConfirm: (count: number, target: string) => `Move ${count} image(s) to "${target}"?`,
        pinConfirm: (count: number) => `Pin ${count} selected image(s)?`,
        unpinConfirm: (count: number) => `Unpin ${count} selected image(s)?`,
        addToBoardConfirm: (count: number, target: string) => `Add ${count} selected image(s) to "${target}"?`,
        sameFolder: "Already in this folder",
        noMatch: "No matching folders",
        loadError: "Failed to load folder images.",
        moveError: "Failed to move images.",
        openDetail: "Open detail",
        openFull: "Open full size",
        openWorkflow: "Open workflow",
        metadata: "View Metadata",
        copyImage: "Copy image",
        copyFilename: "Copy filename",
        copyPath: "Copy path",
        copyPrompt: "Copy positive prompt",
        copySuccess: "Copied",
        copyImageSuccess: "Image copied",
        copyError: "Failed to copy",
        promptMissing: "No positive prompt found",
        select: "Select",
        deselect: "Deselect",
        pin: "Pin",
        unpin: "Unpin",
        addToBoard: "Add to board",
        delete: "Delete",
        deleteTitle: "Delete selected images",
        deleteMessage: (count: number) => `Delete ${count} selected image(s)?`,
        deleteSuccess: "Deleted",
        deleteError: "Failed to delete images",
        metadataError: "Failed to load metadata",
      })
    : ({
        title: "双栏目录整理",
        hint: "左右各打开一个目录，可选择、右键或拖拽图片进行整理。",
        left: "左侧目录",
        right: "右侧目录",
        selected: (count: number) => `已选 ${count} 张`,
        selectAll: "全选",
        invertSelection: "反选",
        clearSelection: "清空",
        refresh: "刷新",
        moveOther: "移动到另一栏",
        dropHint: "拖到这里移动",
        readOnly: "目标目录只读",
        empty: "这个目录没有图片",
        loading: "正在加载目录...",
        moving: "正在移动图片...",
        moved: "已移动",
        moveConfirmTitle: "移动选中图片",
        moveConfirm: (count: number, target: string) => `将 ${count} 张图片移动到“${target}”吗？`,
        pinConfirm: (count: number) => `将选中的 ${count} 张图片设为 Pin 吗？`,
        unpinConfirm: (count: number) => `取消选中 ${count} 张图片的 Pin 吗？`,
        addToBoardConfirm: (count: number, target: string) => `将选中的 ${count} 张图片加入“${target}”吗？`,
        sameFolder: "已在这个目录",
        noMatch: "没有匹配目录",
        loadError: "目录图片加载失败。",
        moveError: "图片移动失败。",
        openDetail: "打开详情",
        openFull: "打开原图",
        openWorkflow: "打开工作流",
        metadata: "查看 Metadata",
        copyImage: "复制图片",
        copyFilename: "复制文件名",
        copyPath: "复制路径",
        copyPrompt: "复制正向提示词",
        copySuccess: "已复制",
        copyImageSuccess: "已复制图片",
        copyError: "复制失败",
        promptMissing: "没有找到正向提示词",
        select: "选择",
        deselect: "取消选择",
        pin: "置顶",
        unpin: "取消置顶",
        addToBoard: "加入图版",
        delete: "删除",
        deleteTitle: "删除所选图片",
        deleteMessage: (count: number) => `确定删除选中的 ${count} 张图片吗？`,
        deleteSuccess: "已删除",
        deleteError: "删除图片失败",
        metadataError: "Metadata 加载失败",
      }), [locale]);

  const folderRefs = useMemo(() => {
    const refs = new Set<string>();
    for (const source of context?.sources ?? []) {
      if (source.enabled && source.exists) {
        refs.add(makeSourceRootRef(source.id));
      }
    }
    for (const subfolder of context?.subfolders ?? []) {
      refs.add(subfolder);
    }
    return [...refs].sort((left, right) => getFolderLabel(left, context).localeCompare(getFolderLabel(right, context), undefined, {
      numeric: true,
      sensitivity: "base",
    }));
  }, [context]);

  const folderOptions = useMemo(
    () => folderRefs.map((folderRef) => getFolderOption(folderRef, context)),
    [context, folderRefs],
  );

  const fallbackRoot = makeSourceRootRef(DEFAULT_OUTPUT_SOURCE_ID);
  const normalizedInitialFolder = initialFolder && initialFolder !== "__trash__" ? initialFolder : fallbackRoot;
  const initialRightFolder = folderRefs.find((option) => option !== normalizedInitialFolder) ?? normalizedInitialFolder;
  const [leftFolder, setLeftFolder] = useState(normalizedInitialFolder);
  const [rightFolder, setRightFolder] = useState(initialRightFolder);
  const [leftState, setLeftState] = useState<FolderPaneState>(() => emptyPaneState());
  const [rightState, setRightState] = useState<FolderPaneState>(() => emptyPaneState());
  const [leftSelection, setLeftSelection] = useState<PaneSelectionState>(() => emptySelectionState());
  const [rightSelection, setRightSelection] = useState<PaneSelectionState>(() => emptySelectionState());
  const [activePane, setActivePane] = useState<PaneId>("left");
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [movingMessage, setMovingMessage] = useState("");
  const [contextMenu, setContextMenu] = useState<ImageContextMenuState | null>(null);
  const [boardPickerPaths, setBoardPickerPaths] = useState<string[]>([]);
  const [metadataViewerImage, setMetadataViewerImage] = useState<ImageRecord | null>(null);

  const getPaneState = useCallback((pane: PaneId) => (pane === "left" ? leftState : rightState), [leftState, rightState]);
  const getPaneFolder = useCallback((pane: PaneId) => (pane === "left" ? leftFolder : rightFolder), [leftFolder, rightFolder]);
  const getPaneSelection = useCallback((pane: PaneId) => (pane === "left" ? leftSelection : rightSelection), [leftSelection, rightSelection]);
  const setPaneSelection = useCallback((pane: PaneId, updater: (current: PaneSelectionState) => PaneSelectionState) => {
    if (pane === "left") {
      setLeftSelection(updater);
    } else {
      setRightSelection(updater);
    }
  }, []);

  const clearPaneSelection = useCallback((pane: PaneId) => {
    setPaneSelection(pane, () => emptySelectionState());
  }, [setPaneSelection]);

  useEffect(() => {
    if (normalizedInitialFolder) {
      setLeftFolder(normalizedInitialFolder);
    }
  }, [normalizedInitialFolder]);

  useEffect(() => {
    if (!folderRefs.includes(rightFolder)) {
      setRightFolder(folderRefs.find((option) => option !== leftFolder) ?? leftFolder);
    }
  }, [folderRefs, leftFolder, rightFolder]);

  useEffect(() => {
    clearPaneSelection("left");
  }, [leftFolder, clearPaneSelection]);

  useEffect(() => {
    clearPaneSelection("right");
  }, [rightFolder, clearPaneSelection]);

  const loadPane = useCallback(async (pane: PaneId, folderRef: string, forceRefresh = false) => {
    const setPaneState = pane === "left" ? setLeftState : setRightState;
    setPaneState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const response = await galleryApi.listImages(
        1,
        pageSize,
        "",
        "",
        folderRef,
        "",
        "",
        "",
        false,
        "",
        sortBy,
        sortOrder,
        forceRefresh,
      );
      setPaneState({
        images: response.images,
        total: response.total,
        loading: false,
        error: "",
      });
    } catch {
      setPaneState((current) => ({
        ...current,
        loading: false,
        error: text.loadError,
      }));
    }
  }, [sortBy, sortOrder, text.loadError]);

  const reloadBothPanes = useCallback(async (forceRefresh = true) => {
    await Promise.all([
      loadPane("left", leftFolder, forceRefresh),
      loadPane("right", rightFolder, forceRefresh),
    ]);
  }, [leftFolder, loadPane, rightFolder]);

  useEffect(() => {
    void loadPane("left", leftFolder);
  }, [leftFolder, loadPane]);

  useEffect(() => {
    void loadPane("right", rightFolder);
  }, [rightFolder, loadPane]);

  const setTimedMessage = useCallback((message: string, timeout = 1800) => {
    setMovingMessage(message);
    window.setTimeout(() => setMovingMessage(""), timeout);
  }, []);

  const getSelectedPathsForAction = useCallback((pane: PaneId, image: ImageRecord) => {
    const selection = getPaneSelection(pane);
    return selection.selectedPaths.includes(image.relative_path) && selection.selectedPaths.length > 1
      ? selection.selectedPaths
      : [image.relative_path];
  }, [getPaneSelection]);

  const selectImage = (pane: PaneId, image: ImageRecord, event: React.MouseEvent) => {
    const state = getPaneState(pane);
    const path = image.relative_path;
    const paths = state.images.map((item) => item.relative_path);
    setActivePane(pane);
    setPaneSelection(pane, (current) => {
      return selectPaneImage({
        current,
        paths,
        path,
        shiftKey: event.shiftKey,
        toggleKey: event.ctrlKey || event.metaKey,
      });
    });
  };

  const selectAll = useCallback((pane: PaneId) => {
    const paths = getPaneState(pane).images.map((image) => image.relative_path);
    setActivePane(pane);
    setPaneSelection(pane, (current) => ({
      selectedPaths: paths,
      focusedPath: current.focusedPath || paths[0] || "",
      lastSelectedPath: current.lastSelectedPath || paths[0] || "",
    }));
  }, [getPaneState, setPaneSelection]);

  const invertSelection = (pane: PaneId) => {
    const paths = getPaneState(pane).images.map((image) => image.relative_path);
    setActivePane(pane);
    setPaneSelection(pane, (current) => {
      return invertPaneSelection(paths, current);
    });
  };

  const toggleImageBadgeSelection = (pane: PaneId, image: ImageRecord) => {
    const path = image.relative_path;
    setActivePane(pane);
    setPaneSelection(pane, (current) => {
      return togglePaneBadgeSelection(path, current);
    });
  };

  const movePathsToPane = useCallback(async (relativePaths: string[], sourceFolder: string, targetPane: PaneId) => {
    const targetFolder = getPaneFolder(targetPane);
    if (!relativePaths.length) {
      return;
    }
    if (targetFolder === sourceFolder) {
      setTimedMessage(text.sameFolder, 1200);
      return;
    }
    const targetSource = getFolderSource(targetFolder, context);
    if (!targetSource?.writable) {
      setTimedMessage(text.readOnly);
      return;
    }
    const approved = await confirm({
      title: text.moveConfirmTitle,
      message: text.moveConfirm(relativePaths.length, getFolderLabel(targetFolder, context)),
      tone: "warning",
      confirmLabel: locale === "en" ? "Move" : "移动",
      cancelLabel: locale === "en" ? "Cancel" : "取消",
    });
    if (!approved) {
      return;
    }

    const { targetSourceId, targetSubfolder } = getTargetFolderPayload(targetFolder);
    try {
      await runOperation(() => onMoveImages(relativePaths, targetSubfolder, targetSourceId), {
        pending: t("operationMoveImages"),
        success: t("operationMoveImagesSuccess"),
        error: (error) => (error instanceof Error ? error.message : text.moveError),
      });
      setMovingMessage("");
      setTimedMessage(text.moved);
      clearPaneSelection(targetPane === "left" ? "right" : "left");
      clearPaneSelection(targetPane);
      await reloadBothPanes(true);
    } catch {
      setTimedMessage(text.moveError);
    }
  }, [clearPaneSelection, confirm, context, getPaneFolder, locale, onMoveImages, reloadBothPanes, runOperation, setTimedMessage, t, text]);

  const moveActiveSelectionToOtherPane = useCallback(async (pane: PaneId) => {
    const selection = getPaneSelection(pane);
    const sourceFolder = getPaneFolder(pane);
    await movePathsToPane(selection.selectedPaths, sourceFolder, pane === "left" ? "right" : "left");
  }, [getPaneFolder, getPaneSelection, movePathsToPane]);

  const handlePaneDrop = async (targetPane: PaneId, event: React.DragEvent<HTMLElement>) => {
    if (!dragHasInternalImage(event.dataTransfer.types ?? [])) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const payload = dragState ?? readInternalDragPayload(event.dataTransfer.getData.bind(event.dataTransfer));
    setDragState(null);
    if (!payload) {
      return;
    }
    await movePathsToPane(payload.relativePaths, payload.sourceFolder, targetPane);
  };

  const copyText = async (value: string, successMessage = text.copySuccess) => {
    try {
      await navigator.clipboard.writeText(value);
      pushToast(successMessage, "success");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : text.copyError, "error");
    }
  };

  const getAbsoluteImageUrl = (image: ImageRecord) =>
    new URL(image.original_url || image.url, window.location.origin).toString();

  const copyImageFile = async (image: ImageRecord) => {
    try {
      if (!("clipboard" in navigator) || typeof ClipboardItem === "undefined") {
        await copyText(getAbsoluteImageUrl(image), text.copySuccess);
        return;
      }
      const response = await fetch(getAbsoluteImageUrl(image));
      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) {
        throw new Error(text.copyError);
      }
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      pushToast(text.copyImageSuccess, "success");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : text.copyError, "error");
    }
  };

  const copyPositivePrompt = async (image: ImageRecord) => {
    try {
      const metadata = await galleryApi.getImageMetadata(image.relative_path);
      const prompt = getPositivePromptText(metadata);
      if (!prompt) {
        pushToast(text.promptMissing, "info");
        return;
      }
      await copyText(prompt, text.copySuccess);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : text.metadataError, "error");
    }
  };

  const deletePaths = useCallback(async (paths: string[]) => {
    if (!paths.length) {
      return;
    }
    const approved = await confirm({
      title: text.deleteTitle,
      message: text.deleteMessage(paths.length),
      tone: paths.length >= 20 ? "danger" : "warning",
      confirmLabel: text.delete,
      cancelLabel: locale === "en" ? "Cancel" : "取消",
    });
    if (!approved) {
      return;
    }
    try {
      await runOperation(() => onDeleteImages(paths), {
        pending: t("operationDeleteImages"),
        success: text.deleteSuccess,
        error: (error) => (error instanceof Error ? error.message : text.deleteError),
      });
      clearPaneSelection("left");
      clearPaneSelection("right");
      await reloadBothPanes(true);
    } catch (error) {
      setTimedMessage(error instanceof Error ? error.message : text.deleteError);
    }
  }, [clearPaneSelection, confirm, locale, onDeleteImages, reloadBothPanes, runOperation, setTimedMessage, t, text]);

  const handleOpenContextMenu = (event: React.MouseEvent, pane: PaneId, image: ImageRecord) => {
    event.preventDefault();
    event.stopPropagation();
    setActivePane(pane);
    const selection = getPaneSelection(pane);
    if (!selection.selectedPaths.includes(image.relative_path)) {
      setPaneSelection(pane, () => ({
        selectedPaths: [image.relative_path],
        focusedPath: image.relative_path,
        lastSelectedPath: image.relative_path,
      }));
    } else {
      setPaneSelection(pane, (current) => ({ ...current, focusedPath: image.relative_path }));
    }
    const position = placeMenuForEvent(event, { width: 292, height: 430 }, "pointer");
    setContextMenu({ pane, image, x: position.x, y: position.y });
  };

  const closeContextMenu = useCallback(() => setContextMenu(null), []);
  useDismissableLayer(Boolean(contextMenu), closeContextMenu);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }
      const pane = activePane;
      const selection = getPaneSelection(pane);
      const state = getPaneState(pane);
      const focusedImage = state.images.find((image) => image.relative_path === selection.focusedPath) ?? state.images[0];
      const action = getDualFolderShortcutAction(event);

      if (action === "selectAll") {
        event.preventDefault();
        selectAll(pane);
      } else if (action === "moveToOtherPane") {
        event.preventDefault();
        void moveActiveSelectionToOtherPane(pane);
      } else if (action === "refresh") {
        event.preventDefault();
        void reloadBothPanes(true);
      } else if (action === "escape") {
        event.preventDefault();
        if (contextMenu) {
          setContextMenu(null);
        } else {
          clearPaneSelection(pane);
        }
      } else if (action === "delete") {
        event.preventDefault();
        void deletePaths(selection.selectedPaths);
      } else if (action === "openDetail" && focusedImage) {
        event.preventDefault();
        onOpenDetail(focusedImage);
      } else if (action === "togglePane") {
        event.preventDefault();
        setActivePane((current) => current === "left" ? "right" : "left");
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activePane, clearPaneSelection, contextMenu, deletePaths, getPaneSelection, getPaneState, moveActiveSelectionToOtherPane, onOpenDetail, reloadBothPanes, selectAll]);

  const handleAddToBoard = async (boardId: string) => {
    if (!boardPickerPaths.length) {
      return;
    }
    const board = boards.find((item) => item.id === boardId);
    const approved = await confirm({
      title: text.addToBoard,
      message: text.addToBoardConfirm(boardPickerPaths.length, board?.name || boardId),
      tone: "warning",
      confirmLabel: locale === "en" ? "Add" : "加入",
      cancelLabel: locale === "en" ? "Cancel" : "取消",
    });
    if (!approved) {
      return;
    }

    await runOperation(() => onUpdateBoardPins(boardId, boardPickerPaths, true), {
      pending: t("operationAddToBoard"),
      success: t("boardAddSuccess", { count: boardPickerPaths.length }),
    });
    setBoardPickerPaths([]);
  };

  const handleTogglePinned = async (paths: string[], pinned: boolean) => {
    if (!paths.length) {
      return;
    }
    const approved = await confirm({
      title: pinned ? text.pin : text.unpin,
      message: pinned ? text.pinConfirm(paths.length) : text.unpinConfirm(paths.length),
      tone: "warning",
      confirmLabel: pinned ? text.pin : text.unpin,
      cancelLabel: locale === "en" ? "Cancel" : "取消",
    });
    if (!approved) {
      return;
    }
    for (const path of paths) {
      await onUpdateImageState(path, { pinned });
    }
  };

  const renderPane = (pane: PaneId, folderRef: string, setFolder: (value: string) => void, state: FolderPaneState) => {
    const targetSource = getFolderSource(folderRef, context);
    const canDrop = Boolean(targetSource?.writable);
    const activeDrop = dragState && dragState.from !== pane;
    const sameDropFolder = Boolean(activeDrop && dragState?.sourceFolder === folderRef);
    const selection = getPaneSelection(pane);
    const selectedSet = new Set(selection.selectedPaths);
    return (
      <section
        className={`ue-dual-pane ${activePane === pane ? "is-active-pane" : ""} ${activeDrop ? "is-drop-active" : ""} ${!canDrop ? "is-read-only" : ""}`}
        onClick={() => setActivePane(pane)}
        onDragEnter={(event) => {
          if (!dragHasInternalImage(event.dataTransfer.types ?? [])) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
        }}
        onDragOver={(event) => {
          if (!dragHasInternalImage(event.dataTransfer.types ?? [])) {
            return;
          }
          event.preventDefault();
          event.stopPropagation();
        }}
        onDrop={(event) => {
          void handlePaneDrop(pane, event);
        }}
      >
        <div className="ue-dual-pane-head">
          <div>
            <span>{pane === "left" ? text.left : text.right}</span>
            <strong>{state.total}</strong>
            {selection.selectedPaths.length ? <em>{text.selected(selection.selectedPaths.length)}</em> : null}
          </div>
          <FolderCombobox
            label={pane === "left" ? text.left : text.right}
            value={folderRef}
            options={folderOptions}
            onChange={setFolder}
            emptyText={text.noMatch}
          />
        </div>

        <div className="ue-dual-pane-actions" aria-label={pane === "left" ? text.left : text.right}>
          <button type="button" onClick={() => selectAll(pane)} title={text.selectAll} aria-label={text.selectAll}>
            <CheckSquare size={14} />
            <span>{text.selectAll}</span>
          </button>
          <button type="button" onClick={() => invertSelection(pane)} title={text.invertSelection} aria-label={text.invertSelection}>
            <Square size={14} />
            <span>{text.invertSelection}</span>
          </button>
          <button type="button" onClick={() => clearPaneSelection(pane)} title={text.clearSelection} aria-label={text.clearSelection}>
            <Square size={14} />
            <span>{text.clearSelection}</span>
          </button>
          <button type="button" onClick={() => void loadPane(pane, folderRef, true)} title={text.refresh} aria-label={text.refresh}>
            <RefreshCcw size={14} />
            <span>{text.refresh}</span>
          </button>
          <button
            type="button"
            disabled={!selection.selectedPaths.length}
            onClick={() => void moveActiveSelectionToOtherPane(pane)}
            title={text.moveOther}
            aria-label={text.moveOther}
          >
            <MoveRight size={14} />
            <span>{text.moveOther}</span>
          </button>
        </div>

        {activeDrop ? (
          <div className="ue-dual-drop-hint">
            <MoveRight size={16} />
            <span>{sameDropFolder ? text.sameFolder : canDrop ? text.dropHint : text.readOnly}</span>
          </div>
        ) : null}

        {state.loading ? (
          <div className="ue-dual-pane-state">
            <Loader2 size={18} />
            <span>{text.loading}</span>
          </div>
        ) : state.error ? (
          <div className="ue-dual-pane-state ue-dual-pane-state--error">{state.error}</div>
        ) : state.images.length === 0 ? (
          <div className="ue-dual-pane-state">
            <ImageIcon size={28} />
            <span>{text.empty}</span>
          </div>
        ) : (
          <div className="ue-dual-grid">
            {state.images.map((image) => {
              const selected = selectedSet.has(image.relative_path);
              const focused = selection.focusedPath === image.relative_path;
              const draggedPaths = selected && selection.selectedPaths.length > 1 ? selection.selectedPaths : [image.relative_path];
              return (
                <DualFolderCard
                  key={image.relative_path}
                  image={image}
                  selected={selected}
                  focused={focused}
                  draggedPaths={draggedPaths}
                  deselectLabel={text.deselect}
                  onClick={(event) => {
                    event.stopPropagation();
                    selectImage(pane, image, event);
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    onOpenDetail(image);
                  }}
                  onContextMenu={(event) => handleOpenContextMenu(event, pane, image)}
                  onDragStart={(event, nextDraggedPaths) => {
                    event.stopPropagation();
                    event.dataTransfer.effectAllowed = "move";
                    const payload: DragState = { from: pane, image, relativePaths: nextDraggedPaths, sourceFolder: folderRef };
                    event.dataTransfer.setData(INTERNAL_IMAGE_MIME, JSON.stringify(payload));
                    setActivePane(pane);
                    setDragState(payload);
                    if (!selected) {
                      setPaneSelection(pane, () => ({
                        selectedPaths: [image.relative_path],
                        focusedPath: image.relative_path,
                        lastSelectedPath: image.relative_path,
                      }));
                    }
                  }}
                  onDragEnd={() => setDragState(null)}
                  onToggleSelected={() => toggleImageBadgeSelection(pane, image)}
                />
              );
            })}
          </div>
        )}
      </section>
    );
  };

  const renderContextMenu = () => {
    if (!contextMenu) {
      return null;
    }
    const { pane, image } = contextMenu;
    const selectedPaths = getSelectedPathsForAction(pane, image);
    const selected = getPaneSelection(pane).selectedPaths.includes(image.relative_path);
    const targetPane = pane === "left" ? "right" : "left";
    const targetSource = getFolderSource(getPaneFolder(targetPane), context);
    const canMove = Boolean(targetSource?.writable);
    const menuAction = (action: () => void) => {
      action();
      setContextMenu(null);
    };
    return (
      <FloatingLayerPortal>
      <div
        className="ue-context-menu ue-context-menu--gallery ue-dual-context-menu"
        style={{ top: contextMenu.y, left: contextMenu.x }}
        onClick={(event) => event.stopPropagation()}
        onContextMenu={(event) => event.preventDefault()}
      >
        <div className="ue-context-menu-head">
          <strong title={image.filename}>{image.filename}</strong>
          <span>{selectedPaths.length > 1 ? text.selected(selectedPaths.length) : formatFileSize(image.size)}</span>
        </div>
        <div className="ue-context-menu-grid">
          <button className="ue-context-menu-item" onClick={() => menuAction(() => onOpenDetail(image))}>
            <ImageIcon size={14} />
            <span>{text.openDetail}</span>
          </button>
          <button className="ue-context-menu-item" onClick={() => menuAction(() => window.open(getAbsoluteImageUrl(image), "_blank", "noopener,noreferrer"))}>
            <ExternalLink size={14} />
            <span>{text.openFull}</span>
          </button>
          <button className="ue-context-menu-item" onClick={() => menuAction(() => void onOpenWorkflow(image))}>
            <Send size={14} />
            <span>{text.openWorkflow}</span>
          </button>
          <button className="ue-context-menu-item" onClick={() => menuAction(() => setMetadataViewerImage(image))}>
            <FileJson size={14} />
            <span>{text.metadata}</span>
          </button>
        </div>
        <div className="ue-context-menu-grid ue-context-menu-grid--copy">
          <button className="ue-context-menu-item" onClick={() => menuAction(() => void copyImageFile(image))}>
            <CheckSquare size={14} />
            <span>{text.copyImage}</span>
          </button>
          <button className="ue-context-menu-item" onClick={() => menuAction(() => void copyText(image.filename))}>
            <ClipboardCopy size={14} />
            <span>{text.copyFilename}</span>
          </button>
          <button className="ue-context-menu-item" onClick={() => menuAction(() => void copyText(image.relative_path))}>
            <Folder size={14} />
            <span>{text.copyPath}</span>
          </button>
          <button className="ue-context-menu-item" onClick={() => menuAction(() => void copyPositivePrompt(image))}>
            <ClipboardCopy size={14} />
            <span>{text.copyPrompt}</span>
          </button>
        </div>
        <div className="ue-context-menu-section">
          <button
            className="ue-context-menu-item"
            onClick={() => menuAction(() => {
              if (selected) {
                setPaneSelection(pane, (current) => ({
                  ...current,
                  selectedPaths: current.selectedPaths.filter((path) => path !== image.relative_path),
                }));
              } else {
                setPaneSelection(pane, (current) => ({
                  selectedPaths: [...current.selectedPaths, image.relative_path],
                  focusedPath: image.relative_path,
                  lastSelectedPath: image.relative_path,
                }));
              }
            })}
          >
            {selected ? <CheckSquare size={14} /> : <Square size={14} />}
            <span>{selected ? text.deselect : text.select}</span>
          </button>
          <button
            className="ue-context-menu-item"
            disabled={!canMove}
            onClick={() => menuAction(() => void movePathsToPane(selectedPaths, getPaneFolder(pane), targetPane))}
          >
            <MoveRight size={14} />
            <span>{canMove ? text.moveOther : text.readOnly}</span>
          </button>
          <button
            className="ue-context-menu-item"
            onClick={() => menuAction(() => {
              void handleTogglePinned(selectedPaths, !image.pinned);
            })}
          >
            <Pin size={14} fill={image.pinned ? "currentColor" : "none"} />
            <span>{image.pinned ? text.unpin : text.pin}</span>
          </button>
          <button className="ue-context-menu-item" onClick={() => menuAction(() => setBoardPickerPaths(selectedPaths))}>
            <FolderPlus size={14} />
            <span>{text.addToBoard}</span>
          </button>
          <button className="ue-context-menu-item ue-context-menu-item--danger" onClick={() => menuAction(() => void deletePaths(selectedPaths))}>
            <Trash2 size={14} />
            <span>{text.delete}</span>
          </button>
        </div>
      </div>
      </FloatingLayerPortal>
    );
  };

  return (
    <div className="ue-dual-workspace">
      <div className="ue-dual-intro">
        <div>
          <ArrowRightLeft size={18} />
          <div>
            <strong>{text.title}</strong>
            <span>{text.hint}</span>
          </div>
        </div>
        {movingMessage ? <em>{movingMessage}</em> : null}
      </div>

      <div className="ue-dual-layout">
        {renderPane("left", leftFolder, setLeftFolder, leftState)}
        {renderPane("right", rightFolder, setRightFolder, rightState)}
      </div>

      {renderContextMenu()}

      <BoardPickerModal
        open={boardPickerPaths.length > 0}
        boards={boards}
        selectedCount={boardPickerPaths.length}
        onClose={() => setBoardPickerPaths([])}
        onCreateBoard={onCreateBoard}
        onAddToBoard={handleAddToBoard}
      />

      {metadataViewerImage ? (
        <MetadataViewerModal image={metadataViewerImage} onClose={() => setMetadataViewerImage(null)} />
      ) : null}
    </div>
  );
};
