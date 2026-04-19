import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  Check,
  CheckSquare,
  ExternalLink,
  Folder as FolderIcon,
  Heart,
  Image as ImageIcon,
  RotateCcw,
  Send,
  Square,
  Star,
  Tag,
  Trash2,
} from "lucide-react";

import { useI18n } from "../../i18n/I18nProvider";
import { useConfirm } from "../shared/ConfirmDialog";
import { useToast } from "../shared/ToastViewport";
import type { GalleryContext, ImageRecord, TrashItem } from "../../types/universal-gallery";
import { formatCompactDate, formatFileSize } from "../../utils/formatters";
import { CategoryPickerModal } from "./CategoryPickerModal";

const GalleryCardImage = ({
  image,
  onOpenDetail,
}: {
  image: ImageRecord;
  onOpenDetail: (image: ImageRecord) => void;
}) => {
  const [loaded, setLoaded] = useState(false);

  return (
    <div className={`ue-gallery-image-shell ${loaded ? "is-loaded" : ""}`}>
      <img
        src={image.thumb_url || image.url}
        alt={image.title || image.filename}
        loading="lazy"
        onLoad={() => setLoaded(true)}
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
  targetFolderOptions: string[];
  onOpenDetail: (image: ImageRecord) => void;
  onPageChange: (page: number) => void;
  onCategoryChange: (category: string) => void;
  onFavoritesOnlyChange: (value: boolean) => void;
  onSortByChange: (value: string) => void;
  onSortOrderChange: (value: string) => void;
  onGridColumnsChange: (value: number) => void;
  onOpenWorkflow: (image: ImageRecord) => Promise<void>;
  onSelectionChange: (relativePaths: string[]) => void;
  onUpdateImageState: (relativePath: string, updates: Record<string, unknown>) => Promise<void>;
  onBatchUpdateImages: (relativePaths: string[], updates: Record<string, unknown>) => Promise<unknown>;
  onMoveImages: (relativePaths: string[], targetSubfolder: string) => Promise<unknown>;
  onDeleteImages: (relativePaths: string[]) => Promise<unknown>;
  onImportFiles: (files: File[]) => Promise<unknown>;
  onRestoreTrashItem: (id: string) => Promise<void>;
  onPurgeTrashItem: (id: string) => Promise<void>;
}

interface ImageContextMenuState {
  image: ImageRecord;
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
  onOpenDetail,
  onPageChange,
  onCategoryChange,
  onFavoritesOnlyChange,
  onSortByChange,
  onSortOrderChange,
  onGridColumnsChange,
  onOpenWorkflow,
  onSelectionChange,
  onUpdateImageState,
  onBatchUpdateImages,
  onMoveImages,
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
  const [showCategoryPicker, setShowCategoryPicker] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  const [contextMenu, setContextMenu] = useState<ImageContextMenuState | null>(null);
  const dragDepthRef = useRef(0);

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

  const effectiveColumns = useMemo(() => {
    if (viewportWidth <= 640) return 1;
    if (viewportWidth <= 960) return Math.min(gridColumns, 2);
    if (viewportWidth <= 1280) return Math.min(gridColumns, 3);
    if (viewportWidth <= 1600) return Math.min(gridColumns, 4);
    return gridColumns;
  }, [gridColumns, viewportWidth]);

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
      await onImportFiles(files);
    }
  };

  const toggleSelection = (relativePath: string) => {
    if (selectedImagePaths.includes(relativePath)) {
      onSelectionChange(selectedImagePaths.filter((path) => path !== relativePath));
      return;
    }

    onSelectionChange([...selectedImagePaths, relativePath]);
  };

  const selectAllVisible = () => {
    onSelectionChange(images.map((image) => image.relative_path));
  };

  const clearSelection = () => {
    onSelectionChange([]);
  };

  const handleBatchDelete = async () => {
    if (!selectedImagePaths.length) {
      return;
    }

    const approved = await confirm({
      title: t("bulkDelete"),
      message:
        selectedImagePaths.length >= 20
          ? t("bulkDeleteHeavyConfirm", { count: selectedImagePaths.length })
          : t("bulkDeleteConfirm", { count: selectedImagePaths.length }),
      tone: selectedImagePaths.length >= 20 ? "danger" : "warning",
      confirmLabel: t("commonDelete"),
      cancelLabel: t("libraryCancel"),
    });
    if (!approved) {
      return;
    }

    await onDeleteImages(selectedImagePaths);
    clearSelection();
  };

  const handleBatchMove = async () => {
    if (!selectedImagePaths.length) {
      return;
    }

    await onMoveImages(selectedImagePaths, bulkTargetSubfolder);
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
            <p className="ue-filter-kicker">{isTrashView ? (t("trashTitle")) : (selectedSubfolder || t("galleryOutputFolder"))}</p>
            <div className="ue-filter-summary">
              <strong>{total}</strong>
              <span>{t("galleryFilterResult", { count: total })}</span>
              {favoritesOnly ? <em>{t("galleryFavoriteOnly")}</em> : null}
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

            <label className="ue-select-field">
              <span>{t("galleryColumns")}</span>
              <select
                value={String(gridColumns)}
                onChange={(event) => onGridColumnsChange(Number(event.target.value))}
              >
                {Array.from({ length: 6 }, (_, index) => index + 3).map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </select>
            </label>

            <button
              className={`ue-chip-toggle ${favoritesOnly ? "active" : ""}`}
              onClick={() => onFavoritesOnlyChange(!favoritesOnly)}
            >
              <Star size={13} />
              <span>{t("galleryFavoriteOnly")}</span>
            </button>
          </div>
          ) : null}
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
                    <button className="ue-secondary-btn" onClick={() => void onRestoreTrashItem(item.id)}>
                      <RotateCcw size={14} />
                      <span>{t("trashRestore")}</span>
                    </button>
                    <button className="ue-secondary-btn ue-danger-btn" onClick={() => void onPurgeTrashItem(item.id)}>
                      <Trash2 size={14} />
                      <span>{t("trashDeleteForever")}</span>
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
            className="ue-gallery-grid"
            style={{ gridTemplateColumns: `repeat(${effectiveColumns}, minmax(0, 1fr))` }}
          >
            {images.map((image) => {
              const selected = selectedImagePaths.includes(image.relative_path);

              return (
                <article
                  key={image.relative_path}
                  className={`ue-gallery-card ${selected ? "is-selected" : ""}`}
                  onContextMenu={(event) => handleOpenContextMenu(event, image)}
                >
                  <div className="ue-gallery-media">
                    <GalleryCardImage image={image} onOpenDetail={onOpenDetail} />

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
                        aria-label={selected ? "Deselect image" : "Select image"}
                      >
                        {selected ? <CheckSquare size={13} /> : <Square size={13} />}
                      </button>

                      <button
                        className={`ue-favorite-btn ${image.favorite ? "active" : ""}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          void onUpdateImageState(image.relative_path, { favorite: !image.favorite });
                        }}
                        aria-label={image.favorite ? t("galleryUnfavorite") : t("galleryFavorite")}
                      >
                        <Heart size={13} fill={image.favorite ? "currentColor" : "none"} />
                      </button>
                    </div>

                    <button className="ue-gallery-open" onClick={() => onOpenDetail(image)}>
                      {t("galleryInspect")}
                    </button>
                  </div>

                  <button className="ue-gallery-body" onClick={() => onOpenDetail(image)}>
                    <span className="ue-gallery-title" title={image.title || image.filename}>
                      {image.title || image.filename}
                    </span>
                    <span className="ue-gallery-meta">
                      {formatCompactDate(image.created_at)}
                      <i aria-hidden="true">·</i>
                      {formatFileSize(image.size)}
                      {image.category ? (
                        <>
                          <i aria-hidden="true">·</i>
                          {image.category}
                        </>
                      ) : null}
                    </span>
                  </button>
                </article>
              );
            })}
          </div>
        )}

        {images.length > 0 ? (
          <div className="ue-pagination">
            <div className="ue-pagination-meta">
              <span>{t("galleryPage", { page, totalPages })}</span>
              <i aria-hidden="true">·</i>
              <span>{total} {t("galleryStatsTotal")}</span>
            </div>

            <div className="ue-pagination-actions">
              <button onClick={selectAllVisible}>{t("bulkSelectVisible")}</button>
              <button disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
                {t("galleryPrevious")}
              </button>
              <button disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>
                {t("galleryNext")}
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
                <button type="submit">{t("galleryJump")}</button>
              </form>
            </div>
          </div>
        ) : null}

        {selectedImagePaths.length > 0 ? (
          <div className="ue-bulkbar">
            <div className="ue-bulkbar-info">
              <strong>{t("bulkSelected", { count: selectedImagePaths.length })}</strong>
              <span>{selectedSubfolder || t("galleryOutputFolder")}</span>
            </div>

            <div className="ue-bulkbar-actions">
              <button
                className="ue-secondary-btn"
                onClick={() => void onBatchUpdateImages(selectedImagePaths, { favorite: true })}
                aria-label={t("bulkFavorite")}
              >
                <Star size={13} />
              </button>
              <button
                className="ue-secondary-btn"
                onClick={() => void onBatchUpdateImages(selectedImagePaths, { favorite: false })}
                aria-label={t("bulkUnfavorite")}
              >
                <Heart size={13} />
              </button>
              <label className="ue-select-field ue-select-field--input">
                <Tag size={13} />
                <input
                  value={bulkCategory}
                  onChange={(event) => setBulkCategory(event.target.value)}
                  placeholder={t("galleryCategoryPlaceholder")}
                />
              </label>
              <button
                className="ue-secondary-btn"
                onClick={() => void onBatchUpdateImages(selectedImagePaths, { category: bulkCategory })}
                aria-label={t("bulkSetCategory")}
              >
                <Check size={13} />
              </button>
              <label className="ue-select-field ue-select-field--input">
                <span>{t("bulkMoveTo")}</span>
                <select
                  value={bulkTargetSubfolder}
                  onChange={(event) => setBulkTargetSubfolder(event.target.value)}
                >
                  <option value="">{t("galleryOutputFolder")}</option>
                  {targetFolderOptions
                    .filter((option) => option !== selectedSubfolder)
                    .map((option) => (
                      <option key={option || "__root"} value={option}>
                        {option || "./"}
                      </option>
                    ))}
                </select>
              </label>
              <button className="ue-secondary-btn" onClick={() => void handleBatchMove()} aria-label={t("bulkMoveTo")}>
                <ImageIcon size={13} />
              </button>
              <button className="ue-secondary-btn" onClick={clearSelection} aria-label={t("bulkClear")}>
                <Square size={13} />
              </button>
              <button className="ue-secondary-btn ue-danger-btn" onClick={() => void handleBatchDelete()}>
                <Trash2 size={13} />
              </button>
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
    </div>
  );
};
