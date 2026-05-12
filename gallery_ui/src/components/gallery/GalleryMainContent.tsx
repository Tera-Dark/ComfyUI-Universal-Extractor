import type { FormEvent, MouseEvent, MutableRefObject, RefObject } from "react";
import { createPortal } from "react-dom";
import {
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  CornerDownRight,
  Eye,
  FolderPlus,
  Image as ImageIcon,
  Pin,
  Send,
  Square,
} from "lucide-react";

import { useI18n } from "../../i18n/I18nProvider";
import type { ImageRecord } from "../../types/universal-gallery";
import { formatCompactDate, formatFileSize } from "../../utils/formatters";
import { GalleryCardImage } from "./GalleryCardImage";
import { getGalleryImageUrl } from "./galleryImagePrefetch";
import type { SelectionBoxState } from "./gallerySelectionModel";
import type { ContentViewMode } from "./galleryWorkspaceModel";
import type { VirtualMasonryItem } from "./useVirtualMasonry";

interface MasonryLayout {
  items: VirtualMasonryItem[];
  totalHeight: number;
  measureElement: (element: HTMLElement | null) => void;
}

interface GalleryMainContentProps {
  images: ImageRecord[];
  galleryViewMode: ContentViewMode;
  selectionMode: boolean;
  selectionEnabled: boolean;
  selectionBox: SelectionBoxState | null;
  pageSelectedPaths: string[];
  page: number;
  totalPages: number;
  total: number;
  effectiveColumns: number;
  masonryLayout: MasonryLayout;
  gridRef: RefObject<HTMLDivElement | null>;
  cardRefs: MutableRefObject<Record<string, HTMLElement | null>>;
  isDraggingSelectionRef: MutableRefObject<boolean>;
  onOpenDetail: (image: ImageRecord) => void;
  onOpenWorkflow: (image: ImageRecord) => Promise<void>;
  onUpdateImageState: (relativePath: string, updates: Record<string, unknown>) => Promise<void>;
  onBoardPickerPathsChange: (relativePaths: string[]) => void;
  onImageSelectionClick: (
    relativePath: string,
    event?: Pick<MouseEvent, "shiftKey" | "ctrlKey" | "metaKey">,
  ) => void;
  onOpenContextMenu: (event: MouseEvent, image: ImageRecord) => void;
  onSelectAllVisible: () => void;
  onPageChange: (page: number) => void;
  onPageJump: (formData: FormData) => void;
}

const SelectionBoxOverlay = ({ selectionEnabled, selectionBox }: { selectionEnabled: boolean; selectionBox: SelectionBoxState | null }) => {
  if (!selectionEnabled || !selectionBox || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="ue-selection-box"
      style={{
        left: Math.min(selectionBox.startX, selectionBox.currentX),
        top: Math.min(selectionBox.startY, selectionBox.currentY),
        width: Math.abs(selectionBox.currentX - selectionBox.startX),
        height: Math.abs(selectionBox.currentY - selectionBox.startY),
      }}
    />,
    document.body,
  );
};

export const GalleryMainContent = ({
  images,
  galleryViewMode,
  selectionMode,
  selectionEnabled,
  selectionBox,
  pageSelectedPaths,
  page,
  totalPages,
  total,
  effectiveColumns,
  masonryLayout,
  gridRef,
  cardRefs,
  isDraggingSelectionRef,
  onOpenDetail,
  onOpenWorkflow,
  onUpdateImageState,
  onBoardPickerPathsChange,
  onImageSelectionClick,
  onOpenContextMenu,
  onSelectAllVisible,
  onPageChange,
  onPageJump,
}: GalleryMainContentProps) => {
  const { t } = useI18n();

  const openBoardPickerForImage = (image: ImageRecord, selected: boolean) => {
    if (selected && pageSelectedPaths.length > 1) {
      onBoardPickerPathsChange(pageSelectedPaths);
      return;
    }
    onBoardPickerPathsChange([image.relative_path]);
  };

  const handlePageJumpSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onPageJump(new FormData(event.currentTarget));
  };

  if (images.length === 0) {
    return (
      <div className="ue-gallery-state ue-gallery-state--empty">
        <ImageIcon size={44} strokeWidth={1.2} />
        <div>
          <h3>{t("galleryEmptyTitle")}</h3>
          <p>{t("galleryEmptyText")}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {galleryViewMode === "list" ? (
        <div
          className="ue-gallery-selection-surface"
        >
          <div
            ref={gridRef}
            className="ue-gallery-list ue-gallery-list--selectable"
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
                  onContextMenu={(event) => onOpenContextMenu(event, image)}
                  onClick={(event) => {
                    if (selectionMode) {
                      onImageSelectionClick(image.relative_path, event);
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
                      onImageSelectionClick(image.relative_path, event);
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
                        onImageSelectionClick(image.relative_path, event);
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
                        openBoardPickerForImage(image, selected);
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
          </div>
          <SelectionBoxOverlay selectionEnabled={selectionEnabled} selectionBox={selectionBox} />
        </div>
      ) : (
        <div
          className="ue-gallery-selection-surface"
        >
          <div
            ref={gridRef}
            className="ue-gallery-grid ue-gallery-grid--virtual"
            style={{ height: `${masonryLayout.totalHeight}px` }}
          >
            {masonryLayout.items.map(({ image, index, top, left, width, lane }) => {
              const selected = pageSelectedPaths.includes(image.relative_path);

              return (
                <article
                  key={image.relative_path}
                  className={`ue-gallery-card ${selected ? "is-selected" : ""}`}
                  data-index={index}
                  data-lane={lane}
                  style={{ top: `${top}px`, left: `${left}px`, width: `${width}px` }}
                  onContextMenu={(event) => onOpenContextMenu(event, image)}
                  ref={(element) => {
                    cardRefs.current[image.relative_path] = element;
                    masonryLayout.measureElement(element);
                  }}
                >
                <div className="ue-gallery-media">
                  <GalleryCardImage
                    image={image}
                    priority={index < effectiveColumns * 2}
                    onOpenDetail={(nextImage, event) => {
                      if (selectionMode) {
                        onImageSelectionClick(nextImage.relative_path, event);
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
                        onImageSelectionClick(image.relative_path, event);
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
                        openBoardPickerForImage(image, selected);
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
                        onImageSelectionClick(image.relative_path, event);
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
                      onImageSelectionClick(image.relative_path, event);
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
          </div>
          <SelectionBoxOverlay selectionEnabled={selectionEnabled} selectionBox={selectionBox} />
        </div>
      )}

      <div className="ue-pagination">
        <div className="ue-pagination-meta">
          <span>{t("galleryPage", { page, totalPages })}</span>
          <i aria-hidden="true">/</i>
          <span>
            {total} {t("galleryStatsTotal")}
          </span>
        </div>

        <div className="ue-pagination-actions">
          {selectionMode ? (
            <button aria-label={t("bulkSelectVisible")} title={t("bulkSelectVisible")} onClick={onSelectAllVisible}>
              <CheckSquare size={14} />
            </button>
          ) : null}
          <button disabled={page <= 1} onClick={() => onPageChange(page - 1)} aria-label={t("galleryPrevious")} title={t("galleryPrevious")}>
            <ChevronLeft size={14} />
          </button>
          <button disabled={page >= totalPages} onClick={() => onPageChange(page + 1)} aria-label={t("galleryNext")} title={t("galleryNext")}>
            <ChevronRight size={14} />
          </button>
          <form key={page} className="ue-pagination-jump" onSubmit={handlePageJumpSubmit}>
            <label className="ue-select-field ue-pagination-jump-field">
              <span>{t("galleryJumpTo")}</span>
              <input name="page" type="number" min={1} max={totalPages} defaultValue={page} aria-label={t("galleryJumpTo")} />
            </label>
            <button type="submit" aria-label={t("galleryJump")} title={t("galleryJump")}>
              <CornerDownRight size={14} />
            </button>
          </form>
        </div>
      </div>
    </>
  );
};
