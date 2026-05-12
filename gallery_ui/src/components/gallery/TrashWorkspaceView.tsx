import type { PointerEvent, RefObject } from "react";
import { CheckSquare, Folder as FolderIcon, RotateCcw, Square, Trash2 } from "lucide-react";

import { useI18n } from "../../i18n/I18nProvider";
import type { TrashItem } from "../../types/universal-gallery";
import { formatCompactDate } from "../../utils/formatters";
import type { ContentViewMode } from "./galleryWorkspaceModel";
import type { SelectionBoxState } from "./gallerySelectionModel";

interface TrashWorkspaceViewProps {
  trashItems: TrashItem[];
  selectedCount: number;
  selectedTrashCount: number;
  hasSelection: boolean;
  pageSelectedPaths: string[];
  galleryViewMode: ContentViewMode;
  selectionEnabled: boolean;
  selectionBox: SelectionBoxState | null;
  isDraggingSelectionRef: RefObject<boolean>;
  cardRefs: RefObject<Record<string, HTMLElement | null>>;
  gridRef: RefObject<HTMLDivElement | null>;
  onSelectAllVisible: () => void;
  onClearSelection: () => void;
  onRestoreSelectedTrash: () => void;
  onPurgeSelectedTrash: () => void;
  onRestoreTrashItem: (id: string) => void;
  onPurgeTrashItem: (id: string) => void;
  onTrashContextMenu: (event: React.MouseEvent, item: TrashItem) => void;
  onImageSelectionClick: (id: string, event: Pick<React.MouseEvent, "shiftKey" | "ctrlKey" | "metaKey">) => void;
  onSelectionPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onSelectionPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onSelectionPointerEnd: (event?: PointerEvent<HTMLDivElement>) => void;
}

export const TrashWorkspaceView = ({
  trashItems,
  selectedCount,
  selectedTrashCount,
  hasSelection,
  pageSelectedPaths,
  galleryViewMode,
  selectionEnabled,
  selectionBox,
  isDraggingSelectionRef,
  cardRefs,
  gridRef,
  onSelectAllVisible,
  onClearSelection,
  onRestoreSelectedTrash,
  onPurgeSelectedTrash,
  onRestoreTrashItem,
  onPurgeTrashItem,
  onTrashContextMenu,
  onImageSelectionClick,
  onSelectionPointerDown,
  onSelectionPointerMove,
  onSelectionPointerEnd,
}: TrashWorkspaceViewProps) => {
  const { t } = useI18n();

  if (trashItems.length === 0) {
    return (
      <div className="ue-gallery-state ue-gallery-state--empty">
        <Trash2 size={44} strokeWidth={1.2} />
        <div>
          <h3>{t("trashEmptyTitle")}</h3>
          <p>{t("trashEmptyText")}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="ue-trash-workspace">
      <div className="ue-trash-toolbar">
        <div className="ue-trash-toolbar-copy">
          <strong>{t("bulkSelected", { count: selectedCount })}</strong>
          <span>{t("trashSelectionHint")}</span>
        </div>
        <div className="ue-trash-toolbar-actions">
          <button className="ue-secondary-btn" onClick={onSelectAllVisible}>
            <CheckSquare size={14} />
            <span>{t("trashSelectAll")}</span>
          </button>
          <button className="ue-secondary-btn" onClick={onClearSelection} disabled={!hasSelection}>
            <Square size={14} />
            <span>{t("trashClearSelection")}</span>
          </button>
          <button
            className="ue-secondary-btn ue-secondary-btn--accent"
            onClick={onRestoreSelectedTrash}
            disabled={!selectedTrashCount}
          >
            <RotateCcw size={14} />
            <span>{t("trashRestoreSelected")}</span>
          </button>
          <button
            className="ue-secondary-btn ue-secondary-btn--danger"
            onClick={onPurgeSelectedTrash}
            disabled={!selectedTrashCount}
          >
            <Trash2 size={14} />
            <span>{t("trashDeleteSelectedForever")}</span>
          </button>
        </div>
      </div>

      <div
        ref={gridRef}
        className={`ue-trash-list ue-trash-list--selectable ${galleryViewMode === "grid" ? "ue-trash-list--grid" : ""}`}
        onPointerDown={onSelectionPointerDown}
        onPointerMove={onSelectionPointerMove}
        onPointerUp={onSelectionPointerEnd}
        onPointerCancel={onSelectionPointerEnd}
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
              onContextMenu={(event) => onTrashContextMenu(event, item)}
              onClick={(event) => {
                if (isDraggingSelectionRef.current) {
                  return;
                }
                onImageSelectionClick(item.id, event);
              }}
            >
              <button
                className={`ue-trash-card-check ${selected ? "active" : ""}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onImageSelectionClick(item.id, event);
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
                    onRestoreTrashItem(item.id);
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
                    onPurgeTrashItem(item.id);
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
  );
};
