import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarX,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Check,
  CheckSquare,
  CornerDownRight,
  Eye,
  ExternalLink,
  Folder as FolderIcon,
  FolderMinus,
  FolderPlus,
  Image as ImageIcon,
  PencilLine,
  Pin,
  RotateCcw,
  Send,
  Share2,
  Square,
  Tag,
  Trash2,
} from "lucide-react";

import { useI18n } from "../../i18n/I18nProvider";
import { useConfirm } from "../shared/ConfirmDialog";
import { useToast } from "../shared/ToastViewport";
import type { BoardMutationResult, BoardSummary, GalleryContext, ImageRecord, MoveTargetOption, TrashItem } from "../../types/universal-gallery";
import { formatCompactDate, formatFileSize } from "../../utils/formatters";
import { BoardPickerModal } from "./BoardPickerModal";
import { BoardShareModal } from "./BoardShareModal";
import { CategoryPickerModal } from "./CategoryPickerModal";

const loadedImageUrls = new Set<string>();
const prefetchedImageUrls = new Set<string>();

const getGalleryImageUrl = (image: ImageRecord) => image.thumb_url || image.url;

const prefetchGalleryImage = (image: ImageRecord) => {
  const imageUrl = getGalleryImageUrl(image);
  if (!imageUrl || loadedImageUrls.has(imageUrl) || prefetchedImageUrls.has(imageUrl)) {
    return;
  }

  prefetchedImageUrls.add(imageUrl);
  const preloadImage = new Image();
  preloadImage.decoding = "async";
  preloadImage.onload = () => {
    loadedImageUrls.add(imageUrl);
  };
  preloadImage.onerror = () => {
    prefetchedImageUrls.delete(imageUrl);
  };
  preloadImage.src = imageUrl;
};

const GalleryCardImage = ({
  image,
  priority = false,
  onOpenDetail,
}: {
  image: ImageRecord;
  priority?: boolean;
  onOpenDetail: (image: ImageRecord) => void;
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
        onClick={() => onOpenDetail(image)}
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
  targetFolderOptions: MoveTargetOption[];
  boards: BoardSummary[];
  onOpenDetail: (image: ImageRecord) => void;
  onPageChange: (page: number) => void;
  onCategoryChange: (category: string) => void;
  onBoardChange: (boardId: string) => void;
  onDateFromChange: (value: string) => void;
  onDateToChange: (value: string) => void;
  onFavoritesOnlyChange: (value: boolean) => void;
  onSortByChange: (value: string) => void;
  onSortOrderChange: (value: string) => void;
  onGridColumnsChange: (value: number) => void;
  onOpenWorkflow: (image: ImageRecord) => Promise<void>;
  onSelectionChange: (relativePaths: string[]) => void;
  onUpdateImageState: (relativePath: string, updates: Record<string, unknown>) => Promise<void>;
  onBatchUpdateImages: (relativePaths: string[], updates: Record<string, unknown>) => Promise<unknown>;
  onCreateBoard: (name: string, description?: string) => Promise<BoardMutationResult>;
  onUpdateBoardPins: (boardId: string, relativePaths: string[], pinned?: boolean) => Promise<unknown>;
  onDeleteBoard: (boardId: string) => Promise<unknown>;
  onMoveImages: (relativePaths: string[], targetSubfolder: string, targetSourceId?: string) => Promise<unknown>;
  onBatchRenameImages: (
    relativePaths: string[],
    template: string,
    startNumber: number,
    padding: number,
    currentPage: number,
  ) => Promise<unknown>;
  onDeleteImages: (relativePaths: string[]) => Promise<unknown>;
  onImportFiles: (files: File[], targetSourceId?: string) => Promise<unknown>;
  onRestoreTrashItem: (id: string) => Promise<void>;
  onPurgeTrashItem: (id: string) => Promise<void>;
}

interface ImageContextMenuState {
  image: ImageRecord;
  x: number;
  y: number;
}

interface SelectionBoxState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
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
  targetFolderOptions,
  boards,
  onOpenDetail,
  onPageChange,
  onCategoryChange,
  onBoardChange,
  onDateFromChange,
  onDateToChange,
  onFavoritesOnlyChange,
  onSortByChange,
  onSortOrderChange,
  onGridColumnsChange,
  onOpenWorkflow,
  onSelectionChange,
  onUpdateImageState,
  onBatchUpdateImages,
  onCreateBoard,
  onUpdateBoardPins,
  onDeleteBoard,
  onMoveImages,
  onBatchRenameImages,
  onDeleteImages,
  onImportFiles,
  onRestoreTrashItem,
  onPurgeTrashItem,
}: GalleryWorkspaceProps) => {
  const { t } = useI18n();
  const { confirm } = useConfirm();
  const { pushToast } = useToast();
  const [dragActive, setDragActive] = useState(false);
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkTargetSubfolder, setBulkTargetSubfolder] = useState("");
  const [importTargetSourceId, setImportTargetSourceId] = useState("");
  const [boardPickerPaths, setBoardPickerPaths] = useState<string[]>([]);
  const [shareBoardId, setShareBoardId] = useState("");
  const [bulkRenameTemplate, setBulkRenameTemplate] = useState("set-{page}-{n}");
  const [bulkRenameStart, setBulkRenameStart] = useState(1);
  const [bulkRenamePadding, setBulkRenamePadding] = useState(2);
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [contextMenu, setContextMenu] = useState<ImageContextMenuState | null>(null);
  const [showColumnsMenu, setShowColumnsMenu] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectionBox, setSelectionBox] = useState<SelectionBoxState | null>(null);
  const [showBackToTop, setShowBackToTop] = useState(false);
  const dragDepthRef = useRef(0);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<Record<string, HTMLElement | null>>({});
  const isDraggingSelectionRef = useRef(false);
  const scrollContainerRef = useRef<HTMLElement | null>(null);

  const visibleImagePaths = useMemo(() => images.map((image) => image.relative_path), [images]);
  const selectedImagePathSet = useMemo(() => new Set(selectedImagePaths), [selectedImagePaths]);
  const pageSelectedPaths = useMemo(
    () => images.filter((image) => selectedImagePathSet.has(image.relative_path)).map((image) => image.relative_path),
    [images, selectedImagePathSet],
  );
  const selectedCount = pageSelectedPaths.length;
  const hasSelection = selectedCount > 0;
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
    if (!contextMenu) {
      return;
    }

    const closeMenu = () => setContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setContextMenu(null);
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
  }, [contextMenu]);

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
    if (selectedImagePaths.length === pageSelectedPaths.length) {
      return;
    }
    onSelectionChange(pageSelectedPaths);
  }, [onSelectionChange, pageSelectedPaths, selectedImagePaths.length]);

  useEffect(() => {
    if (selectionMode) {
      return;
    }
    setSelectionBox(null);
    isDraggingSelectionRef.current = false;
  }, [selectionMode]);

  useEffect(() => {
    const scrollContainer = gridRef.current?.closest(".ue-main-shell") as HTMLElement | null;
    scrollContainerRef.current = scrollContainer;
    if (!scrollContainer) {
      return;
    }

    const handleScroll = () => {
      setShowBackToTop(scrollContainer.scrollTop > 320);
    };

    handleScroll();
    scrollContainer.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollContainer.removeEventListener("scroll", handleScroll);
  }, [images.length]);

  const effectiveColumns = useMemo(() => {
    if (viewportWidth <= 640) return 1;
    if (viewportWidth <= 960) return Math.min(gridColumns, 2);
    if (viewportWidth <= 1280) return Math.min(gridColumns, 3);
    if (viewportWidth <= 1600) return Math.min(gridColumns, 4);
    return gridColumns;
  }, [gridColumns, viewportWidth]);

  useEffect(() => {
    if (!images.length || isTrashView || typeof IntersectionObserver === "undefined") {
      return;
    }

    const indexByPath = new Map(images.map((image, index) => [image.relative_path, index]));
    const prefetchSpan = Math.max(effectiveColumns * 3, 8);
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
      { root, rootMargin: "900px 0px", threshold: 0.01 },
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
  }, [effectiveColumns, images, isTrashView]);

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

  const toggleSelection = (relativePath: string) => {
    if (pageSelectedPaths.includes(relativePath)) {
      onSelectionChange(pageSelectedPaths.filter((path) => path !== relativePath));
      return;
    }

    onSelectionChange([...pageSelectedPaths, relativePath]);
  };

  const selectAllVisible = () => {
    onSelectionChange(visibleImagePaths);
  };

  const clearSelection = () => {
    onSelectionChange([]);
  };

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

  const handleRemoveFromSelectedBoard = async () => {
    if (!selectedBoard || !hasSelection) {
      return;
    }
    await onUpdateBoardPins(selectedBoard.id, pageSelectedPaths, false);
    clearSelection();
  };

  const handleBatchMove = async () => {
    if (!hasSelection || !bulkTargetSubfolder) {
      return;
    }

    const target = targetFolderOptions.find((option) => option.value === bulkTargetSubfolder);
    await onMoveImages(pageSelectedPaths, bulkTargetSubfolder, target?.source_id);
    clearSelection();
  };

  const handleBatchRename = async () => {
    if (!hasSelection || !bulkRenameTemplate.trim()) {
      return;
    }

    await onBatchRenameImages(
      pageSelectedPaths,
      bulkRenameTemplate.trim(),
      bulkRenameStart,
      bulkRenamePadding,
      page,
    );
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

    const intersectedPaths = images
      .filter((image) => {
        const element = cardRefs.current[image.relative_path];
        if (!element) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        return !(rect.right < left || rect.left > right || rect.bottom < top || rect.top > bottom);
      })
      .map((image) => image.relative_path);

    onSelectionChange(intersectedPaths);
  };

  const handleSelectionPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!selectionMode || event.button !== 0) {
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
    if (!selectionMode || !selectionBox) {
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

    const menuWidth = 220;
    const menuHeight = 260;

    setContextMenu({
      image,
      x: Math.min(event.clientX, window.innerWidth - menuWidth - 12),
      y: Math.min(event.clientY, window.innerHeight - menuHeight - 12),
    });
  };

  const handleScrollToTop = () => {
    scrollContainerRef.current?.scrollTo({ top: 0, behavior: "smooth" });
  };

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
              <strong>{total}</strong>
              <span>{t("galleryFilterResult", { count: total })}</span>
              {favoritesOnly ? <em>{t("galleryPinnedOnly")}</em> : null}
              {selectedBoard ? <em>{t("sidebarBoards")}</em> : null}
              {isRefreshing ? <em>{t("commonLoading")}</em> : null}
            </div>
          </div>

          {!isTrashView ? (
          <div className="ue-filter-controls ue-filter-controls--gallery">
            <div className="ue-pill-group">
              <button
                className={`ue-pill ${selectedCategory === "" ? "active" : ""}`}
                onClick={() => onCategoryChange("")}
              >
                {t("galleryAllCategories")}
              </button>
              {topCategories.map((category) => (
                <button
                  key={category}
                  className={`ue-pill ${selectedCategory === category ? "active" : ""}`}
                  onClick={() => onCategoryChange(category)}
                >
                  {category}
                </button>
              ))}
              {(context?.categories?.length ?? 0) > 8 ? (
                <button className="ue-pill ue-pill--with-icon" onClick={() => setShowCategoryPicker(true)}>
                  <span>{t("galleryMoreCategories")}</span>
                  <ChevronDown size={13} />
                </button>
              ) : null}
            </div>

            <div className="ue-segmented-control">
              <button
                className={sortBy === "created_at" ? "active" : ""}
                onClick={() => onSortByChange("created_at")}
              >
                {t("gallerySortNewest")}
              </button>
              <button
                className={sortBy === "filename" ? "active" : ""}
                onClick={() => onSortByChange("filename")}
              >
                {t("gallerySortName")}
              </button>
              <button
                className={sortBy === "size" ? "active" : ""}
                onClick={() => onSortByChange("size")}
              >
                {t("gallerySortSize")}
              </button>
            </div>

            <div className="ue-segmented-control ue-segmented-control--compact">
              <button
                className={sortOrder === "desc" ? "active" : ""}
                onClick={() => onSortOrderChange("desc")}
              >
                {t("gallerySortDesc")}
              </button>
              <button
                className={sortOrder === "asc" ? "active" : ""}
                onClick={() => onSortOrderChange("asc")}
              >
                {t("gallerySortAsc")}
              </button>
            </div>

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

            {dateFrom || dateTo ? (
              <button
                className="ue-icon-action"
                onClick={() => {
                  onDateFromChange("");
                  onDateToChange("");
                  onPageChange(1);
                }}
                aria-label={t("galleryDateClear")}
                title={t("galleryDateClear")}
              >
                <CalendarX size={14} />
              </button>
            ) : null}

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

            <button
              className={`ue-chip-toggle ue-chip-toggle--icon ${favoritesOnly ? "active" : ""}`}
              onClick={() => onFavoritesOnlyChange(!favoritesOnly)}
              aria-label={t("galleryPinnedOnly")}
              title={t("galleryPinnedOnly")}
            >
              <Pin size={13} />
            </button>
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
            {writableSources.length > 0 ? (
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
            ) : null}
          </div>
          ) : null}
        </div>

        {importMessage ? <div className="ue-inline-success">{importMessage}</div> : null}
        {error ? <div className="ue-inline-error">{error}</div> : null}

        {selectionMode ? (
          <div className="ue-bulkbar ue-bulkbar--top">
            <div className="ue-bulkbar-status">
              <div className="ue-bulkbar-count">
                <CheckSquare size={16} />
                <strong>{t("bulkSelected", { count: selectedCount })}</strong>
              </div>
              <span>{selectedSubfolder || t("galleryOutputFolder")}</span>
              <p>{t("bulkSelectionHint")}</p>
            </div>

            <div className="ue-bulkbar-main">
              <div className="ue-bulkbar-quick-actions" aria-label={t("bulkActions")}>
                <button
                  className="ue-icon-action"
                  onClick={selectAllVisible}
                  aria-label={t("bulkSelectVisible")}
                  title={t("bulkSelectVisible")}
                >
                  <CheckSquare size={14} />
                </button>
                <button
                  className="ue-icon-action"
                  onClick={clearSelection}
                  aria-label={t("bulkClear")}
                  title={t("bulkClear")}
                >
                  <Square size={14} />
                </button>
                <button
                  className="ue-icon-action"
                  onClick={() => void onBatchUpdateImages(pageSelectedPaths, { pinned: true })}
                  aria-label={t("bulkPin")}
                  title={t("bulkPin")}
                  disabled={!hasSelection}
                >
                  <Pin size={14} />
                </button>
                <button
                  className="ue-icon-action"
                  onClick={() => void onBatchUpdateImages(pageSelectedPaths, { pinned: false })}
                  aria-label={t("bulkUnpin")}
                  title={t("bulkUnpin")}
                  disabled={!hasSelection}
                >
                  <Pin size={14} />
                </button>
                <button
                  className="ue-icon-action"
                  onClick={() => setBoardPickerPaths(pageSelectedPaths)}
                  aria-label={t("bulkAddToBoard")}
                  title={t("bulkAddToBoard")}
                  disabled={!hasSelection}
                >
                  <FolderPlus size={14} />
                </button>
                {selectedBoard ? (
                  <button
                    className="ue-icon-action"
                    onClick={() => void handleRemoveFromSelectedBoard()}
                    aria-label={t("bulkRemoveFromBoard")}
                    title={t("bulkRemoveFromBoard")}
                    disabled={!hasSelection}
                  >
                    <FolderMinus size={14} />
                  </button>
                ) : null}
                <button
                  className="ue-icon-action ue-icon-action--danger"
                  onClick={() => void handleBatchDelete()}
                  aria-label={t("bulkDelete")}
                  title={t("bulkDelete")}
                  disabled={!hasSelection}
                >
                  <Trash2 size={14} />
                </button>
              </div>

              <div className="ue-bulkbar-tools">
                <div className="ue-bulk-tool">
                  <span className="ue-bulk-tool-title">
                    <Tag size={13} />
                    {t("bulkSetCategory")}
                  </span>
                  <div className="ue-bulk-tool-field">
                    <label className="ue-select-field ue-select-field--input">
                      <input
                        value={bulkCategory}
                        onChange={(event) => setBulkCategory(event.target.value)}
                        placeholder={t("galleryCategoryPlaceholder")}
                      />
                    </label>
                    <button
                      className="ue-icon-action ue-icon-action--filled"
                      onClick={() => void onBatchUpdateImages(pageSelectedPaths, { category: bulkCategory })}
                      aria-label={t("bulkSetCategory")}
                      title={t("bulkSetCategory")}
                      disabled={!hasSelection || !bulkCategory.trim()}
                    >
                      <Check size={14} />
                    </button>
                  </div>
                </div>

                <div className="ue-bulk-tool">
                  <span className="ue-bulk-tool-title">
                    <ImageIcon size={13} />
                    {t("bulkMoveTo")}
                  </span>
                  <div className="ue-bulk-tool-field">
                    <label className="ue-select-field ue-select-field--input">
                      <select
                        value={bulkTargetSubfolder}
                        onChange={(event) => setBulkTargetSubfolder(event.target.value)}
                      >
                        {targetFolderOptions
                          .filter((option) => option.value !== selectedSubfolder)
                          .map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                      </select>
                    </label>
                    <button
                      className="ue-icon-action ue-icon-action--filled"
                      onClick={() => void handleBatchMove()}
                      aria-label={t("bulkMoveTo")}
                      title={t("bulkMoveTo")}
                      disabled={!hasSelection || !bulkTargetSubfolder}
                    >
                      <Check size={14} />
                    </button>
                  </div>
                </div>

                <div className="ue-bulk-tool ue-bulk-tool--rename">
                  <span className="ue-bulk-tool-title">
                    <PencilLine size={13} />
                    {t("bulkRenameApply")}
                  </span>
                  <div className="ue-bulk-tool-field">
                    <label className="ue-select-field ue-select-field--input ue-bulk-rename-field">
                      <input
                        value={bulkRenameTemplate}
                        onChange={(event) => setBulkRenameTemplate(event.target.value)}
                        placeholder={t("bulkRenameTemplatePlaceholder")}
                      />
                    </label>
                    <label className="ue-select-field ue-bulk-number-field">
                      <span>{t("bulkRenameStart")}</span>
                      <input
                        type="number"
                        min={0}
                        value={bulkRenameStart}
                        onChange={(event) => setBulkRenameStart(Number(event.target.value) || 0)}
                      />
                    </label>
                    <label className="ue-select-field ue-bulk-number-field">
                      <span>{t("bulkRenamePadding")}</span>
                      <input
                        type="number"
                        min={1}
                        max={8}
                        value={bulkRenamePadding}
                        onChange={(event) => setBulkRenamePadding(Number(event.target.value) || 1)}
                      />
                    </label>
                    <button
                      className="ue-icon-action ue-icon-action--accent"
                      onClick={() => void handleBatchRename()}
                      aria-label={t("bulkRenameApply")}
                      title={t("bulkRenameRuleHint")}
                      disabled={!hasSelection || !bulkRenameTemplate.trim()}
                    >
                      <PencilLine size={13} />
                    </button>
                  </div>
                </div>
              </div>

              <div className="ue-bulkbar-note">
                <strong>{t("bulkRenameRuleTitle")}</strong>
                <span>{t("bulkRenameRuleHint")}</span>
              </div>
            </div>
          </div>
        ) : null}

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
            <div className="ue-trash-list">
              {trashItems.map((item) => (
                <article key={item.id} className="ue-trash-card">
                  <div className="ue-trash-card-main">
                    {item.kind === "image" && item.thumb_url ? (
                      <img src={item.thumb_url} alt={item.name} />
                    ) : (
                      <div className="ue-trash-card-icon">
                        {item.kind === "folder" ? <FolderIcon size={22} /> : <Trash2 size={22} />}
                      </div>
                    )}
                    <div>
                      <h4>{item.name}</h4>
                      <p>{item.original_path}</p>
                    </div>
                  </div>
                  <div className="ue-trash-card-actions">
                    <button
                      className="ue-icon-action"
                      onClick={() => void onRestoreTrashItem(item.id)}
                      aria-label={t("trashRestore")}
                      title={t("trashRestore")}
                    >
                      <RotateCcw size={14} />
                    </button>
                    <button
                      className="ue-icon-action ue-icon-action--danger"
                      onClick={() => void onPurgeTrashItem(item.id)}
                      aria-label={t("trashDeleteForever")}
                      title={t("trashDeleteForever")}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </article>
              ))}
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
        ) : (
          <div
            ref={gridRef}
            className="ue-gallery-grid"
            style={{ gridTemplateColumns: `repeat(${effectiveColumns}, minmax(0, 1fr))` }}
            onPointerDown={handleSelectionPointerDown}
            onPointerMove={handleSelectionPointerMove}
            onPointerUp={handleSelectionPointerEnd}
            onPointerCancel={handleSelectionPointerEnd}
          >
            {images.map((image, index) => {
              const selected = pageSelectedPaths.includes(image.relative_path);

              return (
                <article
                  key={image.relative_path}
                  className={`ue-gallery-card ${selected ? "is-selected" : ""}`}
                  onContextMenu={(event) => handleOpenContextMenu(event, image)}
                  ref={(element) => {
                    cardRefs.current[image.relative_path] = element;
                  }}
                >
                  <div className="ue-gallery-media">
                    <GalleryCardImage
                      image={image}
                      priority={index < effectiveColumns * 2}
                      onOpenDetail={(nextImage) => {
                        if (selectionMode) {
                          toggleSelection(nextImage.relative_path);
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
                          toggleSelection(image.relative_path);
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
                          setBoardPickerPaths([image.relative_path]);
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
                      onClick={() => {
                        if (selectionMode) {
                          toggleSelection(image.relative_path);
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
                    onClick={() => {
                      if (selectionMode) {
                        toggleSelection(image.relative_path);
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
            {selectionMode && selectionBox ? (
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
        onSelect={onCategoryChange}
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
          className="ue-context-menu"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(event) => event.stopPropagation()}
        >
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
          <button
            className="ue-context-menu-item ue-context-menu-item--danger"
            onClick={() => {
              void handleContextDelete(contextMenu.image);
              setContextMenu(null);
            }}
          >
            <Trash2 size={14} />
            <span>{t("commonDelete")}</span>
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
