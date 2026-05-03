import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarX,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Check,
  CheckSquare,
  ClipboardCopy,
  CornerDownRight,
  Eye,
  ExternalLink,
  FileJson,
  Folder as FolderIcon,
  FolderPlus,
  Image as ImageIcon,
  LayoutGrid,
  List,
  Pin,
  RotateCcw,
  Send,
  Share2,
  SlidersHorizontal,
  Square,
  Tag,
  Trash2,
} from "lucide-react";

import { useI18n } from "../../i18n/I18nProvider";
import { useConfirm } from "../shared/ConfirmDialog";
import { useToast } from "../shared/ToastViewport";
import type { BoardMutationResult, BoardSummary, ColorIndexStatus, GalleryContext, ImageRecord, TrashItem } from "../../types/universal-gallery";
import { formatCompactDate, formatFileSize } from "../../utils/formatters";
import { getPositivePromptText } from "../../utils/metadata";
import { galleryApi } from "../../services/galleryApi";
import { BoardPickerModal } from "./BoardPickerModal";
import { BoardShareModal } from "./BoardShareModal";
import { CategoryPickerModal } from "./CategoryPickerModal";
import { MetadataViewerModal } from "./MetadataViewerModal";

const loadedImageUrls = new Set<string>();
const prefetchedImageUrls = new Set<string>();
const queuedImageUrls = new Set<string>();
const imagePrefetchQueue: string[] = [];
const MAX_IMAGE_PREFETCH_CONCURRENCY = 4;
let activeImagePrefetches = 0;

const getGalleryImageUrl = (image: ImageRecord) => image.thumb_url || image.url;
const MASONRY_GAP = 14;
const MASONRY_OVERSCAN = 900;
const GALLERY_VIEW_MODE_STORAGE_KEY = "universal-extractor:gallery-view-mode";

type ContentViewMode = "grid" | "list";

const COLOR_FILTERS = [
  { value: "red", color: "#dc2626" },
  { value: "orange", color: "#f97316" },
  { value: "yellow", color: "#eab308" },
  { value: "green", color: "#16a34a" },
  { value: "cyan", color: "#06b6d4" },
  { value: "blue", color: "#2563eb" },
  { value: "purple", color: "#7c3aed" },
  { value: "pink", color: "#ec4899" },
  { value: "brown", color: "#92400e" },
  { value: "black", color: "#18181b" },
  { value: "white", color: "#ffffff" },
  { value: "gray", color: "#71717a" },
  { value: "warm", color: "linear-gradient(135deg, #dc2626, #f97316, #eab308)" },
  { value: "cool", color: "linear-gradient(135deg, #16a34a, #06b6d4, #2563eb)" },
  { value: "low_saturation", color: "linear-gradient(135deg, #d4d4d8, #71717a)" },
] as const;

const SORT_OPTIONS = [
  { value: "created_at", labelKey: "gallerySortNewest", hintKey: "gallerySortNewestHint" },
  { value: "filename", labelKey: "gallerySortName", hintKey: "gallerySortNameHint" },
  { value: "size", labelKey: "gallerySortSize", hintKey: "gallerySortSizeHint" },
] as const;

const SORT_ORDER_OPTIONS = [
  { value: "desc", labelKey: "gallerySortDesc", hintKey: "gallerySortDescHint" },
  { value: "asc", labelKey: "gallerySortAsc", hintKey: "gallerySortAscHint" },
] as const;

const getStoredViewMode = (key: string, fallback: ContentViewMode): ContentViewMode => {
  const stored = window.localStorage.getItem(key);
  return stored === "grid" || stored === "list" ? stored : fallback;
};

const pumpImagePrefetchQueue = () => {
  while (activeImagePrefetches < MAX_IMAGE_PREFETCH_CONCURRENCY && imagePrefetchQueue.length) {
    const imageUrl = imagePrefetchQueue.shift();
    if (!imageUrl) {
      continue;
    }

    queuedImageUrls.delete(imageUrl);
    activeImagePrefetches += 1;
    const preloadImage = new Image();
    preloadImage.decoding = "async";
    const finish = (loaded: boolean) => {
      if (loaded) {
        loadedImageUrls.add(imageUrl);
      } else {
        prefetchedImageUrls.delete(imageUrl);
      }
      activeImagePrefetches = Math.max(0, activeImagePrefetches - 1);
      pumpImagePrefetchQueue();
    };

    preloadImage.onload = () => finish(true);
    preloadImage.onerror = () => finish(false);
    preloadImage.src = imageUrl;
  }
};

const prefetchGalleryImage = (image: ImageRecord) => {
  const imageUrl = getGalleryImageUrl(image);
  if (!imageUrl || loadedImageUrls.has(imageUrl) || prefetchedImageUrls.has(imageUrl) || queuedImageUrls.has(imageUrl)) {
    return;
  }

  prefetchedImageUrls.add(imageUrl);
  queuedImageUrls.add(imageUrl);
  imagePrefetchQueue.push(imageUrl);
  pumpImagePrefetchQueue();
};

const GalleryCardImage = ({
  image,
  priority = false,
  onOpenDetail,
}: {
  image: ImageRecord;
  priority?: boolean;
  onOpenDetail: (image: ImageRecord, event: React.MouseEvent<HTMLImageElement>) => void;
}) => {
  const imageUrl = getGalleryImageUrl(image);
  const [loaded, setLoaded] = useState(() => loadedImageUrls.has(imageUrl));

  useEffect(() => {
    setLoaded(loadedImageUrls.has(imageUrl));
  }, [imageUrl]);

  const markLoaded = () => {
    loadedImageUrls.add(imageUrl);
    setLoaded(true);
  };

  return (
    <div className={`ue-gallery-image-shell ${loaded ? "is-loaded" : ""}`}>
      <img
        src={imageUrl}
        alt={image.title || image.filename}
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        onLoad={markLoaded}
        onError={markLoaded}
        onClick={(event) => onOpenDetail(image, event)}
      />
    </div>
  );
};

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
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  boards: BoardSummary[];
  defaultSelectionMode: boolean;
  enableImagePrefetch: boolean;
  onOpenDetail: (image: ImageRecord) => void;
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
  onSelectionChange: (relativePaths: string[]) => void;
  onUpdateImageState: (relativePath: string, updates: Record<string, unknown>) => Promise<void>;
  onCreateBoard: (name: string, description?: string) => Promise<BoardMutationResult>;
  onUpdateBoardPins: (boardId: string, relativePaths: string[], pinned?: boolean) => Promise<unknown>;
  onDeleteBoard: (boardId: string) => Promise<unknown>;
  onDeleteImages: (relativePaths: string[]) => Promise<unknown>;
  onImportFiles: (files: File[], targetSourceId?: string) => Promise<unknown>;
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

const placeFloatingMenu = (clientX: number, clientY: number, width: number, height: number) => {
  const margin = 12;
  const x =
    clientX + width > window.innerWidth - margin
      ? Math.max(margin, clientX - width)
      : Math.max(margin, clientX);
  const y =
    clientY + height > window.innerHeight - margin
      ? Math.max(margin, clientY - height)
      : Math.max(margin, clientY);
  return { x, y };
};

interface SelectionBoxState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
}

interface MasonryItem {
  image: ImageRecord;
  index: number;
  top: number;
  left: number;
  width: number;
  height: number;
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
  isLoading,
  isRefreshing,
  error,
  boards,
  defaultSelectionMode,
  enableImagePrefetch,
  onOpenDetail,
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
  onSelectionChange,
  onUpdateImageState,
  onCreateBoard,
  onUpdateBoardPins,
  onDeleteBoard,
  onDeleteImages,
  onImportFiles,
  onRestoreTrashItem,
  onRestoreTrashItems,
  onPurgeTrashItem,
  onPurgeTrashItems,
}: GalleryWorkspaceProps) => {
  const { t } = useI18n();
  const { confirm } = useConfirm();
  const { pushToast } = useToast();
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
  const [showBackToTop, setShowBackToTop] = useState(false);
  const [gridWidth, setGridWidth] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(() => window.innerHeight);
  const [gridTop, setGridTop] = useState(0);
  const [measuredCardHeights, setMeasuredCardHeights] = useState<Record<string, number>>({});
  const dragDepthRef = useRef(0);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  const isDraggingSelectionRef = useRef(false);
  const lastSelectedPathRef = useRef<string>("");
  const scrollContainerRef = useRef<HTMLElement | null>(null);

  const visibleImagePaths = useMemo(() => images.map((image) => image.relative_path), [images]);
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
  const selectionEnabled = selectionMode || isTrashView;
  const selectedTrashItems = useMemo(
    () => (isTrashView ? trashItems.filter((item) => selectedImagePathSet.has(item.id)) : []),
    [isTrashView, selectedImagePathSet, trashItems],
  );
  const activeFilterCount = [selectedCategory, dateFrom, dateTo, favoritesOnly, selectedColorFamily].filter(Boolean).length;
  const activeFilterControlCount =
    activeFilterCount + (sortBy !== "created_at" || sortOrder !== "desc" ? 1 : 0);
  const selectedColorFilter = COLOR_FILTERS.find((option) => option.value === selectedColorFamily);
  const selectedSortOption = SORT_OPTIONS.find((option) => option.value === sortBy) ?? SORT_OPTIONS[0];
  const selectedSortOrderOption = SORT_ORDER_OPTIONS.find((option) => option.value === sortOrder) ?? SORT_ORDER_OPTIONS[0];
  const getColorFamilyLabel = (value: string) => t(`colorFamily_${value}`);
  const getColorFamilyShortLabel = (value: string) => {
    const label = getColorFamilyLabel(value);
    if (value === "low_saturation") {
      return label.includes(" ") ? label.split(" ")[0] : label;
    }
    if (label.endsWith("色") && label.length <= 3) {
      return label.slice(0, -1);
    }
    return label;
  };
  const activeFilterChips = [
    selectedCategory
      ? {
          key: "category",
          label: selectedCategory,
          onClear: () => {
            onCategoryChange("");
            onPageChange(1);
          },
        }
      : null,
    selectedColorFilter
      ? {
          key: "color",
          label: getColorFamilyLabel(selectedColorFilter.value),
          color: selectedColorFilter.color,
          onClear: () => {
            onColorFamilyChange("");
            onPageChange(1);
          },
        }
      : null,
    dateFrom
      ? {
          key: "dateFrom",
          label: `${t("galleryDateFrom")} ${dateFrom}`,
          onClear: () => {
            onDateFromChange("");
            onPageChange(1);
          },
        }
      : null,
    dateTo
      ? {
          key: "dateTo",
          label: `${t("galleryDateTo")} ${dateTo}`,
          onClear: () => {
            onDateToChange("");
            onPageChange(1);
          },
        }
      : null,
    favoritesOnly
      ? {
          key: "favorites",
          label: t("galleryPinnedOnly"),
          onClear: () => {
            onFavoritesOnlyChange(false);
            onPageChange(1);
          },
        }
      : null,
  ].filter(Boolean) as Array<{ key: string; label: string; color?: string; onClear: () => void }>;
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
  const activeImportSourceId = importTargetSourceId || writableSources.find((source) => source.import_target)?.id || writableSources[0]?.id || "";

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
    window.localStorage.setItem(GALLERY_VIEW_MODE_STORAGE_KEY, galleryViewMode);
  }, [galleryViewMode]);

  useEffect(() => {
    if (!contextMenu && !trashContextMenu) {
      return;
    }

    const closeMenu = () => {
      setContextMenu(null);
      setTrashContextMenu(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closeMenu();
      }
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("contextmenu", closeMenu);
    window.addEventListener("resize", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("contextmenu", closeMenu);
      window.removeEventListener("resize", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu, trashContextMenu]);

  useEffect(() => {
    if (!showColumnsMenu) {
      return;
    }

    const closeMenu = () => setShowColumnsMenu(false);
    window.addEventListener("click", closeMenu);
    window.addEventListener("resize", closeMenu);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("resize", closeMenu);
    };
  }, [showColumnsMenu]);

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
    if (
      selectedImagePaths.length === pageSelectedPaths.length &&
      selectedImagePaths.every((path) => pageSelectedPaths.includes(path))
    ) {
      return;
    }
    onSelectionChange(pageSelectedPaths);
  }, [onSelectionChange, pageSelectedPaths, selectedImagePaths]);

  useEffect(() => {
    if (selectionEnabled) {
      return;
    }
    setSelectionBox(null);
    isDraggingSelectionRef.current = false;
  }, [selectionEnabled]);

  useEffect(() => {
    const scrollContainer = gridRef.current?.closest(".ue-main-shell") as HTMLElement | null;
    scrollContainerRef.current = scrollContainer;
    if (!scrollContainer) {
      return;
    }

    const handleScroll = () => {
      setShowBackToTop(scrollContainer.scrollTop > 320);
      const rootRect = scrollContainer.getBoundingClientRect();
      const gridRect = gridRef.current?.getBoundingClientRect();
      setViewportHeight(scrollContainer.clientHeight);
      setGridTop(gridRect ? gridRect.top - rootRect.top : 0);
    };

    handleScroll();
    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollContainer.removeEventListener("scroll", handleScroll);
  }, [images.length, isTrashView, trashItems.length]);

  const effectiveColumns = useMemo(() => {
    const availableWidth = gridWidth > 0 ? gridWidth : viewportWidth;
    const minCardWidth = availableWidth <= 560 ? 220 : availableWidth <= 960 ? 190 : 180;
    const maxColumnsForWidth = Math.max(1, Math.floor((availableWidth + MASONRY_GAP) / (minCardWidth + MASONRY_GAP)));
    return Math.max(1, Math.min(gridColumns, maxColumnsForWidth));
  }, [gridColumns, gridWidth, viewportWidth]);

  useEffect(() => {
    const gridElement = gridRef.current;
    if (!gridElement || typeof ResizeObserver === "undefined") {
      setGridWidth(gridElement?.clientWidth ?? 0);
      return;
    }

    const updateMetrics = () => {
      const scrollContainer = gridElement.closest(".ue-main-shell") as HTMLElement | null;
      const rootRect = scrollContainer?.getBoundingClientRect();
      const gridRect = gridElement.getBoundingClientRect();
      setGridWidth(gridRect.width);
      setViewportHeight(scrollContainer?.clientHeight ?? window.innerHeight);
      setGridTop(rootRect ? gridRect.top - rootRect.top : gridRect.top);
    };
    const observer = new ResizeObserver(updateMetrics);
    observer.observe(gridElement);
    updateMetrics();
    return () => observer.disconnect();
  }, [effectiveColumns, images.length, isTrashView, trashItems.length]);

  const masonryLayout = useMemo(() => {
    const columnCount = Math.max(1, effectiveColumns);
    const width = gridWidth > 0 ? gridWidth : Math.max(320, viewportWidth - 32);
    const columnWidth = Math.max(160, (width - MASONRY_GAP * (columnCount - 1)) / columnCount);
    const columnHeights = Array.from({ length: columnCount }, () => 0);
    const items: MasonryItem[] = images.map((image, index) => {
      let columnIndex = 0;
      for (let nextIndex = 1; nextIndex < columnHeights.length; nextIndex += 1) {
        if (columnHeights[nextIndex] < columnHeights[columnIndex]) {
          columnIndex = nextIndex;
        }
      }
      const height = measuredCardHeights[image.relative_path] ?? Math.round(columnWidth * 1.36 + 54);
      const top = columnHeights[columnIndex];
      const left = columnIndex * (columnWidth + MASONRY_GAP);
      columnHeights[columnIndex] += height + MASONRY_GAP;
      return { image, index, top, left, width: columnWidth, height };
    });
    return {
      items,
      totalHeight: Math.max(0, ...columnHeights) - MASONRY_GAP,
    };
  }, [effectiveColumns, gridWidth, images, measuredCardHeights, viewportWidth]);

  const visibleMasonryItems = useMemo(
    () =>
      masonryLayout.items.filter((item) => {
        const itemTop = gridTop + item.top;
        return itemTop + item.height >= -MASONRY_OVERSCAN && itemTop <= viewportHeight + MASONRY_OVERSCAN;
      }),
    [gridTop, masonryLayout.items, viewportHeight],
  );

  const measureCard = (relativePath: string, element: HTMLElement | null) => {
    cardRefs.current[relativePath] = element;
    if (!element) {
      return;
    }

    window.requestAnimationFrame(() => {
      const height = Math.ceil(element.getBoundingClientRect().height);
      if (!height) {
        return;
      }
      setMeasuredCardHeights((current) => {
        if (Math.abs((current[relativePath] ?? 0) - height) <= 1) {
          return current;
        }
        return { ...current, [relativePath]: height };
      });
    });
  };

  useEffect(() => {
    if (!enableImagePrefetch || !images.length || isTrashView || typeof IntersectionObserver === "undefined") {
      return;
    }

    const indexByPath = new Map(images.map((image, index) => [image.relative_path, index]));
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

          const endIndex = Math.min(images.length, startIndex + prefetchSpan);
          for (let index = startIndex; index < endIndex; index += 1) {
            prefetchGalleryImage(images[index]);
          }
          observer.unobserve(entry.target);
        });
      },
      { root, rootMargin: "520px 0px", threshold: 0.01 },
    );

    images.forEach((image) => {
      const element = cardRefs.current[image.relative_path];
      if (!element) {
        return;
      }
      element.dataset.imagePath = image.relative_path;
      observer.observe(element);
    });

    return () => observer.disconnect();
  }, [effectiveColumns, enableImagePrefetch, images, isTrashView]);

  useEffect(() => {
    setSelectionMode(defaultSelectionMode);
    if (!defaultSelectionMode && !isTrashView) {
      onSelectionChange([]);
    }
  }, [defaultSelectionMode, isTrashView, onSelectionChange]);

  const topCategories = useMemo(() => {
    const categories = context?.categories ?? [];
    const primary = categories.slice(0, 8);
    if (selectedCategory && !primary.includes(selectedCategory)) {
      return [selectedCategory, ...primary.slice(0, 7)];
    }
    return primary;
  }, [context?.categories, selectedCategory]);

  const handleDragEnter = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current += 1;
    setDragActive(true);
  };

  const handleDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current -= 1;
    if (dragDepthRef.current <= 0) {
      dragDepthRef.current = 0;
      setDragActive(false);
    }
  };

  const handleDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragDepthRef.current = 0;
    setDragActive(false);
    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length) {
      await onImportFiles(files, activeImportSourceId);
    }
  };

  const setSelection = (relativePaths: string[]) => {
    const visiblePathSet = new Set(visibleSelectionPaths);
    const dedupedPaths = relativePaths.filter(
      (path, index, paths) => visiblePathSet.has(path) && paths.indexOf(path) === index,
    );
    onSelectionChange(dedupedPaths);
  };

  const toggleSelection = (relativePath: string, preserveAnchor = false) => {
    if (pageSelectedPaths.includes(relativePath)) {
      setSelection(pageSelectedPaths.filter((path) => path !== relativePath));
      if (!preserveAnchor) {
        lastSelectedPathRef.current = relativePath;
      }
      return;
    }

    setSelection([...pageSelectedPaths, relativePath]);
    if (!preserveAnchor) {
      lastSelectedPathRef.current = relativePath;
    }
  };

  const selectRangeTo = (relativePath: string) => {
    const anchorPath = lastSelectedPathRef.current || pageSelectedPaths[pageSelectedPaths.length - 1] || relativePath;
    const anchorIndex = visibleSelectionPaths.indexOf(anchorPath);
    const targetIndex = visibleSelectionPaths.indexOf(relativePath);
    if (anchorIndex < 0 || targetIndex < 0) {
      toggleSelection(relativePath);
      return;
    }

    const startIndex = Math.min(anchorIndex, targetIndex);
    const endIndex = Math.max(anchorIndex, targetIndex);
    const rangePaths = visibleSelectionPaths.slice(startIndex, endIndex + 1);
    setSelection([...pageSelectedPaths, ...rangePaths]);
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

  const selectAllVisible = () => {
    setSelection(visibleSelectionPaths);
    lastSelectedPathRef.current = visibleSelectionPaths[0] || "";
  };

  const clearSelection = () => {
    onSelectionChange([]);
    lastSelectedPathRef.current = "";
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) {
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
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedImagePaths.length, visibleSelectionPaths, pageSelectedPaths]);

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

    await onDeleteImages(pageSelectedPaths);
    clearSelection();
  };

  const handleAddToBoard = async (boardId: string) => {
    if (!boardPickerPaths.length) {
      return;
    }
    await onUpdateBoardPins(boardId, boardPickerPaths, true);
    pushToast(t("boardAddSuccess", { count: boardPickerPaths.length }), "success");
    setBoardPickerPaths([]);
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
    await onDeleteBoard(selectedBoard.id);
    onBoardChange("");
    pushToast(t("boardDeleteSuccess"), "success");
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
    pushToast(t("trashRestoreSelectedSuccess", { count: selectedTrashItems.length }), "success");
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
    pushToast(t("trashDeleteSelectedSuccess", { count: selectedTrashItems.length }), "success");
    clearSelection();
  };

  const handlePageJump = (formData: FormData) => {
    const requestedPage = Number(formData.get("page"));
    if (!Number.isFinite(requestedPage)) {
      return;
    }

    const nextPage = Math.min(Math.max(1, Math.trunc(requestedPage)), totalPages);
    if (nextPage !== page) {
      onPageChange(nextPage);
    }
  };

  const getAbsoluteImageUrl = (image: ImageRecord) =>
    new URL(image.original_url || image.url, window.location.origin).toString();

  const updateSelectionFromBox = (box: SelectionBoxState) => {
    const left = Math.min(box.startX, box.currentX);
    const right = Math.max(box.startX, box.currentX);
    const top = Math.min(box.startY, box.currentY);
    const bottom = Math.max(box.startY, box.currentY);

    const selectionItems = isTrashView
      ? trashItems.map((item) => ({ key: item.id }))
      : images.map((image) => ({ key: image.relative_path }));

    const intersectedPaths = selectionItems
      .filter((item) => {
        const element = cardRefs.current[item.key];
        if (!element) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        return !(rect.right < left || rect.left > right || rect.bottom < top || rect.top > bottom);
      })
      .map((item) => item.key);

    setSelection(intersectedPaths);
  };

  const handleSelectionPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!selectionEnabled || event.button !== 0) {
      return;
    }

    const target = event.target as HTMLElement;
    if (target.closest("button, input, select, textarea, a, label")) {
      return;
    }

    isDraggingSelectionRef.current = false;
    setSelectionBox({
      startX: event.clientX,
      startY: event.clientY,
      currentX: event.clientX,
      currentY: event.clientY,
    });
  };

  const handleSelectionPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!selectionEnabled || !selectionBox) {
      return;
    }

    const nextBox = {
      ...selectionBox,
      currentX: event.clientX,
      currentY: event.clientY,
    };
    if (
      Math.abs(nextBox.currentX - nextBox.startX) > 6 ||
      Math.abs(nextBox.currentY - nextBox.startY) > 6
    ) {
      isDraggingSelectionRef.current = true;
    }
    setSelectionBox(nextBox);
    if (isDraggingSelectionRef.current) {
      updateSelectionFromBox(nextBox);
    }
  };

  const handleSelectionPointerEnd = () => {
    if (!selectionBox) {
      return;
    }

    if (!isDraggingSelectionRef.current) {
      setSelectionBox(null);
      return;
    }

    setSelectionBox(null);
    window.setTimeout(() => {
      isDraggingSelectionRef.current = false;
    }, 0);
  };

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

    try {
      await onDeleteImages([image.relative_path]);
      pushToast(t("imageDelete"), "success");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t("imageDeleteError"), "error");
    }
  };

  const handleOpenContextMenu = (event: React.MouseEvent, image: ImageRecord) => {
    event.preventDefault();
    event.stopPropagation();

    const menuWidth = 292;
    const menuHeight = 356;
    if (!pageSelectedPaths.includes(image.relative_path)) {
      setSelection([image.relative_path]);
      lastSelectedPathRef.current = image.relative_path;
    }

    const position = placeFloatingMenu(event.clientX, event.clientY, menuWidth, menuHeight);
    setContextMenu({
      image,
      x: position.x,
      y: position.y,
    });
  };

  const handleTrashContextMenu = (event: React.MouseEvent, item: TrashItem) => {
    event.preventDefault();
    event.stopPropagation();

    const menuWidth = 220;
    const menuHeight = 220;
    if (!pageSelectedPaths.includes(item.id)) {
      setSelection([item.id]);
      lastSelectedPathRef.current = item.id;
    }

    const position = placeFloatingMenu(event.clientX, event.clientY, menuWidth, menuHeight);
    setTrashContextMenu({
      item,
      x: position.x,
      y: position.y,
    });
  };

  const handleScrollToTop = () => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

  const viewModeToggle = (
    <div className="ue-segmented-control ue-segmented-control--compact ue-view-toggle" aria-label={t("viewMode")}>
      <button
        className={galleryViewMode === "grid" ? "active" : ""}
        onClick={() => setGalleryViewMode("grid")}
        type="button"
        aria-label={t("viewGrid")}
        title={t("viewGrid")}
      >
        <LayoutGrid size={13} />
        <span>{t("viewGrid")}</span>
      </button>
      <button
        className={galleryViewMode === "list" ? "active" : ""}
        onClick={() => setGalleryViewMode("list")}
        type="button"
        aria-label={t("viewList")}
        title={t("viewList")}
      >
        <List size={13} />
        <span>{t("viewList")}</span>
      </button>
    </div>
  );

  return (
    <div
      className={`ue-drop-shell ${dragActive ? "is-dragging" : ""}`}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <section className="ue-workspace ue-workspace--gallery ue-animate-in">
        <div className="ue-filter-bar ue-filter-bar--gallery">
          <div className="ue-filter-copy">
            <p className="ue-filter-kicker">
              {isTrashView ? t("trashTitle") : selectedBoard ? selectedBoard.name : selectedSubfolder || t("galleryOutputFolder")}
            </p>
            <div className="ue-filter-summary">
              <strong>{isTrashView ? trashItems.length : total}</strong>
              <span>{t(isTrashView ? "trashItemCount" : "galleryFilterResult", { count: isTrashView ? trashItems.length : total })}</span>
              {favoritesOnly ? <em>{t("galleryPinnedOnly")}</em> : null}
              {selectedBoard ? <em>{t("sidebarBoards")}</em> : null}
              {isRefreshing ? <em>{t("commonLoading")}</em> : null}
            </div>
          </div>

          {!isTrashView ? (
          <div className="ue-filter-controls ue-filter-controls--gallery">
            <div className="ue-toolbar-group ue-toolbar-group--filters">
            <div className="ue-filter-popover">
              <button
                className={`ue-filter-trigger ${showFiltersMenu ? "is-open" : ""} ${activeFilterControlCount ? "active" : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setShowFiltersMenu((current) => !current);
                }}
                type="button"
                aria-label={t("galleryFilters")}
                title={t("galleryFilters")}
              >
                <SlidersHorizontal size={14} />
                <span>{t("galleryFilters")}</span>
                {activeFilterControlCount ? <strong>{activeFilterControlCount}</strong> : null}
              </button>
              {showFiltersMenu ? (
                <div className="ue-filter-menu" onClick={(event) => event.stopPropagation()}>
                  <div className="ue-filter-menu-head">
                    <div>
                      <span>{t("galleryFilters")}</span>
                      <strong>
                        {t("galleryFilterResult", { count: total })} · {t("galleryFiltersRealtime")}
                      </strong>
                    </div>
                    <div className="ue-filter-menu-head-actions">
                    {activeFilterControlCount ? (
                      <button
                        className="ue-filter-reset-btn"
                        onClick={() => {
                          onCategoryChange("");
                          onDateFromChange("");
                          onDateToChange("");
                          onFavoritesOnlyChange(false);
                          onColorFamilyChange("");
                          onSortByChange("created_at");
                          onSortOrderChange("desc");
                          onPageChange(1);
                        }}
                        aria-label={t("galleryDateClear")}
                        title={t("galleryDateClear")}
                      >
                        <CalendarX size={13} />
                        <span>{t("galleryDateClear")}</span>
                      </button>
                    ) : null}
                    </div>
                  </div>

                  <div className="ue-filter-menu-body">
                  <section className="ue-filter-section ue-filter-section--summary">
                    <div className="ue-filter-section-head">
                      <span>{t("galleryActiveFilters")}</span>
                    </div>
                    <div className="ue-active-filter-row">
                      {activeFilterChips.length ? (
                        activeFilterChips.map((chip) => (
                          <button
                            key={chip.key}
                            className="ue-active-filter-chip"
                            onClick={chip.onClear}
                            type="button"
                            title={`${chip.label} · ${t("galleryDateClear")}`}
                          >
                            {chip.color ? <span className="ue-active-filter-dot" style={{ background: chip.color }} /> : null}
                            <span>{chip.label}</span>
                            <span aria-hidden="true">×</span>
                          </button>
                        ))
                      ) : (
                        <span className="ue-active-filter-empty">{t("galleryFilterNone")}</span>
                      )}
                    </div>
                  </section>

                  <section className="ue-filter-section">
                    <div className="ue-filter-section-head">
                      <span>{t("galleryCategory")}</span>
                      {(context?.categories?.length ?? 0) > 8 ? (
                        <button className="ue-filter-link" onClick={() => setShowCategoryPicker(true)} type="button">
                          {t("galleryMoreCategories")}
                        </button>
                      ) : null}
                    </div>
                    <div className="ue-filter-chip-grid">
                      <button
                        className={`ue-filter-chip ${selectedCategory === "" ? "active" : ""}`}
                        onClick={() => {
                          onCategoryChange("");
                          onPageChange(1);
                        }}
                        type="button"
                      >
                        {t("galleryAllCategories")}
                      </button>
                      {topCategories.map((category) => (
                        <button
                          key={category}
                          className={`ue-filter-chip ${selectedCategory === category ? "active" : ""}`}
                          onClick={() => {
                            onCategoryChange(category);
                            onPageChange(1);
                          }}
                          type="button"
                        >
                          {category}
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="ue-filter-section">
                    <div className="ue-filter-section-head">
                      <span>{t("gallerySort")}</span>
                    </div>
                    <div className="ue-filter-sort-row">
                    <div className="ue-sort-segment" role="group" aria-label={t("gallerySort")}>
                      {SORT_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          className={sortBy === option.value ? "active" : ""}
                          onClick={() => {
                            onSortByChange(option.value);
                            onPageChange(1);
                          }}
                          type="button"
                          title={t(option.hintKey)}
                        >
                          {t(option.labelKey)}
                        </button>
                      ))}
                    </div>
                    <div className="ue-sort-direction">
                      {SORT_ORDER_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          className={sortOrder === option.value ? "active" : ""}
                          onClick={() => {
                            onSortOrderChange(option.value);
                            onPageChange(1);
                          }}
                          type="button"
                        >
                          <strong>{t(option.labelKey)}</strong>
                          <span>{t(option.hintKey)}</span>
                        </button>
                      ))}
                    </div>
                    </div>
                    <p className="ue-sort-current">
                      {t(selectedSortOption.hintKey)} · {t(selectedSortOrderOption.hintKey)}
                    </p>
                  </section>

                  <section className="ue-filter-section">
                    <div className="ue-filter-section-head ue-filter-section-head--inline">
                      <span>{t("galleryColorFamily")}</span>
                      <em>{t("galleryColorThreshold")}</em>
                    </div>
                    <div className="ue-color-palette-grid">
                      <button
                        className={`ue-color-palette ${selectedColorFamily === "" ? "active" : ""}`}
                        onClick={() => {
                          onColorFamilyChange("");
                          onPageChange(1);
                        }}
                        type="button"
                      >
                        <span className="ue-color-palette-swatch ue-color-swatch--all" />
                        <em>{t("galleryAllColors").replace(/色系$/, "").replace(/ colors$/i, "")}</em>
                      </button>
                      {COLOR_FILTERS.map((option) => (
                        <button
                          key={option.value}
                          className={`ue-color-palette ${selectedColorFamily === option.value ? "active" : ""}`}
                          onClick={() => {
                            onColorFamilyChange(option.value);
                            onPageChange(1);
                          }}
                          type="button"
                          title={getColorFamilyLabel(option.value)}
                        >
                          <span className="ue-color-palette-swatch" style={{ background: option.color }} />
                          <em>{getColorFamilyShortLabel(option.value)}</em>
                        </button>
                      ))}
                    </div>
                    {colorIndexStatus && !colorIndexStatus.complete ? (
                      <p className="ue-color-index-note">
                        {t("galleryColorIndexing")} {colorIndexStatus.indexed}/{colorIndexStatus.total}
                      </p>
                    ) : null}
                  </section>

                  <section className="ue-filter-section">
                    <div className="ue-filter-section-head">
                      <span>{t("galleryDateRange")}</span>
                    </div>
                  <div className="ue-filter-menu-grid ue-filter-menu-grid--date">
                    <label className="ue-select-field ue-select-field--input ue-date-filter-field">
                      <span>{t("galleryDateFrom")}</span>
                      <input
                        type="date"
                        value={dateFrom}
                        max={dateTo || undefined}
                        onChange={(event) => {
                          onDateFromChange(event.target.value);
                          onPageChange(1);
                        }}
                      />
                    </label>

                    <label className="ue-select-field ue-select-field--input ue-date-filter-field">
                      <span>{t("galleryDateTo")}</span>
                      <input
                        type="date"
                        value={dateTo}
                        min={dateFrom || undefined}
                        onChange={(event) => {
                          onDateToChange(event.target.value);
                          onPageChange(1);
                        }}
                      />
                    </label>

                    <button
                      className={`ue-filter-option ${favoritesOnly ? "active" : ""}`}
                      onClick={() => {
                        onFavoritesOnlyChange(!favoritesOnly);
                        onPageChange(1);
                      }}
                      type="button"
                    >
                      <Pin size={14} fill={favoritesOnly ? "currentColor" : "none"} />
                      <span>{t("galleryPinnedOnly")}</span>
                      <Check size={14} />
                    </button>
                  </div>
                  </section>
                  </div>

                  <div className="ue-filter-menu-foot">
                    <span>{t("galleryFilterStickyHint")}</span>
                    <button type="button" onClick={() => setShowFiltersMenu(false)}>
                      {t("galleryFilterClose")}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
            </div>

            <div className="ue-toolbar-group ue-toolbar-group--view">
            {viewModeToggle}

            {galleryViewMode === "grid" ? (
            <div className="ue-select-field ue-select-field--menu">
              <span>{t("galleryColumns")}</span>
              <button
                className={`ue-select-field__menu-trigger ${showColumnsMenu ? "is-open" : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setShowColumnsMenu((current) => !current);
                }}
                type="button"
              >
                <span>{gridColumns}</span>
                <ChevronDown size={14} />
              </button>
              {showColumnsMenu ? (
                <div className="ue-select-field__menu" onClick={(event) => event.stopPropagation()}>
                  {Array.from({ length: 6 }, (_, index) => index + 3).map((count) => (
                    <button
                      key={count}
                      className={gridColumns === count ? "is-active" : ""}
                      onClick={() => {
                        onGridColumnsChange(count);
                        setShowColumnsMenu(false);
                      }}
                      type="button"
                    >
                      {count}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            ) : null}
            </div>

            <div className="ue-toolbar-group ue-toolbar-group--state">
            {selectedBoard ? (
              <>
                <button
                  className="ue-chip-toggle ue-chip-toggle--icon"
                  onClick={() => setShareBoardId(selectedBoard.id)}
                  aria-label={t("boardShareTitle")}
                  title={t("boardShareTitle")}
                >
                  <Share2 size={13} />
                </button>
                <button
                  className="ue-chip-toggle ue-chip-toggle--icon"
                  onClick={() => void handleDeleteSelectedBoard()}
                  aria-label={t("boardDeleteTitle")}
                  title={t("boardDeleteTitle")}
                >
                  <Trash2 size={13} />
                </button>
              </>
            ) : null}
            <button
              className={`ue-chip-toggle ue-chip-toggle--icon ${selectionMode ? "active" : ""}`}
              title={t("bulkSelectionHint")}
              aria-label={t("bulkSelectMode")}
              onClick={() => {
                setSelectionMode((current) => !current);
                clearSelection();
              }}
            >
              <CheckSquare size={13} />
            </button>
            </div>
            {writableSources.length > 0 ? (
              <div className="ue-toolbar-group ue-toolbar-group--source">
              <label className="ue-select-field ue-select-field--compact" title={t("galleryImportTarget")}>
                <select
                  value={activeImportSourceId}
                  onChange={(event) => setImportTargetSourceId(event.target.value)}
                  aria-label={t("galleryImportTarget")}
                >
                  {writableSources.map((source) => (
                    <option key={source.id} value={source.id}>
                      {source.name}
                    </option>
                  ))}
                </select>
              </label>
              </div>
            ) : null}
          </div>
          ) : (
            <div className="ue-filter-controls ue-filter-controls--gallery">
              {viewModeToggle}
            </div>
          )}
        </div>

        {importMessage ? <div className="ue-inline-success">{importMessage}</div> : null}
        {error ? <div className="ue-inline-error">{error}</div> : null}

        {isLoading && images.length === 0 ? (
          <div className="ue-gallery-state">
            <div className="ue-loading-orb" />
            <p>{t("galleryLoading")}</p>
          </div>
        ) : isTrashView ? (
          trashItems.length === 0 ? (
            <div className="ue-gallery-state ue-gallery-state--empty">
              <Trash2 size={44} strokeWidth={1.2} />
              <div>
                <h3>{t("trashEmptyTitle")}</h3>
                <p>{t("trashEmptyText")}</p>
              </div>
            </div>
          ) : (
            <div className="ue-trash-workspace">
              <div className="ue-trash-toolbar">
                <div className="ue-trash-toolbar-copy">
                  <strong>{t("bulkSelected", { count: selectedCount })}</strong>
                  <span>{t("trashSelectionHint")}</span>
                </div>
                <div className="ue-trash-toolbar-actions">
                  <button className="ue-secondary-btn" onClick={selectAllVisible}>
                    <CheckSquare size={14} />
                    <span>{t("trashSelectAll")}</span>
                  </button>
                  <button className="ue-secondary-btn" onClick={clearSelection} disabled={!hasSelection}>
                    <Square size={14} />
                    <span>{t("trashClearSelection")}</span>
                  </button>
                  <button
                    className="ue-secondary-btn ue-secondary-btn--accent"
                    onClick={() => void handleRestoreSelectedTrash()}
                    disabled={!selectedTrashItems.length}
                  >
                    <RotateCcw size={14} />
                    <span>{t("trashRestoreSelected")}</span>
                  </button>
                  <button
                    className="ue-secondary-btn ue-secondary-btn--danger"
                    onClick={() => void handlePurgeSelectedTrash()}
                    disabled={!selectedTrashItems.length}
                  >
                    <Trash2 size={14} />
                    <span>{t("trashDeleteSelectedForever")}</span>
                  </button>
                </div>
              </div>

              <div
                ref={gridRef}
                className={`ue-trash-list ue-trash-list--selectable ${galleryViewMode === "grid" ? "ue-trash-list--grid" : ""}`}
                onPointerDown={handleSelectionPointerDown}
                onPointerMove={handleSelectionPointerMove}
                onPointerUp={handleSelectionPointerEnd}
                onPointerCancel={handleSelectionPointerEnd}
              >
                {trashItems.map((item) => {
                  const selected = pageSelectedPaths.includes(item.id);
                  const kindLabel =
                    item.kind === "folder"
                      ? t("trashKindFolder")
                      : item.kind === "library"
                        ? t("trashKindLibrary")
                        : t("trashKindImage");

                  return (
                    <article
                      key={item.id}
                      ref={(element) => {
                        cardRefs.current[item.id] = element;
                      }}
                      className={`ue-trash-card ${selected ? "is-selected" : ""}`}
                      onContextMenu={(event) => handleTrashContextMenu(event, item)}
                      onClick={(event) => {
                        if (isDraggingSelectionRef.current) {
                          return;
                        }
                        handleImageSelectionClick(item.id, event);
                      }}
                    >
                      <button
                        className={`ue-trash-card-check ${selected ? "active" : ""}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleImageSelectionClick(item.id, event);
                        }}
                        aria-label={selected ? t("galleryDeselectImage") : t("gallerySelectImage")}
                        title={selected ? t("galleryDeselectImage") : t("gallerySelectImage")}
                      >
                        {selected ? <CheckSquare size={14} /> : <Square size={14} />}
                      </button>
                      <div className="ue-trash-card-main">
                        {item.kind === "image" && item.thumb_url ? (
                          <img src={item.thumb_url} alt={item.name} />
                        ) : (
                          <div className="ue-trash-card-icon">
                            {item.kind === "folder" ? <FolderIcon size={22} /> : <Trash2 size={22} />}
                          </div>
                        )}
                        <div className="ue-trash-card-copy">
                          <div className="ue-trash-card-title-row">
                            <h4>{item.name}</h4>
                            <span>{kindLabel}</span>
                          </div>
                          <p title={item.original_path}>{item.original_path}</p>
                          <div className="ue-trash-card-meta">
                            <span>{formatCompactDate(item.deleted_at)}</span>
                            {item.image_count ? <span>{t("trashImageCount", { count: item.image_count })}</span> : null}
                          </div>
                        </div>
                      </div>
                      <div className="ue-trash-card-actions">
                        <button
                          className="ue-icon-action"
                          onClick={(event) => {
                            event.stopPropagation();
                            void onRestoreTrashItem(item.id);
                          }}
                          aria-label={t("trashRestore")}
                          title={t("trashRestore")}
                        >
                          <RotateCcw size={14} />
                        </button>
                        <button
                          className="ue-icon-action ue-icon-action--danger"
                          onClick={(event) => {
                            event.stopPropagation();
                            void onPurgeTrashItem(item.id);
                          }}
                          aria-label={t("trashDeleteForever")}
                          title={t("trashDeleteForever")}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </article>
                  );
                })}
                {selectionEnabled && selectionBox ? (
                  <div
                    className="ue-selection-box"
                    style={{
                      left: Math.min(selectionBox.startX, selectionBox.currentX),
                      top: Math.min(selectionBox.startY, selectionBox.currentY),
                      width: Math.abs(selectionBox.currentX - selectionBox.startX),
                      height: Math.abs(selectionBox.currentY - selectionBox.startY),
                    }}
                  />
                ) : null}
              </div>
            </div>
          )
        ) : images.length === 0 ? (
          <div className="ue-gallery-state ue-gallery-state--empty">
            <ImageIcon size={44} strokeWidth={1.2} />
            <div>
              <h3>{t("galleryEmptyTitle")}</h3>
              <p>{t("galleryEmptyText")}</p>
            </div>
          </div>
        ) : galleryViewMode === "list" ? (
          <div
            ref={gridRef}
            className="ue-gallery-list ue-gallery-list--selectable"
            onPointerDown={handleSelectionPointerDown}
            onPointerMove={handleSelectionPointerMove}
            onPointerUp={handleSelectionPointerEnd}
            onPointerCancel={handleSelectionPointerEnd}
          >
            {images.map((image) => {
              const selected = pageSelectedPaths.includes(image.relative_path);

              return (
                <article
                  key={image.relative_path}
                  ref={(element) => {
                    cardRefs.current[image.relative_path] = element;
                  }}
                  className={`ue-gallery-list-row ${selected ? "is-selected" : ""}`}
                  onContextMenu={(event) => handleOpenContextMenu(event, image)}
                  onClick={(event) => {
                    if (selectionMode) {
                      handleImageSelectionClick(image.relative_path, event);
                      return;
                    }
                    if (isDraggingSelectionRef.current) {
                      return;
                    }
                    onOpenDetail(image);
                  }}
                >
                  <button
                    className={`ue-trash-card-check ${selected ? "active" : ""}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      handleImageSelectionClick(image.relative_path, event);
                    }}
                    aria-label={selected ? t("galleryDeselectImage") : t("gallerySelectImage")}
                    title={selected ? t("galleryDeselectImage") : t("gallerySelectImage")}
                  >
                    {selected ? <CheckSquare size={14} /> : <Square size={14} />}
                  </button>
                  <button
                    className="ue-gallery-list-thumb"
                    onClick={(event) => {
                      event.stopPropagation();
                      if (selectionMode) {
                        handleImageSelectionClick(image.relative_path, event);
                        return;
                      }
                      onOpenDetail(image);
                    }}
                    aria-label={t("galleryInspect")}
                    title={t("galleryInspect")}
                  >
                    <img src={getGalleryImageUrl(image)} alt={image.title || image.filename} loading="lazy" decoding="async" />
                  </button>
                  <div className="ue-gallery-list-main">
                    <div className="ue-gallery-list-heading">
                      <h3 title={image.title || image.filename}>{image.title || image.filename}</h3>
                      {image.category ? <span>{image.category}</span> : null}
                    </div>
                    <p title={image.relative_path}>{image.relative_path}</p>
                    <div className="ue-gallery-list-meta">
                      <span>{formatCompactDate(image.created_at)}</span>
                      <span>{formatFileSize(image.size)}</span>
                      {image.pinned ? <span>{t("galleryPin")}</span> : null}
                    </div>
                  </div>
                  <div className="ue-gallery-list-actions">
                    <button
                      className="ue-icon-action"
                      onClick={(event) => {
                        event.stopPropagation();
                        void onOpenWorkflow(image);
                      }}
                      aria-label={t("modalOpenWorkflow")}
                      title={t("modalOpenWorkflow")}
                    >
                      <Send size={14} />
                    </button>
                    <button
                      className="ue-icon-action"
                      onClick={(event) => {
                        event.stopPropagation();
                        onOpenDetail(image);
                      }}
                      aria-label={t("galleryInspect")}
                      title={t("galleryInspect")}
                    >
                      <Eye size={14} />
                    </button>
                    <button
                      className="ue-icon-action"
                      onClick={(event) => {
                        event.stopPropagation();
                        if (selected && pageSelectedPaths.length > 1) {
                          setBoardPickerPaths(pageSelectedPaths);
                        } else {
                          setBoardPickerPaths([image.relative_path]);
                        }
                      }}
                      aria-label={t("bulkAddToBoard")}
                      title={t("bulkAddToBoard")}
                    >
                      <FolderPlus size={14} />
                    </button>
                    <button
                      className={`ue-icon-action ${image.pinned ? "ue-icon-action--accent" : ""}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void onUpdateImageState(image.relative_path, { pinned: !image.pinned });
                      }}
                      aria-label={image.pinned ? t("galleryUnpin") : t("galleryPin")}
                      title={image.pinned ? t("galleryUnpin") : t("galleryPin")}
                    >
                      <Pin size={14} fill={image.pinned ? "currentColor" : "none"} />
                    </button>
                  </div>
                </article>
              );
            })}
            {selectionEnabled && selectionBox ? (
              <div
                className="ue-selection-box"
                style={{
                  left: Math.min(selectionBox.startX, selectionBox.currentX),
                  top: Math.min(selectionBox.startY, selectionBox.currentY),
                  width: Math.abs(selectionBox.currentX - selectionBox.startX),
                  height: Math.abs(selectionBox.currentY - selectionBox.startY),
                }}
              />
            ) : null}
          </div>
        ) : (
          <div
            ref={gridRef}
            className="ue-gallery-grid ue-gallery-grid--virtual"
            style={{ height: `${masonryLayout.totalHeight}px` }}
            onPointerDown={handleSelectionPointerDown}
            onPointerMove={handleSelectionPointerMove}
            onPointerUp={handleSelectionPointerEnd}
            onPointerCancel={handleSelectionPointerEnd}
          >
            {visibleMasonryItems.map(({ image, index, top, left, width }) => {
              const selected = pageSelectedPaths.includes(image.relative_path);

              return (
                <article
                  key={image.relative_path}
                  className={`ue-gallery-card ${selected ? "is-selected" : ""}`}
                  style={{ top: `${top}px`, left: `${left}px`, width: `${width}px` }}
                  onContextMenu={(event) => handleOpenContextMenu(event, image)}
                  ref={(element) => {
                    measureCard(image.relative_path, element);
                  }}
                >
                  <div className="ue-gallery-media">
                    <GalleryCardImage
                      image={image}
                      priority={index < effectiveColumns * 2}
                      onOpenDetail={(nextImage, event) => {
                        if (selectionMode) {
                          handleImageSelectionClick(nextImage.relative_path, event);
                          return;
                        }
                        if (isDraggingSelectionRef.current) {
                          return;
                        }
                        onOpenDetail(nextImage);
                      }}
                    />

                    <div className="ue-gallery-actions">
                      <button
                        className="ue-send-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          void onOpenWorkflow(image);
                        }}
                        aria-label={t("modalOpenWorkflow")}
                        title={t("modalOpenWorkflow")}
                      >
                        <Send size={13} />
                      </button>
                      <button
                        className={`ue-select-btn ${selected ? "active" : ""}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleImageSelectionClick(image.relative_path, event);
                        }}
                        aria-label={selected ? t("galleryDeselectImage") : t("gallerySelectImage")}
                        title={selected ? t("galleryDeselectImage") : t("gallerySelectImage")}
                      >
                        {selected ? <CheckSquare size={13} /> : <Square size={13} />}
                      </button>

                      <button
                        className="ue-board-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (selected && pageSelectedPaths.length > 1) {
                            setBoardPickerPaths(pageSelectedPaths);
                          } else {
                            setBoardPickerPaths([image.relative_path]);
                          }
                        }}
                        aria-label={t("bulkAddToBoard")}
                        title={t("bulkAddToBoard")}
                      >
                        <FolderPlus size={13} />
                      </button>

                      <button
                        className={`ue-pin-btn ${image.pinned ? "active" : ""}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          void onUpdateImageState(image.relative_path, { pinned: !image.pinned });
                        }}
                        aria-label={image.pinned ? t("galleryUnpin") : t("galleryPin")}
                        title={image.pinned ? t("galleryUnpin") : t("galleryPin")}
                      >
                        <Pin size={13} fill={image.pinned ? "currentColor" : "none"} />
                      </button>
                    </div>

                    <button
                      className="ue-gallery-open ue-gallery-open--icon"
                      onClick={(event) => {
                        if (selectionMode) {
                          handleImageSelectionClick(image.relative_path, event);
                          return;
                        }
                        if (isDraggingSelectionRef.current) {
                          return;
                        }
                        onOpenDetail(image);
                      }}
                      aria-label={t("galleryInspect")}
                      title={t("galleryInspect")}
                    >
                      <Eye size={14} />
                    </button>
                  </div>

                  <button
                    className="ue-gallery-body"
                    onClick={(event) => {
                      if (selectionMode) {
                        handleImageSelectionClick(image.relative_path, event);
                        return;
                      }
                      if (isDraggingSelectionRef.current) {
                        return;
                      }
                      onOpenDetail(image);
                    }}
                  >
                    <span className="ue-gallery-title" title={image.title || image.filename}>
                      {image.title || image.filename}
                    </span>
                    <span className="ue-gallery-meta">
                      {formatCompactDate(image.created_at)}
                      <i aria-hidden="true">/</i>
                      {formatFileSize(image.size)}
                      {image.category ? (
                        <>
                          <i aria-hidden="true">/</i>
                          {image.category}
                        </>
                      ) : null}
                    </span>
                  </button>
                </article>
              );
            })}
            {selectionEnabled && selectionBox ? (
              <div
                className="ue-selection-box"
                style={{
                  left: Math.min(selectionBox.startX, selectionBox.currentX),
                  top: Math.min(selectionBox.startY, selectionBox.currentY),
                  width: Math.abs(selectionBox.currentX - selectionBox.startX),
                  height: Math.abs(selectionBox.currentY - selectionBox.startY),
                }}
              />
            ) : null}
          </div>
        )}

        {images.length > 0 ? (
          <div className="ue-pagination">
            <div className="ue-pagination-meta">
              <span>{t("galleryPage", { page, totalPages })}</span>
              <i aria-hidden="true">/</i>
              <span>{total} {t("galleryStatsTotal")}</span>
            </div>

            <div className="ue-pagination-actions">
              {selectionMode ? (
                <button
                  aria-label={t("bulkSelectVisible")}
                  title={t("bulkSelectVisible")}
                  onClick={selectAllVisible}
                >
                  <CheckSquare size={14} />
                </button>
              ) : null}
              <button
                disabled={page <= 1}
                onClick={() => onPageChange(page - 1)}
                aria-label={t("galleryPrevious")}
                title={t("galleryPrevious")}
              >
                <ChevronLeft size={14} />
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => onPageChange(page + 1)}
                aria-label={t("galleryNext")}
                title={t("galleryNext")}
              >
                <ChevronRight size={14} />
              </button>
              <form
                key={page}
                className="ue-pagination-jump"
                onSubmit={(event) => {
                  event.preventDefault();
                  handlePageJump(new FormData(event.currentTarget));
                }}
              >
                <label className="ue-select-field ue-pagination-jump-field">
                  <span>{t("galleryJumpTo")}</span>
                  <input
                    name="page"
                    type="number"
                    min={1}
                    max={totalPages}
                    defaultValue={page}
                    aria-label={t("galleryJumpTo")}
                  />
                </label>
                <button type="submit" aria-label={t("galleryJump")} title={t("galleryJump")}>
                  <CornerDownRight size={14} />
                </button>
              </form>
            </div>
          </div>
        ) : null}

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
          onPageChange(1);
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

      <BoardShareModal
        open={Boolean(shareBoard)}
        board={shareBoard}
        onClose={() => setShareBoardId("")}
      />

      {contextMenu ? (
        <div
          className="ue-context-menu ue-context-menu--gallery"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(event) => event.stopPropagation()}
        >
          <div className="ue-context-menu-head">
            <strong title={contextMenu.image.filename}>{contextMenu.image.filename}</strong>
            <span>{formatFileSize(contextMenu.image.size)}</span>
          </div>
          <div className="ue-context-menu-grid">
            <button
              className="ue-context-menu-item"
              onClick={() => {
                onOpenDetail(contextMenu.image);
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
                void onUpdateImageState(contextMenu.image.relative_path, { pinned: !contextMenu.image.pinned });
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
      ) : null}

      {metadataViewerImage ? (
        <MetadataViewerModal image={metadataViewerImage} onClose={() => setMetadataViewerImage(null)} />
      ) : null}

      {trashContextMenu ? (
        <div
          className="ue-context-menu"
          style={{ top: trashContextMenu.y, left: trashContextMenu.x }}
          onClick={(event) => event.stopPropagation()}
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
