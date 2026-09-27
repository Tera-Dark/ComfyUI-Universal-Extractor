import { preferredScrollBehavior } from "../../utils/imageLoading";
import { readStorageItem, writeStorageItem } from "../../utils/safeStorage";
import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  ChevronUp,
  CheckSquare,
  ClipboardCopy,
  ExternalLink,
  FileJson,
  Folder as FolderIcon,
  FolderPlus,
  Image as ImageIcon,
  Layers,
  Pin,
  RotateCcw,
  Send,
  Square,
  Tag,
  Trash2,
} from "lucide-react";

import { useI18n } from "../../i18n/I18nProvider";
import { useConfirm } from "../shared/ConfirmDialog";
import { parseFolderRef } from "../shared/folderTree";
import { useToast } from "../shared/ToastViewport";
import { useOperationStatus } from "../shared/OperationStatusCenter";
import type {
  BoardMutationResult,
  BoardSummary,
  ColorIndexStatus,
  DeleteImagesResult,
  FingerprintIndexStatus,
  GalleryContext,
  ImageRecord,
  MoveImagesResult,
  TrashItem,
  VariantGroup,
  VariantGroupType,
} from "../../types/universal-gallery";
import { formatFileSize } from "../../utils/formatters";
import { describeFailedPaths, getDeleteOutcome } from "../../utils/galleryOperationResults";
import { getPositivePromptText } from "../../utils/metadata";
import { galleryApi } from "../../services/galleryApi";
import { BoardPickerModal } from "./BoardPickerModal";
import { CategoryPickerModal } from "./CategoryPickerModal";
import { GalleryMainContent } from "./GalleryMainContent";
import { GalleryToolbar } from "./GalleryToolbar";
import { prefetchGalleryImage } from "./galleryImagePrefetch";
import { dedupeVisibleSelection, getIntersectingSelectionKeys, selectPathRange, togglePathSelection, type RectLike, type SelectionBoxState } from "./gallerySelectionModel";
import { getActiveFilterControlCount, getStoredViewMode, type ContentViewMode } from "./galleryWorkspaceModel";
import { TrashWorkspaceView } from "./TrashWorkspaceView";
import { estimateMasonryCardHeight, useVirtualMasonry } from "./useVirtualMasonry";
import { FloatingLayerPortal, isEditableTarget, placeMenuForEvent, useDismissableLayer } from "../../utils/interaction";
// Keep the first Gallery screen immediate; organizer, variants, sharing and
// metadata are downloaded only when someone opens those optional surfaces.
const DualFolderWorkspace = lazy(() => import("./DualFolderWorkspace").then((m) => ({ default: m.DualFolderWorkspace })));
const VariantGroupsView = lazy(() => import("./VariantGroupsView").then((m) => ({ default: m.VariantGroupsView })));
const BoardShareModal = lazy(() => import("./BoardShareModal").then((m) => ({ default: m.BoardShareModal })));
const MetadataViewerModal = lazy(() => import("./MetadataViewerModal").then((m) => ({ default: m.MetadataViewerModal })));

const MASONRY_GAP = 14;
const SELECTION_AUTO_SCROLL_EDGE_PX = 72;
const SELECTION_AUTO_SCROLL_MAX_STEP_PX = 30;
const GALLERY_VIEW_MODE_STORAGE_KEY = "universal-extractor:gallery-view-mode";
const MOBILE_DENSITY_STORAGE_KEY = "universal-extractor:mobile-density";

interface GalleryWorkspaceProps {
  images: ImageRecord[];
  context: GalleryContext | null;
  total: number;
  page: number;
  totalPages: number;
  selectedCategory: string;
  selectedSubfolder: string;
  selectedBoardId: string;
  dateFrom: string;
  dateTo: string;
  favoritesOnly: boolean;
  selectedColorFamily: string;
  colorIndexStatus: ColorIndexStatus | null;
  sortBy: string;
  sortOrder: string;
  gridColumns: number;
  selectedImagePaths: string[];
  trashItems: TrashItem[];
  isTrashView: boolean;
  importMessage: string;
  importFolderRef?: string;
  onOpenImportFolder?: (folderRef: string) => void;
  isLoading: boolean;
  isRefreshing: boolean;
  hasPendingLiveRefresh: boolean;
  error: string | null;
  boards: BoardSummary[];
  defaultSelectionMode: boolean;
  enableImagePrefetch: boolean;
  onSelectionDragChange?: (active: boolean) => void;
  onSelectionModeActiveChange?: (active: boolean) => void;
  onOpenDetail: (image: ImageRecord, scope?: ImageRecord[]) => void;
  onVisibleImagesChange?: (images: ImageRecord[]) => void;
  inspectorClearSignal?: number;
  onPageChange: (page: number) => void;
  onCategoryChange: (category: string) => void;
  onBoardChange: (boardId: string) => void;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onFavoritesOnlyChange: (value: boolean) => void;
  onColorFamilyChange: (value: string) => void;
  onSortByChange: (value: string) => void;
  onSortOrderChange: (value: string) => void;
  onGridColumnsChange: (value: number) => void;
  onOpenWorkflow: (image: ImageRecord) => Promise<void>;
  onApplyLoraStack: (image: ImageRecord) => Promise<void>;
  onSelectionChange: (relativePaths: string[]) => void;
  onUpdateImageState: (relativePath: string, updates: Record<string, unknown>) => Promise<void>;
  onCreateBoard: (name: string, description?: string) => Promise<BoardMutationResult>;
  onUpdateBoardPins: (boardId: string, relativePaths: string[], pinned?: boolean) => Promise<unknown>;
  onDeleteBoard: (boardId: string) => Promise<unknown>;
  onDeleteImages: (relativePaths: string[]) => Promise<DeleteImagesResult>;
  onMoveImages: (relativePaths: string[], targetSubfolder: string, targetSourceId?: string) => Promise<MoveImagesResult>;
  onImportFiles: (files: File[], targetSourceId?: string) => Promise<unknown>;
  onApplyPendingLiveRefresh: () => void;
  onOpenSettings?: () => void;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  onRestoreTrashItem: (id: string) => Promise<void>;
  onRestoreTrashItems: (ids: string[]) => Promise<void>;
  onPurgeTrashItem: (id: string) => Promise<void>;
  onPurgeTrashItems: (ids: string[]) => Promise<void>;
}

interface ImageContextMenuState {
  image: ImageRecord;
  x: number;
  y: number;
}

interface TrashContextMenuState {
  item: TrashItem;
  x: number;
  y: number;
}

export const GalleryWorkspace = ({
  images,
  context,
  total,
  page,
  totalPages,
  selectedCategory,
  selectedSubfolder,
  selectedBoardId,
  dateFrom,
  dateTo,
  favoritesOnly,
  selectedColorFamily,
  colorIndexStatus,
  sortBy,
  sortOrder,
  gridColumns,
  selectedImagePaths,
  trashItems,
  isTrashView,
  importMessage,
  importFolderRef,
  onOpenImportFolder,
  isLoading,
  isRefreshing,
  hasPendingLiveRefresh,
  error,
  boards,
  defaultSelectionMode,
  enableImagePrefetch,
  onSelectionDragChange,
  onSelectionModeActiveChange,
  onOpenDetail,
  onVisibleImagesChange,
  inspectorClearSignal,
  onPageChange,
  onCategoryChange,
  onBoardChange,
  onDateFromChange,
  onDateToChange,
  onFavoritesOnlyChange,
  onColorFamilyChange,
  onSortByChange,
  onSortOrderChange,
  onGridColumnsChange,
  onOpenWorkflow,
  onApplyLoraStack,
  onSelectionChange,
  onUpdateImageState,
  onCreateBoard,
  onUpdateBoardPins,
  onDeleteBoard,
  onDeleteImages,
  onMoveImages,
  onImportFiles,
  onApplyPendingLiveRefresh,
  onOpenSettings,
  searchValue,
  onSearchChange,
  onRestoreTrashItem,
  onRestoreTrashItems,
  onPurgeTrashItem,
  onPurgeTrashItems,
}: GalleryWorkspaceProps) => {
  const { t } = useI18n();
  const { confirm } = useConfirm();
  const { pushToast } = useToast();
  const { runOperation } = useOperationStatus();
  const [dragActive, setDragActive] = useState(false);
  const [importTargetSourceId, setImportTargetSourceId] = useState("");
  const [boardPickerPaths, setBoardPickerPaths] = useState<string[]>([]);
  const [shareBoardId, setShareBoardId] = useState("");
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [contextMenu, setContextMenu] = useState<ImageContextMenuState | null>(null);
  const [trashContextMenu, setTrashContextMenu] = useState<TrashContextMenuState | null>(null);
  const [showColumnsMenu, setShowColumnsMenu] = useState(false);
  const [showFiltersMenu, setShowFiltersMenu] = useState(false);
  const [metadataViewerImage, setMetadataViewerImage] = useState<ImageRecord | null>(null);
  const [selectionMode, setSelectionMode] = useState(defaultSelectionMode);
  const [selectionBox, setSelectionBox] = useState<SelectionBoxState | null>(null);
  const [galleryViewMode, setGalleryViewMode] = useState<ContentViewMode>(() =>
    getStoredViewMode(GALLERY_VIEW_MODE_STORAGE_KEY, "grid"),
  );
  const [mobileDensity, setMobileDensity] = useState<"single" | "double">(() =>
    readStorageItem(MOBILE_DENSITY_STORAGE_KEY) === "double" ? "double" : "single",
  );
  const [dualFolderMode, setDualFolderMode] = useState(false);
  const [variantMode, setVariantMode] = useState(false);
  const [variantType, setVariantType] = useState<VariantGroupType | "">("");
  const variantRequest = useRef(0);
  useEffect(()=>()=>{variantRequest.current++;},[]);
  const [variantGroups, setVariantGroups] = useState<VariantGroup[]>([]);
  const [variantStatus, setVariantStatus] = useState<FingerprintIndexStatus | null>(null);
  const [variantLoading, setVariantLoading] = useState(false);
  const [variantError, setVariantError] = useState("");
  const [selectedVariantGroup, setSelectedVariantGroup] = useState<VariantGroup | null>(null);
  const [variantImages, setVariantImages] = useState<ImageRecord[]>([]);
  const [variantTotal, setVariantTotal] = useState(0);
  const [variantPage, setVariantPage] = useState(1);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [gridWidth, setGridWidth] = useState(0);
  const [selectionFrozenGridWidth, setSelectionFrozenGridWidth] = useState(0);
  const [scrollElement, setScrollElement] = useState<HTMLElement | null>(null);
  const dragDepthRef = useRef(0);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const galleryWorkspaceRef = useRef<HTMLElement | null>(null);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  const isDraggingSelectionRef = useRef(false);
  const selectionDragResetTimerRef = useRef<number | null>(null);
  const selectionBoxBasePathsRef = useRef<string[]>([]);
  const selectionBoxAccumulatedPathsRef = useRef<string[]>([]);
  const selectionBoxCardRectsRef = useRef<Record<string, RectLike>>({});
  const selectionBoxStartScrollTopRef = useRef(0);
  const selectionBoxAppendRef = useRef(false);
  const lastSelectedPathRef = useRef<string>("");
  const scrollContainerRef = useRef<HTMLElement | null>(null);

  const activeImages = variantMode && selectedVariantGroup ? variantImages : images;
  useEffect(() => {
    if (!dualFolderMode) onVisibleImagesChange?.(isTrashView || (variantMode && !selectedVariantGroup) ? [] : activeImages);
  }, [activeImages, dualFolderMode, isTrashView, onVisibleImagesChange, selectedVariantGroup, variantMode]);
  const openActiveDetail = useCallback((image: ImageRecord) => onOpenDetail(image, activeImages), [activeImages, onOpenDetail]);
  const activePage = variantMode && selectedVariantGroup ? variantPage : page;
  const activeTotal = variantMode && selectedVariantGroup ? variantTotal : total;
  const activeTotalPages = variantMode && selectedVariantGroup ? Math.max(1, Math.ceil(variantTotal / 60)) : totalPages;
  const visibleImagePaths = useMemo(
    () => variantMode && !selectedVariantGroup ? [] : activeImages.map((image) => image.relative_path),
    [activeImages, selectedVariantGroup, variantMode],
  );
  const imageIndexByPath = useMemo(
    () => new Map(activeImages.map((image, index) => [image.relative_path, index])),
    [activeImages],
  );
  const visibleSelectionPaths = useMemo(
    () => (isTrashView ? trashItems.map((item) => item.id) : visibleImagePaths),
    [isTrashView, trashItems, visibleImagePaths],
  );
  const selectedImagePathSet = useMemo(() => new Set(selectedImagePaths), [selectedImagePaths]);
  const pageSelectedPaths = useMemo(
    () => visibleSelectionPaths.filter((path) => selectedImagePathSet.has(path)),
    [selectedImagePathSet, visibleSelectionPaths],
  );
  const selectedCount = pageSelectedPaths.length;
  const hasSelection = selectedCount > 0;
  const selectionLayoutLocked = Boolean(selectionBox);
  useEffect(()=>{onSelectionDragChange?.(selectionLayoutLocked);return ()=>onSelectionDragChange?.(false);},[selectionLayoutLocked,onSelectionDragChange]);
  const selectionEnabled = !dualFolderMode;
  const inspectorSelectionActive = !isTrashView && (dualFolderMode ? selectedImagePaths.length > 0 : selectionMode || selectedCount > 0);
  const selectedTrashItems = useMemo(
    () => (isTrashView ? trashItems.filter((item) => selectedImagePathSet.has(item.id)) : []),
    [isTrashView, selectedImagePathSet, trashItems],
  );
  const activeFilterControlCount = getActiveFilterControlCount({
    selectedCategory,
    dateFrom,
    dateTo,
    favoritesOnly,
    selectedColorFamily,
    sortBy,
    sortOrder,
  });
  const selectedBoard = useMemo(
    () => boards.find((board) => board.id === selectedBoardId) ?? null,
    [boards, selectedBoardId],
  );
  const shareBoard = useMemo(
    () => boards.find((board) => board.id === shareBoardId) ?? null,
    [boards, shareBoardId],
  );
  const writableSources = useMemo(
    () => (context?.sources ?? []).filter((source) => source.enabled && source.exists && source.writable),
    [context?.sources],
  );
  const activeImportSourceId = (writableSources.some((source) => source.id === importTargetSourceId) && importTargetSourceId) ||
    writableSources.find((source) => source.import_target)?.id || writableSources[0]?.id || "";

  useEffect(() => {
    if (activeImportSourceId && activeImportSourceId !== importTargetSourceId) {
      setImportTargetSourceId(activeImportSourceId);
    }
  }, [activeImportSourceId, importTargetSourceId]);

  useEffect(() => {
    const handleResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    writeStorageItem(GALLERY_VIEW_MODE_STORAGE_KEY, galleryViewMode);
  }, [galleryViewMode]);
  useEffect(() => {
    writeStorageItem(MOBILE_DENSITY_STORAGE_KEY, mobileDensity);
  }, [mobileDensity]);

  const closeContextMenus = useCallback(() => {
    setContextMenu(null);
    setTrashContextMenu(null);
  }, []);
  useDismissableLayer(Boolean(contextMenu || trashContextMenu), closeContextMenus, {
    closeOnContextMenu: true,
    closeOnScroll: true,
  });

  useEffect(() => {
    if (!showFiltersMenu) {
      return;
    }

    const closeMenu = () => setShowFiltersMenu(false);
    window.addEventListener("click", closeMenu);
    window.addEventListener("resize", closeMenu);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("resize", closeMenu);
    };
  }, [showFiltersMenu]);

  useEffect(() => {
    onSelectionModeActiveChange?.(inspectorSelectionActive);
  }, [inspectorSelectionActive, onSelectionModeActiveChange]);

  useEffect(() => {
    if (dualFolderMode) return; // Each pane reports its own selection.
    if (
      selectedImagePaths.length === pageSelectedPaths.length &&
      selectedImagePaths.every((path) => pageSelectedPaths.includes(path))
    ) {
      return;
    }
    onSelectionChange(pageSelectedPaths);
  }, [dualFolderMode, onSelectionChange, pageSelectedPaths, selectedImagePaths]);

  useEffect(() => {
    if (selectionEnabled) {
      return;
    }
    setSelectionBox(null);
    isDraggingSelectionRef.current = false;
    selectionBoxBasePathsRef.current = [];
    selectionBoxAccumulatedPathsRef.current = [];
    selectionBoxCardRectsRef.current = {};
    selectionBoxStartScrollTopRef.current = 0;
    setSelectionFrozenGridWidth(0);
    selectionBoxAppendRef.current = false;
  }, [selectionEnabled]);

  useEffect(() => () => {
    if (selectionDragResetTimerRef.current !== null) {
      window.clearTimeout(selectionDragResetTimerRef.current);
    }
  }, []);

  useEffect(() => {
    const scrollContainer = gridRef.current?.closest(".ue-main-shell") as HTMLElement | null;
    scrollContainerRef.current = scrollContainer;
    setScrollElement(scrollContainer);
    if (!scrollContainer) {
      return;
    }

    const handleScroll = () => {
      setShowBackToTop(scrollContainer.scrollTop > 320);
    };

    handleScroll();
    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollContainer.removeEventListener("scroll", handleScroll);
  }, [dualFolderMode, galleryViewMode, activeImages.length, isTrashView, trashItems.length]);

  useLayoutEffect(() => {
    const gridElement = gridRef.current;
    if (dualFolderMode || !gridElement) {
      setGridWidth(0);
      return;
    }
    if (typeof ResizeObserver === "undefined") {
      setGridWidth(gridElement?.clientWidth ?? 0);
      return;
    }

    const updateMetrics = () => {
      const gridRect = gridElement.getBoundingClientRect();
      setGridWidth(gridRect.width);
    };
    const observer = new ResizeObserver(updateMetrics);
    observer.observe(gridElement);
    updateMetrics();
    return () => observer.disconnect();
  }, [dualFolderMode, galleryViewMode, activeImages.length, isTrashView, trashItems.length]);
  const masonryLayout = useVirtualMasonry({
    images: activeImages,
    requestedColumns: viewportWidth <= 560 ? (mobileDensity === "double" ? 2 : 1) : gridColumns,
    gridWidth: selectionLayoutLocked && selectionFrozenGridWidth > 0 ? selectionFrozenGridWidth : gridWidth,
    viewportWidth,
    scrollElement,
    gap: MASONRY_GAP,
  });
  const effectiveColumns = masonryLayout.columnCount;

  const getEstimatedGridCardRect = useCallback((relativePath: string): RectLike | null => {
    if (isTrashView || galleryViewMode !== "grid") {
      return null;
    }
    const index = imageIndexByPath.get(relativePath);
    if (index === undefined || !gridRef.current) {
      return null;
    }

    const columnCount = Math.max(1, masonryLayout.columnCount);
    const lane = index % columnCount;
    const row = Math.floor(index / columnCount);
    const columnWidth = masonryLayout.columnWidth;
    const cardHeight = estimateMasonryCardHeight(columnWidth);
    const gridRect = gridRef.current.getBoundingClientRect();
    const left = gridRect.left + lane * (columnWidth + MASONRY_GAP);
    const top = gridRect.top + row * (cardHeight + MASONRY_GAP);

    return {
      left,
      right: left + columnWidth,
      top,
      bottom: top + cardHeight,
    };
  }, [galleryViewMode, imageIndexByPath, isTrashView, masonryLayout.columnCount, masonryLayout.columnWidth]);

  useEffect(() => {
    if (!enableImagePrefetch || !activeImages.length || isTrashView || typeof IntersectionObserver === "undefined") {
      return;
    }

    const indexByPath = new Map(activeImages.map((image, index) => [image.relative_path, index]));
    const prefetchSpan = Math.max(effectiveColumns * 2, 6);
    const root = gridRef.current?.closest(".ue-main-shell") as HTMLElement | null;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) {
            return;
          }

          const relativePath = (entry.target as HTMLElement).dataset.imagePath;
          const startIndex = relativePath ? indexByPath.get(relativePath) : undefined;
          if (startIndex === undefined) {
            return;
          }

          const endIndex = Math.min(activeImages.length, startIndex + prefetchSpan);
          for (let index = startIndex; index < endIndex; index += 1) {
            prefetchGalleryImage(activeImages[index]);
          }
          observer.unobserve(entry.target);
        });
      },
      { root, rootMargin: "520px 0px", threshold: 0.01 },
    );

    activeImages.forEach((image) => {
      const element = cardRefs.current[image.relative_path];
      if (!element) {
        return;
      }
      element.dataset.imagePath = image.relative_path;
      observer.observe(element);
    });

    return () => observer.disconnect();
  }, [effectiveColumns, enableImagePrefetch, activeImages, isTrashView]);

  useEffect(() => {
    setSelectionMode(defaultSelectionMode);
    if (!defaultSelectionMode && !isTrashView) {
      onSelectionChange([]);
    }
  }, [defaultSelectionMode, isTrashView, onSelectionChange]);

  const hasDraggedFiles = (event: React.DragEvent<HTMLDivElement>) => {
    const types = Array.from(event.dataTransfer.types ?? []);
    return types.includes("Files") && (event.dataTransfer.files?.length ?? 0) > 0;
  };

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) {
      return;
    }
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) {
      return;
    }
    event.preventDefault();
    dragDepthRef.current -= 1;
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0;
      setDragActive(false);
    }
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    if (!hasDraggedFiles(event)) {
      return;
    }
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length) {
      await onImportFiles(files, activeImportSourceId);
    }
  };

  const setSelection = useCallback((relativePaths: string[]) => {
    const dedupedPaths = dedupeVisibleSelection(relativePaths, visibleSelectionPaths);
    onSelectionChange(dedupedPaths);
  }, [onSelectionChange, visibleSelectionPaths]);

  const toggleSelection = (relativePath: string, preserveAnchor = false) => {
    setSelection(togglePathSelection(pageSelectedPaths, relativePath));
    if (!preserveAnchor) {
      lastSelectedPathRef.current = relativePath;
    }
  };

  const selectRangeTo = (relativePath: string) => {
    const anchorPath = lastSelectedPathRef.current || pageSelectedPaths[pageSelectedPaths.length - 1] || relativePath;
    setSelection(selectPathRange({
      anchorPath,
      targetPath: relativePath,
      selectedPaths: pageSelectedPaths,
      visibleSelectionPaths,
    }));
    lastSelectedPathRef.current = anchorPath;
  };

  const handleImageSelectionClick = (
    relativePath: string,
    event?: Pick<React.MouseEvent, "shiftKey" | "ctrlKey" | "metaKey">,
  ) => {
    if (event?.shiftKey) {
      selectRangeTo(relativePath);
      return;
    }

    if (event?.ctrlKey || event?.metaKey) {
      toggleSelection(relativePath);
      return;
    }

    toggleSelection(relativePath);
  };

  const selectAllVisible = useCallback(() => {
    setSelection(visibleSelectionPaths);
    lastSelectedPathRef.current = visibleSelectionPaths[0] || "";
  }, [setSelection, visibleSelectionPaths]);

  const clearSelection = useCallback(() => {
    onSelectionChange([]);
    lastSelectedPathRef.current = "";
  }, [onSelectionChange]);

  const variantQuery = useMemo(
    () => ({
      search: "",
      category: selectedCategory,
      subfolder: selectedSubfolder,
      boardId: selectedBoardId,
      dateFrom,
      dateTo,
      favoritesOnly,
      colorFamily: selectedColorFamily,
      sortBy,
      sortOrder,
    }),
    [dateFrom, dateTo, favoritesOnly, selectedBoardId, selectedCategory, selectedColorFamily, selectedSubfolder, sortBy, sortOrder],
  );

  const loadVariantGroups = useCallback(
    async (forceRefresh = false) => {
      const requestId=++variantRequest.current;
      setVariantLoading(true);
      setVariantError("");
      try {
        const response = await galleryApi.listVariantGroups({
          ...variantQuery,
          type: variantType,
          limit: 120,
          forceRefresh,
        });
        if(requestId!==variantRequest.current)return;
        setVariantGroups(response.groups);
        setVariantStatus(response.fingerprint_status);
      } catch (error) {
        if(requestId===variantRequest.current)setVariantError(error instanceof Error ? error.message : t("variantEmptyText"));
      } finally {
        if(requestId===variantRequest.current)setVariantLoading(false);
      }
    },
    [t, variantQuery, variantType],
  );

  const openVariantGroup = useCallback(
    async (group: VariantGroup, nextPage = 1) => {
      const requestId=++variantRequest.current;
      setVariantLoading(true);
      setVariantImages([]);
      clearSelection();
      setVariantError("");
      try {
        const response = await galleryApi.getVariantGroupImages({
          ...variantQuery,
          groupId: group.id,
          type: group.type,
          page: nextPage,
          limit: 60,
        });
        if(requestId!==variantRequest.current)return;
        setSelectedVariantGroup(response.group ?? group);
        setVariantImages(response.images);
        setVariantTotal(response.total);
        setVariantPage(response.page);
        clearSelection();
      } catch (error) {
        if(requestId===variantRequest.current)setVariantError(error instanceof Error ? error.message : t("variantEmptyText"));
      } finally {
        if(requestId===variantRequest.current)setVariantLoading(false);
      }
    },
    [clearSelection, t, variantQuery],
  );

  useEffect(() => {
    if (!variantMode || selectedVariantGroup || isTrashView) {
      return;
    }
    void loadVariantGroups();
  }, [isTrashView, loadVariantGroups, selectedVariantGroup, variantMode]);

  useEffect(() => {
    if (!variantMode) {
      variantRequest.current++;
      setVariantLoading(false);
      setSelectedVariantGroup(null);
      setVariantImages([]);
      return;
    }
    setSelectedVariantGroup(null);
    setVariantImages([]);
    clearSelection();
    if (!isTrashView) {
      void loadVariantGroups();
    }
  }, [clearSelection, isTrashView, loadVariantGroups, variantMode, variantQuery, variantType]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (document.querySelector('[aria-modal="true"]') || isEditableTarget(event.target)) {
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        event.preventDefault();
        selectAllVisible();
      }
      if (event.key === "Escape" && selectedImagePaths.length) {
        event.preventDefault();
        clearSelection();
      }
      if (event.key === "Enter" && selectionMode && selectedImagePaths.length && !isTrashView) {
        const targetPath =
          lastSelectedPathRef.current && selectedImagePaths.includes(lastSelectedPathRef.current)
            ? lastSelectedPathRef.current
            : selectedImagePaths[selectedImagePaths.length - 1];
        const targetImage = activeImages.find((image) => image.relative_path === targetPath);
        if (targetImage) {
          event.preventDefault();
          openActiveDetail(targetImage);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeImages, clearSelection, isTrashView, openActiveDetail, selectedImagePaths, selectAllVisible, selectionMode]);

  const handleBatchDelete = async () => {
    if (!hasSelection) {
      return;
    }

    const approved = await confirm({
      title: t("bulkDelete"),
      message:
        selectedCount >= 20
          ? t("bulkDeleteHeavyConfirm", { count: selectedCount })
          : t("bulkDeleteConfirm", { count: selectedCount }),
      tone: selectedCount >= 20 ? "danger" : "warning",
      confirmLabel: t("commonDelete"),
      cancelLabel: t("libraryCancel"),
    });
    if (!approved) {
      return;
    }

    try {
      await runOperation(() => onDeleteImages(pageSelectedPaths), {
        pending: t("operationDeleteImages"),
        success: (result) => t("operationDeleteImagesResult", {
          count: result.deleted.length,
          missing: getDeleteOutcome(pageSelectedPaths, result).failedPaths.length,
        }),
        successTone: (result) => getDeleteOutcome(pageSelectedPaths, result).complete ? "success" : "error",
        successDetail: (result) => {
          const { failedPaths } = getDeleteOutcome(pageSelectedPaths, result);
          return failedPaths.length ? t("operationUnprocessedPaths", { target: describeFailedPaths(failedPaths) }) : "";
        },
        error: (error) => (error instanceof Error ? error.message : t("imageDeleteError")),
      });
      // The data hook removes only confirmed deletions; failures stay selected.
    } catch {
      // runOperation already displayed the failure; do not clear the selection.
    }
  };

  const handleAddToBoard = async (boardId: string) => {
    if (!boardPickerPaths.length) {
      return;
    }
    const board = boards.find((item) => item.id === boardId);
    const approved = await confirm({
      title: t("bulkAddToBoard"),
      message: t("bulkAddToBoardConfirm", {
        count: boardPickerPaths.length,
        target: board?.name || boardId,
      }),
      tone: "warning",
      confirmLabel: t("boardAddToAction"),
      cancelLabel: t("libraryCancel"),
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

  const handleTogglePin = async (image: ImageRecord) => {
    const nextPinned = !image.pinned;
    const approved = await confirm({
      title: nextPinned ? t("galleryPin") : t("galleryUnpin"),
      message: nextPinned
        ? t("imagePinConfirm", { name: image.filename })
        : t("imageUnpinConfirm", { name: image.filename }),
      tone: "warning",
      confirmLabel: nextPinned ? t("galleryPin") : t("galleryUnpin"),
      cancelLabel: t("libraryCancel"),
    });
    if (!approved) {
      return;
    }
    await onUpdateImageState(image.relative_path, { pinned: nextPinned });
  };

  const handleUpdateImageStateWithConfirm = async (relativePath: string, updates: Record<string, unknown>) => {
    if (
      Object.keys(updates).length === 1 &&
      typeof updates.pinned === "boolean"
    ) {
      const image = activeImages.find((item) => item.relative_path === relativePath);
      if (image) {
        await handleTogglePin(image);
        return;
      }
    }
    await onUpdateImageState(relativePath, updates);
  };

  const handleDeleteSelectedBoard = async () => {
    if (!selectedBoard) {
      return;
    }
    const approved = await confirm({
      title: t("boardDeleteTitle"),
      message: t("boardDeleteConfirm", { name: selectedBoard.name }),
      tone: "warning",
      confirmLabel: t("commonDelete"),
      cancelLabel: t("libraryCancel"),
    });
    if (!approved) {
      return;
    }
    await runOperation(() => onDeleteBoard(selectedBoard.id), {
      pending: t("operationDeleteBoard"),
      success: t("boardDeleteSuccess"),
    });
    onBoardChange("");
  };

  const handleRestoreSelectedTrash = async () => {
    if (!selectedTrashItems.length) {
      return;
    }

    const approved = await confirm({
      title: t("trashRestoreSelected"),
      message: t("trashRestoreSelectedConfirm", { count: selectedTrashItems.length }),
      tone: "warning",
      confirmLabel: t("trashRestore"),
      cancelLabel: t("libraryCancel"),
    });
    if (!approved) {
      return;
    }

    await onRestoreTrashItems(selectedTrashItems.map((item) => item.id));
    clearSelection();
  };

  const handlePurgeSelectedTrash = async () => {
    if (!selectedTrashItems.length) {
      return;
    }

    const approved = await confirm({
      title: t("trashDeleteSelectedForever"),
      message: t("trashDeleteSelectedConfirm", { count: selectedTrashItems.length }),
      tone: "danger",
      confirmLabel: t("trashDeleteForever"),
      cancelLabel: t("libraryCancel"),
    });
    if (!approved) {
      return;
    }

    await onPurgeTrashItems(selectedTrashItems.map((item) => item.id));
    clearSelection();
  };

  const changePage = (nextPage: number) => {
    if (nextPage === page) return;
    onPageChange(nextPage);
    const viewport = scrollContainerRef.current || galleryWorkspaceRef.current?.closest<HTMLElement>(".ue-main-shell");
    viewport?.scrollTo?.({ top: 0, behavior: "instant" });
  };

  const handlePageJump = (formData: FormData) => {
    const requestedPage = Number(formData.get("page"));
    if (!Number.isFinite(requestedPage)) {
      return;
    }

    const nextPage = Math.min(Math.max(1, Math.trunc(requestedPage)), totalPages);
    changePage(nextPage);
  };

  const getAbsoluteImageUrl = (image: ImageRecord) =>
    new URL(image.original_url || image.url, window.location.origin).toString();

  const updateSelectionFromBox = useCallback((box: SelectionBoxState) => {
    const selectionKeys = isTrashView
      ? trashItems.map((item) => ({ key: item.id }))
      : activeImages.map((image) => ({ key: image.relative_path }));
    const scrollDelta = (scrollContainerRef.current?.scrollTop ?? 0) - selectionBoxStartScrollTopRef.current;

    const intersectedPaths = getIntersectingSelectionKeys({
      selectionBox: box,
      keys: selectionKeys.map((item) => item.key),
      scrollDelta,
      getRect: (key) =>
        selectionBoxCardRectsRef.current[key] ??
        cardRefs.current[key]?.getBoundingClientRect() ??
        getEstimatedGridCardRect(key),
    });

    setSelectionBox(current=>current && current.scrollDelta !== scrollDelta ? {...current,scrollDelta} : current);
    setSelection(selectionBoxAppendRef.current
      ? dedupeVisibleSelection([...selectionBoxBasePathsRef.current,...intersectedPaths],visibleSelectionPaths)
      : intersectedPaths);

  }, [activeImages, getEstimatedGridCardRect, isTrashView, setSelection, trashItems, visibleSelectionPaths]);

  const handleSelectionPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!selectionEnabled || event.button !== 0 || event.pointerType === "touch") {
      return;
    }

    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, textarea, a, label, .ue-filter-bar")) {
      return;
    }

    isDraggingSelectionRef.current = false;
    if (selectionDragResetTimerRef.current !== null) {
      window.clearTimeout(selectionDragResetTimerRef.current);
      selectionDragResetTimerRef.current = null;
    }
    selectionBoxBasePathsRef.current = pageSelectedPaths;
    selectionBoxAccumulatedPathsRef.current = [];
    selectionBoxCardRectsRef.current = Object.fromEntries(
      visibleSelectionPaths
        .map((path) => {
          const rect = cardRefs.current[path]?.getBoundingClientRect() ?? getEstimatedGridCardRect(path);
          return rect ? [path, rect] : null;
        })
        .filter((entry): entry is [string, RectLike] => entry !== null),
    );
    setSelectionFrozenGridWidth(gridRef.current?.getBoundingClientRect().width || gridWidth);
    selectionBoxStartScrollTopRef.current = scrollContainerRef.current?.scrollTop ?? 0;
    selectionBoxAppendRef.current = event.ctrlKey || event.metaKey;
    setSelectionBox({
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
    });
  }, [getEstimatedGridCardRect, gridWidth, pageSelectedPaths, selectionEnabled, visibleSelectionPaths]);

  const handleSelectionPointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (!selectionEnabled || !selectionBox) {
      return;
    }

    const bounds=scrollContainerRef.current?.getBoundingClientRect();
    const nextBox = {
      ...selectionBox,
      currentX: bounds && bounds.width > 0 ? Math.max(bounds.left,Math.min(event.clientX,bounds.right)) : event.clientX,
      currentY: bounds && bounds.height > 0 ? Math.max(Math.max(60,bounds.top),Math.min(event.clientY,Math.min(window.innerHeight,bounds.bottom))) : event.clientY,
    };
    const shouldStartDrag =
      Math.abs(nextBox.currentX - nextBox.startX) > 6 ||
      Math.abs(nextBox.currentY - nextBox.startY) > 6;

    if (shouldStartDrag && !isDraggingSelectionRef.current) {
      isDraggingSelectionRef.current = true;
      scrollContainerRef.current?.setPointerCapture?.(event.pointerId);

    }
    setSelectionBox(nextBox);
    if (isDraggingSelectionRef.current) {
      updateSelectionFromBox(nextBox);
    }
  }, [selectionBox, selectionEnabled, updateSelectionFromBox]);

  const handleSelectionPointerEnd = useCallback((event?: React.PointerEvent<HTMLElement>) => {
    if (!selectionBox) {
      return;
    }

    if (
      typeof event?.currentTarget.hasPointerCapture === "function" &&
      typeof event.currentTarget.releasePointerCapture === "function" &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    ) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (!isDraggingSelectionRef.current) {
      setSelectionBox(null);
      selectionBoxBasePathsRef.current = [];
      selectionBoxAccumulatedPathsRef.current = [];
      selectionBoxCardRectsRef.current = {};
      selectionBoxStartScrollTopRef.current = 0;
      setSelectionFrozenGridWidth(0);
      selectionBoxAppendRef.current = false;
      return;
    }

    setSelectionBox(null);
    selectionBoxBasePathsRef.current = [];
    selectionBoxAccumulatedPathsRef.current = [];
    selectionBoxCardRectsRef.current = {};
    selectionBoxStartScrollTopRef.current = 0;
    setSelectionFrozenGridWidth(0);
    selectionBoxAppendRef.current = false;
    selectionDragResetTimerRef.current = window.setTimeout(() => {
      isDraggingSelectionRef.current = false;
      selectionDragResetTimerRef.current = null;
    }, 160);
  }, [selectionBox]);

  useEffect(() => {
    if (!scrollElement || !selectionBox) {
      return;
    }

    let frame = 0;
    const handleSelectionScroll = () => {
      if (!isDraggingSelectionRef.current) {
        return;
      }
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        updateSelectionFromBox(selectionBox);
      });
    };

    scrollElement.addEventListener("scroll", handleSelectionScroll, { passive: true });
    return () => {
      if (frame) {
        window.cancelAnimationFrame(frame);
      }
      scrollElement.removeEventListener("scroll", handleSelectionScroll);
    };
  }, [scrollElement, selectionBox, updateSelectionFromBox]);

  useEffect(() => {
    if (!scrollElement || !selectionBox) {
      return;
    }

    let frame = 0;
    const tick = () => {
      frame = window.requestAnimationFrame(tick);
      if (!isDraggingSelectionRef.current) {
        return;
      }

      const bounds = scrollElement.getBoundingClientRect();
      const rect = {top:Math.max(60,bounds.top),bottom:Math.min(window.innerHeight,bounds.bottom)};
      const maxScroll = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight);
      if (maxScroll <= 0) {
        return;
      }

      let delta = 0;
      if (selectionBox.currentY > rect.bottom - SELECTION_AUTO_SCROLL_EDGE_PX) {
        const distanceIntoEdge = SELECTION_AUTO_SCROLL_EDGE_PX - (rect.bottom - selectionBox.currentY);
        delta = Math.ceil(Math.min(1, distanceIntoEdge / SELECTION_AUTO_SCROLL_EDGE_PX) * SELECTION_AUTO_SCROLL_MAX_STEP_PX);
      } else if (selectionBox.currentY < rect.top + SELECTION_AUTO_SCROLL_EDGE_PX) {
        const distanceIntoEdge = SELECTION_AUTO_SCROLL_EDGE_PX - (selectionBox.currentY - rect.top);
        delta = -Math.ceil(Math.min(1, distanceIntoEdge / SELECTION_AUTO_SCROLL_EDGE_PX) * SELECTION_AUTO_SCROLL_MAX_STEP_PX);
      }

      if (delta === 0) {
        return;
      }

      const nextScrollTop = Math.min(maxScroll, Math.max(0, scrollElement.scrollTop + delta));
      if (nextScrollTop === scrollElement.scrollTop) {
        return;
      }
      scrollElement.scrollTop = nextScrollTop;
      updateSelectionFromBox(selectionBox);
    };

    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [scrollElement, selectionBox, updateSelectionFromBox]);

  useEffect(() => {
    if (!selectionEnabled || !scrollElement) {
      return;
    }

    const handleMainPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Node && galleryWorkspaceRef.current?.contains(target)) {
        return;
      }
      handleSelectionPointerDown(event as unknown as React.PointerEvent<HTMLElement>);
    };

    const handleMainPointerMove = (event: PointerEvent) => {
      handleSelectionPointerMove(event as unknown as React.PointerEvent<HTMLElement>);
    };

    const handleMainPointerEnd = (event: PointerEvent) => {
      handleSelectionPointerEnd(event as unknown as React.PointerEvent<HTMLElement>);
    };

    const cancel = () => {
      isDraggingSelectionRef.current=false;
      setSelectionBox(null);
      setSelectionFrozenGridWidth(0);
      selectionBoxCardRectsRef.current={};
      selectionBoxBasePathsRef.current=[];
      selectionBoxAccumulatedPathsRef.current=[];
      selectionBoxAppendRef.current=false;
    };
    const escape = (event:KeyboardEvent) => {if(event.key === "Escape")cancel();};
    window.addEventListener("blur",cancel);
    window.addEventListener("resize",cancel);
    window.addEventListener("keydown",escape,true);
    scrollElement.addEventListener("lostpointercapture",cancel);
    scrollElement.addEventListener("pointerdown", handleMainPointerDown);
    scrollElement.addEventListener("pointermove", handleMainPointerMove);
    scrollElement.addEventListener("pointerup", handleMainPointerEnd);
    scrollElement.addEventListener("pointercancel", handleMainPointerEnd);

    return () => {
      window.removeEventListener("blur",cancel);
      window.removeEventListener("resize",cancel);
      window.removeEventListener("keydown",escape,true);
      scrollElement.removeEventListener("lostpointercapture",cancel);
      scrollElement.removeEventListener("pointerdown", handleMainPointerDown);
      scrollElement.removeEventListener("pointermove", handleMainPointerMove);
      scrollElement.removeEventListener("pointerup", handleMainPointerEnd);
      scrollElement.removeEventListener("pointercancel", handleMainPointerEnd);
    };
  }, [handleSelectionPointerDown, handleSelectionPointerEnd, handleSelectionPointerMove, scrollElement, selectionEnabled]);

  const copyText = async (value: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(value);
      pushToast(successMessage, "success");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t("contextCopyError"), "error");
    }
  };

  const copyImageFile = async (image: ImageRecord) => {
    try {
      if (!("clipboard" in navigator) || typeof ClipboardItem === "undefined") {
        await copyText(getAbsoluteImageUrl(image), t("contextCopyImageLinkSuccess"));
        return;
      }

      const response = await fetch(getAbsoluteImageUrl(image));
      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) {
        throw new Error(t("contextCopyImageError"));
      }

      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      pushToast(t("contextCopyImageSuccess"), "success");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t("contextCopyImageError"), "error");
    }
  };

  const copyPositivePrompt = async (image: ImageRecord) => {
    try {
      const metadata = await galleryApi.getImageMetadata(image.relative_path);
      const prompt = getPositivePromptText(metadata);
      if (!prompt) {
        pushToast(t("metadataNoPositivePrompt"), "info");
        return;
      }
      await copyText(prompt, t("metadataCopyPositiveSuccess"));
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t("metadataLoadError"), "error");
    }
  };

  const handleContextDelete = async (image: ImageRecord) => {
    const approved = await confirm({
      title: t("modalDeleteFile"),
      message: t("imageDeleteConfirm", { name: image.filename }),
      tone: "warning",
      confirmLabel: t("commonDelete"),
      cancelLabel: t("libraryCancel"),
    });
    if (!approved) {
      return;
    }

    await runOperation(() => onDeleteImages([image.relative_path]), {
      pending: t("operationDeleteImage"),
      success: (result) => getDeleteOutcome([image.relative_path], result).complete ? t("imageDelete") : t("imageDeleteMissing"),
      successTone: (result) => getDeleteOutcome([image.relative_path], result).complete ? "success" : "error",
      error: (error) => (error instanceof Error ? error.message : t("imageDeleteError")),
    }).catch(() => undefined);
  };

  const handleOpenContextMenu = (event: React.MouseEvent, image: ImageRecord) => {
    event.preventDefault();
    event.stopPropagation();

    const position = placeMenuForEvent(event, { width: 292, height: 356 }, "pointer");
    setContextMenu({
      image,
      x: position.x,
      y: position.y,
    });
  };

  const handleTrashContextMenu = (event: React.MouseEvent, item: TrashItem) => {
    event.preventDefault();
    event.stopPropagation();

    const position = placeMenuForEvent(event, { width: 220, height: 220 }, "pointer");
    setTrashContextMenu({
      item,
      x: position.x,
      y: position.y,
    });
  };

  const handleScrollToTop = () => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: preferredScrollBehavior() });
  };

  const resetEmptyFilters = () => {
    onSearchChange?.("");
    onCategoryChange("");
    onColorFamilyChange("");
    onDateFromChange("");
    onDateToChange("");
    onFavoritesOnlyChange(false);
    changePage(1);
  };
  const scopeSourceId = selectedSubfolder ? parseFolderRef(selectedSubfolder).sourceId : "";
  const configuredSources = (context?.sources ?? []).filter((source) => source.enabled && source.exists);
  const sourceConfigured = scopeSourceId
    ? configuredSources.some((source) => source.id === scopeSourceId)
    : configuredSources.length > 0;
  const activeSearchFilters = Boolean(searchValue?.trim() || selectedCategory || selectedColorFamily || dateFrom || dateTo || favoritesOnly);
  const emptyState = error ? {
    title: t("galleryEmptyErrorTitle"), description: error,
    actionLabel: t("navRefresh"), onAction: onApplyPendingLiveRefresh,
  } : !sourceConfigured ? {
    title: t("galleryEmptyNoSourceTitle"), description: t("galleryEmptyNoSourceText"),
    actionLabel: onOpenSettings ? t("navSettings") : undefined, onAction: onOpenSettings,
  } : activeSearchFilters ? {
    title: t("galleryEmptyFilteredTitle"), description: t("galleryEmptyFilteredText"),
    actionLabel: t("filterReset"), onAction: resetEmptyFilters,
  } : {
    title: t("galleryEmptySourceTitle"), description: t("galleryEmptySourceText"),
  };

  return (
    <div
      className={`ue-drop-shell ${dragActive ? "is-dragging" : ""}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <section
        ref={galleryWorkspaceRef}
        className="ue-workspace ue-workspace--gallery ue-animate-in"
        onPointerDown={handleSelectionPointerDown}
        onPointerMove={handleSelectionPointerMove}
        onPointerUp={handleSelectionPointerEnd}
        onPointerCancel={handleSelectionPointerEnd}
      >
        <GalleryToolbar
          isTrashView={isTrashView}
          selectedBoard={selectedBoard}
          selectedSubfolder={selectedSubfolder}
          total={total}
          trashCount={trashItems.length}
          favoritesOnly={favoritesOnly}
          isRefreshing={isRefreshing}
          hasPendingLiveRefresh={hasPendingLiveRefresh}
          activeFilterControlCount={activeFilterControlCount}
          showFiltersMenu={showFiltersMenu}
          showColumnsMenu={showColumnsMenu}
          galleryViewMode={galleryViewMode}
          gridColumns={gridColumns}
          effectiveColumns={effectiveColumns}
          isMobile={viewportWidth <= 560}
          mobileDensity={mobileDensity}
          onMobileDensityChange={setMobileDensity}
          dualFolderMode={dualFolderMode}
          variantMode={variantMode}
          selectionMode={selectionMode}
          writableSources={writableSources}
          sources={context?.sources ?? []}
          importSubfolder={context?.import_image_subfolder || "universal_gallery_imports"}
          activeImportSourceId={activeImportSourceId}
          categories={context?.categories ?? []}
          selectedCategory={selectedCategory}
          dateFrom={dateFrom}
          dateTo={dateTo}
          selectedColorFamily={selectedColorFamily}
          colorIndexStatus={colorIndexStatus}
          sortBy={sortBy}
          sortOrder={sortOrder}
          searchValue={searchValue}
          onSearchChange={onSearchChange}
          onApplyPendingLiveRefresh={onApplyPendingLiveRefresh}
          onToggleFiltersMenu={() => setShowFiltersMenu((current) => !current)}
          onCloseFiltersMenu={() => setShowFiltersMenu(false)}
          onToggleColumnsMenu={() => setShowColumnsMenu((current) => !current)}
          onCloseColumnsMenu={() => setShowColumnsMenu(false)}
          onOpenCategoryPicker={() => setShowCategoryPicker(true)}
          onGalleryViewModeChange={setGalleryViewMode}
          onGridColumnsChange={onGridColumnsChange}
          onDualFolderModeChange={setDualFolderMode}
          onVariantModeChange={setVariantMode}
          onSelectionModeChange={setSelectionMode}
          onImportTargetSourceIdChange={setImportTargetSourceId}
          onShareBoard={setShareBoardId}
          onDeleteBoard={() => void handleDeleteSelectedBoard()}
          onClearSelection={clearSelection}
          onCategoryChange={onCategoryChange}
          onDateFromChange={onDateFromChange}
          onDateToChange={onDateToChange}
          onFavoritesOnlyChange={onFavoritesOnlyChange}
          onColorFamilyChange={onColorFamilyChange}
          onSortByChange={onSortByChange}
          onSortOrderChange={onSortOrderChange}
          onPageChange={changePage}
        />

        {importMessage ? (
          <div className="ue-inline-success" role="status">
            <span>{importMessage}</span>
            {importFolderRef && onOpenImportFolder ? (
              <button type="button" className="ue-secondary-action" onClick={() => {
                setDualFolderMode(false);
                setVariantMode(false);
                clearSelection();
                onOpenImportFolder(importFolderRef);
              }}>{t("galleryOpenImportFolder")}</button>
            ) : null}
          </div>
        ) : null}
        {error && (images.length > 0 || isTrashView || dualFolderMode || variantMode) ? <div className="ue-inline-error">{error}</div> : null}

        <Suspense fallback={<div className="ue-gallery-state"><div className="ue-loading-orb" /><p>{t("galleryLoading")}</p></div>}>
        {dualFolderMode && !isTrashView ? (
          <DualFolderWorkspace
            onExit={()=>{setDualFolderMode(false);clearSelection();}}
            context={context}
            initialFolder={selectedSubfolder}
            sortBy={sortBy}
            sortOrder={sortOrder}
            boards={boards}
            onOpenDetail={onOpenDetail}
            onSelectionChange={onSelectionChange}
            onVisibleImagesChange={onVisibleImagesChange}
            inspectorClearSignal={inspectorClearSignal}
            onOpenWorkflow={onOpenWorkflow}
            onMoveImages={onMoveImages}
            onDeleteImages={onDeleteImages}
            onUpdateImageState={handleUpdateImageStateWithConfirm}
            onCreateBoard={onCreateBoard}
            onUpdateBoardPins={onUpdateBoardPins}
          />
        ) : variantMode && !isTrashView && !selectedVariantGroup ? (
          <VariantGroupsView
            onExit={()=>{setVariantMode(false);clearSelection();}}
            groups={variantGroups}
            selectedType={variantType}
            status={variantStatus}
            loading={variantLoading}
            error={variantError}
            onTypeChange={setVariantType}
            onRefresh={() => void loadVariantGroups(true)}
            onOpenGroup={(group) => void openVariantGroup(group)}
          />
        ) : variantMode && !isTrashView && selectedVariantGroup ? (
          <>
            <div className="ue-variant-detail-head">
              <button
                className="ue-secondary-action"
                type="button"
                onClick={() => {
                  setSelectedVariantGroup(null);
                  setVariantImages([]);
                  clearSelection();
                  void loadVariantGroups();
                }}
              >
                <ChevronUp size={15} />
                <span>{t("variantBackToGroups")}</span>
              </button>
              <div>
                <span>{t(`variantType_${selectedVariantGroup.type}`)}</span>
                <strong>{selectedVariantGroup.title}</strong>
              </div>
              <button
                className="ue-secondary-action"
                type="button"
                onClick={() => {
                  const keep = variantImages[0]?.relative_path;
                  onSelectionChange(variantImages.map((image) => image.relative_path).filter((path) => path !== keep));
                  setSelectionMode(true);
                }}
              >
                <CheckSquare size={15} />
                <span>{t("variantSelectRest")}</span>
              </button>
            </div>
            {variantLoading && variantImages.length === 0 ? (
              <div className="ue-gallery-state">
                <div className="ue-loading-orb" />
                <p>{t("variantAnalyzing")}</p>
              </div>
            ) : (
              <GalleryMainContent
                images={activeImages}
                galleryViewMode={galleryViewMode}
                selectionMode={selectionMode}
                selectionEnabled={selectionEnabled}
                selectionBox={selectionBox}
                pageSelectedPaths={pageSelectedPaths}
                page={activePage}
                totalPages={activeTotalPages}
                total={activeTotal}
                effectiveColumns={effectiveColumns}
                masonryLayout={masonryLayout}
                gridRef={gridRef}
                cardRefs={cardRefs}
                isDraggingSelectionRef={isDraggingSelectionRef}
                onOpenDetail={openActiveDetail}
                onOpenWorkflow={onOpenWorkflow}
                onUpdateImageState={handleUpdateImageStateWithConfirm}
                onBoardPickerPathsChange={setBoardPickerPaths}
                onImageSelectionClick={handleImageSelectionClick}
                onOpenContextMenu={handleOpenContextMenu}
                onSelectAllVisible={selectAllVisible}
                onPageChange={(nextPage) => void openVariantGroup(selectedVariantGroup, nextPage)}
                onPageJump={(formData) => {
                  const value = Number(formData.get("page") || 1);
                  void openVariantGroup(selectedVariantGroup, Number.isFinite(value) ? value : 1);
                }}
              />
            )}
          </>
        ) : isLoading && images.length === 0 ? (
          <div className="ue-gallery-state">
            <div className="ue-loading-orb" />
            <p>{t("galleryLoading")}</p>
          </div>
        ) : isTrashView ? (
          <TrashWorkspaceView
            trashItems={trashItems}
            selectedCount={selectedCount}
            selectedTrashCount={selectedTrashItems.length}
            hasSelection={hasSelection}
            pageSelectedPaths={pageSelectedPaths}
            galleryViewMode={galleryViewMode}
            selectionEnabled={selectionEnabled}
            selectionBox={selectionBox}
            isDraggingSelectionRef={isDraggingSelectionRef}
            cardRefs={cardRefs}
            gridRef={gridRef}
            onSelectAllVisible={selectAllVisible}
            onClearSelection={clearSelection}
            onRestoreSelectedTrash={() => void handleRestoreSelectedTrash()}
            onPurgeSelectedTrash={() => void handlePurgeSelectedTrash()}
            onRestoreTrashItem={(id) => void onRestoreTrashItem(id)}
            onPurgeTrashItem={(id) => void onPurgeTrashItem(id)}
            onTrashContextMenu={handleTrashContextMenu}
            onImageSelectionClick={handleImageSelectionClick}
            onSelectionPointerDown={handleSelectionPointerDown}
            onSelectionPointerMove={handleSelectionPointerMove}
            onSelectionPointerEnd={handleSelectionPointerEnd}
          />
        ) : (
          <GalleryMainContent
            images={activeImages}
            emptyState={emptyState}
            galleryViewMode={galleryViewMode}
            selectionMode={selectionMode}
            selectionEnabled={selectionEnabled}
            selectionBox={selectionBox}
            pageSelectedPaths={pageSelectedPaths}
            page={activePage}
            totalPages={activeTotalPages}
            total={activeTotal}
            effectiveColumns={effectiveColumns}
            masonryLayout={masonryLayout}
            gridRef={gridRef}
            cardRefs={cardRefs}
            isDraggingSelectionRef={isDraggingSelectionRef}
            onOpenDetail={openActiveDetail}
            onOpenWorkflow={onOpenWorkflow}
            onUpdateImageState={handleUpdateImageStateWithConfirm}
            onBoardPickerPathsChange={setBoardPickerPaths}
            onImageSelectionClick={handleImageSelectionClick}
            onOpenContextMenu={handleOpenContextMenu}
            onSelectAllVisible={selectAllVisible}
            onPageChange={changePage}
            onPageJump={handlePageJump}
          />
        )}
        </Suspense>

      </section>

      {dragActive ? (
        <div className="ue-drop-overlay">
          <div className="ue-drop-overlay-card">
            <h3>{t("galleryDropTitle")}</h3>
            <p>{t("galleryDropText")}</p>
          </div>
        </div>
      ) : null}

      <CategoryPickerModal
        open={showCategoryPicker}
        categories={context?.categories ?? []}
        selectedCategory={selectedCategory}
        onClose={() => setShowCategoryPicker(false)}
        onSelect={(category) => {
          onCategoryChange(category);
          changePage(1);
        }}
      />

      <BoardPickerModal
        open={boardPickerPaths.length > 0}
        boards={boards}
        selectedCount={boardPickerPaths.length}
        onClose={() => setBoardPickerPaths([])}
        onCreateBoard={onCreateBoard}
        onAddToBoard={handleAddToBoard}
      />

      {shareBoard ? <Suspense fallback={null}>
        <BoardShareModal open board={shareBoard} onClose={() => setShareBoardId("")} />
      </Suspense> : null}

      {contextMenu ? (
        <FloatingLayerPortal>
          <div
            className="ue-context-menu ue-context-menu--gallery"
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <div className="ue-context-menu-head">
              <strong title={contextMenu.image.filename}>{contextMenu.image.filename}</strong>
              <span>{formatFileSize(contextMenu.image.size)}</span>
            </div>
            <div className="ue-context-menu-grid">
              <button
                className="ue-context-menu-item"
                onClick={() => {
                  openActiveDetail(contextMenu.image);
                  setContextMenu(null);
                }}
              >
                <ImageIcon size={14} />
                <span>{t("galleryInspect")}</span>
              </button>
              <button
                className="ue-context-menu-item"
                onClick={() => {
                  handleImageSelectionClick(contextMenu.image.relative_path, { ctrlKey: true, metaKey: false, shiftKey: false });
                  setContextMenu(null);
                }}
              >
                {pageSelectedPaths.includes(contextMenu.image.relative_path) ? <CheckSquare size={14} /> : <Square size={14} />}
                <span>{pageSelectedPaths.includes(contextMenu.image.relative_path) ? t("galleryDeselectImage") : t("gallerySelectImage")}</span>
              </button>
              <button
                className="ue-context-menu-item"
                onClick={() => {
                  void handleTogglePin(contextMenu.image);
                  setContextMenu(null);
                }}
              >
                <Pin size={14} fill={contextMenu.image.pinned ? "currentColor" : "none"} />
                <span>{contextMenu.image.pinned ? t("galleryUnpin") : t("galleryPin")}</span>
              </button>
              <button
                className="ue-context-menu-item"
                onClick={() => {
                  setBoardPickerPaths(
                    pageSelectedPaths.includes(contextMenu.image.relative_path) && pageSelectedPaths.length > 1
                      ? pageSelectedPaths
                      : [contextMenu.image.relative_path],
                  );
                  setContextMenu(null);
                }}
              >
                <FolderPlus size={14} />
                <span>{t("bulkAddToBoard")}</span>
              </button>
            </div>
            <div className="ue-context-menu-section">
              <button
                className="ue-context-menu-item"
                onClick={() => {
                  void onOpenWorkflow(contextMenu.image);
                  setContextMenu(null);
                }}
              >
                <Send size={14} />
                <span>{t("modalOpenWorkflow")}</span>
              </button>
              <button
                className="ue-context-menu-item"
                onClick={() => {
                  void onApplyLoraStack(contextMenu.image);
                  setContextMenu(null);
                }}
              >
                <Layers size={14} />
                <span>{t("loraStackApply")}</span>
              </button>
              <button
                className="ue-context-menu-item"
                onClick={() => {
                  setMetadataViewerImage(contextMenu.image);
                  setContextMenu(null);
                }}
              >
                <FileJson size={14} />
                <span>{t("metadataView")}</span>
              </button>
            </div>
            <div className="ue-context-menu-grid ue-context-menu-grid--copy">
              <button
                className="ue-context-menu-item"
                onClick={() => {
                  void copyPositivePrompt(contextMenu.image);
                  setContextMenu(null);
                }}
              >
                <ClipboardCopy size={14} />
                <span>{t("metadataCopyPositive")}</span>
              </button>
              <button
                className="ue-context-menu-item"
                onClick={() => {
                  void copyImageFile(contextMenu.image);
                  setContextMenu(null);
                }}
              >
                <CheckSquare size={14} />
                <span>{t("contextCopyImage")}</span>
              </button>
              <button
                className="ue-context-menu-item"
                onClick={() => {
                  void copyText(contextMenu.image.filename, t("contextCopyFilenameSuccess"));
                  setContextMenu(null);
                }}
              >
                <Tag size={14} />
                <span>{t("contextCopyFilename")}</span>
              </button>
              <button
                className="ue-context-menu-item"
                onClick={() => {
                  void copyText(contextMenu.image.relative_path, t("contextCopyPathSuccess"));
                  setContextMenu(null);
                }}
              >
                <FolderIcon size={14} />
                <span>{t("contextCopyPath")}</span>
              </button>
              <button
                className="ue-context-menu-item"
                onClick={() => {
                  window.open(getAbsoluteImageUrl(contextMenu.image), "_blank", "noopener,noreferrer");
                  setContextMenu(null);
                }}
              >
                <ExternalLink size={14} />
                <span>{t("modalOpenFull")}</span>
              </button>
            </div>
            <button
              className="ue-context-menu-item ue-context-menu-item--danger"
              onClick={() => {
                if (pageSelectedPaths.includes(contextMenu.image.relative_path) && pageSelectedPaths.length > 1) {
                  void handleBatchDelete();
                } else {
                  void handleContextDelete(contextMenu.image);
                }
                setContextMenu(null);
              }}
            >
              <Trash2 size={14} />
              <span>{pageSelectedPaths.includes(contextMenu.image.relative_path) && pageSelectedPaths.length > 1 ? t("bulkDelete") : t("commonDelete")}</span>
            </button>
          </div>
        </FloatingLayerPortal>
      ) : null}

      {metadataViewerImage ? (
        <Suspense fallback={null}>
          <MetadataViewerModal image={metadataViewerImage} onClose={() => setMetadataViewerImage(null)} />
        </Suspense>
      ) : null}

      {trashContextMenu ? (
        <FloatingLayerPortal>
          <div
            className="ue-context-menu"
            style={{ top: trashContextMenu.y, left: trashContextMenu.x }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button
              className="ue-context-menu-item"
              onClick={() => {
                handleImageSelectionClick(trashContextMenu.item.id, { ctrlKey: true, metaKey: false, shiftKey: false });
                setTrashContextMenu(null);
              }}
            >
              {pageSelectedPaths.includes(trashContextMenu.item.id) ? <CheckSquare size={14} /> : <Square size={14} />}
              <span>{pageSelectedPaths.includes(trashContextMenu.item.id) ? t("galleryDeselectImage") : t("gallerySelectImage")}</span>
            </button>
            <button
              className="ue-context-menu-item"
              onClick={() => {
                if (pageSelectedPaths.includes(trashContextMenu.item.id) && pageSelectedPaths.length > 1) {
                  void handleRestoreSelectedTrash();
                } else {
                  void onRestoreTrashItem(trashContextMenu.item.id);
                }
                setTrashContextMenu(null);
              }}
            >
              <RotateCcw size={14} />
              <span>{pageSelectedPaths.includes(trashContextMenu.item.id) && pageSelectedPaths.length > 1 ? t("trashRestoreSelected") : t("trashRestore")}</span>
            </button>
            <button
              className="ue-context-menu-item ue-context-menu-item--danger"
              onClick={() => {
                if (pageSelectedPaths.includes(trashContextMenu.item.id) && pageSelectedPaths.length > 1) {
                  void handlePurgeSelectedTrash();
                } else {
                  void onPurgeTrashItem(trashContextMenu.item.id);
                }
                setTrashContextMenu(null);
              }}
            >
              <Trash2 size={14} />
              <span>{pageSelectedPaths.includes(trashContextMenu.item.id) && pageSelectedPaths.length > 1 ? t("trashDeleteSelectedForever") : t("trashDeleteForever")}</span>
            </button>
          </div>
        </FloatingLayerPortal>
      ) : null}

      {showBackToTop ? (
        <button
          className="ue-scrolltop-btn"
          onClick={handleScrollToTop}
          aria-label={t("galleryBackToTop")}
          title={t("galleryBackToTop")}
        >
          <ChevronUp size={18} />
        </button>
      ) : null}
    </div>
  );
};
