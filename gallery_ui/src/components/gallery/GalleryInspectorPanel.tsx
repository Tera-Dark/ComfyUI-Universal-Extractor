import { useMemo, useState } from "react";
import {
  Check,
  CheckSquare,
  FolderMinus,
  FolderPlus,
  Image as ImageIcon,
  PencilLine,
  Pin,
  Square,
  Tag,
  Trash2,
  X,
} from "lucide-react";

import { useI18n } from "../../i18n/I18nProvider";
import { useConfirm } from "../shared/ConfirmDialog";
import { useOperationStatus } from "../shared/OperationStatusCenter";
import type { BoardMutationResult, BoardSummary, MoveTargetOption } from "../../types/universal-gallery";
import { BoardPickerModal } from "./BoardPickerModal";

interface GalleryInspectorPanelProps {
  selectedPaths: string[];
  selectedSubfolder: string;
  selectedBoard: BoardSummary | null;
  boards: BoardSummary[];
  page: number;
  targetFolderOptions: MoveTargetOption[];
  onClose: () => void;
  onBatchUpdateImages: (relativePaths: string[], updates: Record<string, unknown>) => Promise<unknown>;
  onCreateBoard: (name: string, description?: string) => Promise<BoardMutationResult>;
  onUpdateBoardPins: (boardId: string, relativePaths: string[], pinned?: boolean) => Promise<unknown>;
  onMoveImages: (relativePaths: string[], targetSubfolder: string, targetSourceId?: string) => Promise<unknown>;
  onBatchRenameImages: (
    relativePaths: string[],
    template: string,
    startNumber: number,
    padding: number,
    currentPage: number,
  ) => Promise<unknown>;
  onDeleteImages: (relativePaths: string[]) => Promise<unknown>;
}

export const GalleryInspectorPanel = ({
  selectedPaths,
  selectedSubfolder,
  selectedBoard,
  boards,
  page,
  targetFolderOptions,
  onClose,
  onBatchUpdateImages,
  onCreateBoard,
  onUpdateBoardPins,
  onMoveImages,
  onBatchRenameImages,
  onDeleteImages,
}: GalleryInspectorPanelProps) => {
  const { t } = useI18n();
  const { confirm } = useConfirm();
  const { runOperation } = useOperationStatus();
  const [boardPickerPaths, setBoardPickerPaths] = useState<string[]>([]);
  const [bulkCategory, setBulkCategory] = useState("");
  const [bulkTargetSubfolder, setBulkTargetSubfolder] = useState("");
  const [bulkRenameTemplate, setBulkRenameTemplate] = useState("set-{page}-{n}");
  const [bulkRenameStart, setBulkRenameStart] = useState(1);
  const [bulkRenamePadding, setBulkRenamePadding] = useState(2);

  const selectedCount = selectedPaths.length;
  const currentTitle = t("bulkSelected", { count: selectedCount });
  const targetFolderChoices = useMemo(
    () => targetFolderOptions.filter((option) => option.value !== selectedSubfolder),
    [selectedSubfolder, targetFolderOptions],
  );

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

  const handleDeleteSelected = async () => {
    if (!selectedPaths.length) {
      return;
    }

    const approved = await confirm({
      title: t("bulkDelete"),
      message:
        selectedPaths.length >= 20
          ? t("bulkDeleteHeavyConfirm", { count: selectedPaths.length })
          : t("bulkDeleteConfirm", { count: selectedPaths.length }),
      tone: selectedPaths.length >= 20 ? "danger" : "warning",
      confirmLabel: t("commonDelete"),
      cancelLabel: t("libraryCancel"),
    });
    if (!approved) {
      return;
    }

    await runOperation(() => onDeleteImages(selectedPaths), {
      pending: t("operationDeleteImages"),
      success: t("imageDelete"),
      error: (error) => (error instanceof Error ? error.message : t("imageDeleteError")),
    });
    onClose();
  };

  const handleRemoveFromSelectedBoard = async () => {
    if (!selectedBoard || !selectedPaths.length) {
      return;
    }
    const approved = await confirm({
      title: t("bulkRemoveFromBoard"),
      message: t("bulkRemoveFromBoardConfirm", {
        count: selectedPaths.length,
        target: selectedBoard.name,
      }),
      tone: "warning",
      confirmLabel: t("bulkRemoveFromBoard"),
      cancelLabel: t("libraryCancel"),
    });
    if (!approved) {
      return;
    }

    await runOperation(() => onUpdateBoardPins(selectedBoard.id, selectedPaths, false), {
      pending: t("operationRemoveFromBoard"),
      success: t("bulkRemoveFromBoard"),
    });
    onClose();
  };

  const handleBatchMove = async () => {
    if (!selectedPaths.length || !bulkTargetSubfolder) {
      return;
    }

    const target = targetFolderOptions.find((option) => option.value === bulkTargetSubfolder);
    const approved = await confirm({
      title: t("bulkMoveTo"),
      message: t("bulkMoveConfirm", {
        count: selectedPaths.length,
        target: target?.label || bulkTargetSubfolder,
      }),
      tone: "warning",
      confirmLabel: t("folderMove"),
      cancelLabel: t("libraryCancel"),
    });
    if (!approved) {
      return;
    }

    await runOperation(() => onMoveImages(selectedPaths, bulkTargetSubfolder, target?.source_id), {
      pending: t("operationMoveImages"),
      success: t("operationMoveImagesSuccess"),
      error: (error) => (error instanceof Error ? error.message : t("operationMoveImages")),
    });
    onClose();
  };

  const handleBatchRename = async () => {
    if (!selectedPaths.length || !bulkRenameTemplate.trim()) {
      return;
    }

    const approved = await confirm({
      title: t("bulkRenameApply"),
      message: t("bulkRenameConfirm", {
        count: selectedPaths.length,
        target: bulkRenameTemplate.trim(),
      }),
      tone: "warning",
      confirmLabel: t("folderRename"),
      cancelLabel: t("libraryCancel"),
    });
    if (!approved) {
      return;
    }

    await onBatchRenameImages(
      selectedPaths,
      bulkRenameTemplate.trim(),
      bulkRenameStart,
      bulkRenamePadding,
      page,
    ).catch(() => undefined);
    onClose();
  };

  const handleBatchPin = async (pinned: boolean) => {
    if (!selectedPaths.length) {
      return;
    }
    const approved = await confirm({
      title: pinned ? t("bulkPin") : t("bulkUnpin"),
      message: pinned
        ? t("bulkPinConfirm", { count: selectedPaths.length })
        : t("bulkUnpinConfirm", { count: selectedPaths.length }),
      tone: "warning",
      confirmLabel: pinned ? t("bulkPin") : t("bulkUnpin"),
      cancelLabel: t("libraryCancel"),
    });
    if (!approved) {
      return;
    }

    await runOperation(() => onBatchUpdateImages(selectedPaths, { pinned }), {
      pending: t("operationUpdateImages"),
      success: t("operationUpdateImagesSuccess"),
    });
  };

  const handleBatchCategory = async () => {
    const category = bulkCategory.trim();
    if (!selectedPaths.length || !category) {
      return;
    }
    const approved = await confirm({
      title: t("bulkSetCategory"),
      message: t("bulkSetCategoryConfirm", {
        count: selectedPaths.length,
        target: category,
      }),
      tone: "warning",
      confirmLabel: t("commonConfirm"),
      cancelLabel: t("libraryCancel"),
    });
    if (!approved) {
      return;
    }

    await runOperation(() => onBatchUpdateImages(selectedPaths, { category }), {
      pending: t("operationUpdateImages"),
      success: t("operationUpdateImagesSuccess"),
    });
  };

  return (
    <>
      <button className="ue-inspector-backdrop" onClick={onClose} aria-label={t("bulkClear")} />
      <aside className="ue-gallery-inspector" aria-label={t("bulkActions")}>
        <div className="ue-gallery-inspector-head">
          <div>
            <span>{t("bulkActions")}</span>
            <strong title={currentTitle}>{currentTitle}</strong>
          </div>
          <button className="ue-icon-action" onClick={onClose} aria-label={t("bulkClear")} title={t("bulkClear")}>
            <X size={14} />
          </button>
        </div>

        <div className="ue-gallery-inspector-summary">
          <div className="ue-gallery-inspector-title">
            <CheckSquare size={16} />
            <strong>{currentTitle}</strong>
          </div>
          <span>{selectedSubfolder || t("galleryOutputFolder")}</span>
          <p>{t("bulkSelectionHint")}</p>
        </div>

        <div className="ue-gallery-inspector-quick-actions" aria-label={t("bulkActions")}>
          <button className="ue-icon-action" onClick={onClose} aria-label={t("bulkClear")} title={t("bulkClear")}>
            <Square size={14} />
          </button>
          <button className="ue-icon-action" onClick={() => void handleBatchPin(true)} aria-label={t("bulkPin")} title={t("bulkPin")}>
            <Pin size={14} />
          </button>
          <button className="ue-icon-action" onClick={() => void handleBatchPin(false)} aria-label={t("bulkUnpin")} title={t("bulkUnpin")}>
            <Pin size={14} />
          </button>
          <button className="ue-icon-action" onClick={() => setBoardPickerPaths(selectedPaths)} aria-label={t("bulkAddToBoard")} title={t("bulkAddToBoard")}>
            <FolderPlus size={14} />
          </button>
          {selectedBoard ? (
            <button className="ue-icon-action" onClick={() => void handleRemoveFromSelectedBoard()} aria-label={t("bulkRemoveFromBoard")} title={t("bulkRemoveFromBoard")}>
              <FolderMinus size={14} />
            </button>
          ) : null}
          <button className="ue-icon-action ue-icon-action--danger" onClick={() => void handleDeleteSelected()} aria-label={t("bulkDelete")} title={t("bulkDelete")}>
            <Trash2 size={14} />
          </button>
        </div>

        <div className="ue-gallery-inspector-tools">
          <div className="ue-bulk-tool">
            <span className="ue-bulk-tool-title">
              <Tag size={13} />
              {t("bulkSetCategory")}
            </span>
            <div className="ue-bulk-tool-field">
              <label className="ue-select-field ue-select-field--input">
                <input value={bulkCategory} onChange={(event) => setBulkCategory(event.target.value)} placeholder={t("galleryCategoryPlaceholder")} />
              </label>
              <button className="ue-icon-action ue-icon-action--filled" onClick={() => void handleBatchCategory()} aria-label={t("bulkSetCategory")} title={t("bulkSetCategory")} disabled={!bulkCategory.trim()}>
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
                <select value={bulkTargetSubfolder} onChange={(event) => setBulkTargetSubfolder(event.target.value)}>
                  <option value="" disabled>
                    {t("bulkMoveTo")}
                  </option>
                  {targetFolderChoices.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <button className="ue-icon-action ue-icon-action--filled" onClick={() => void handleBatchMove()} aria-label={t("bulkMoveTo")} title={t("bulkMoveTo")} disabled={!bulkTargetSubfolder}>
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
                <input value={bulkRenameTemplate} onChange={(event) => setBulkRenameTemplate(event.target.value)} placeholder={t("bulkRenameTemplatePlaceholder")} />
              </label>
              <label className="ue-select-field ue-bulk-number-field">
                <span>{t("bulkRenameStart")}</span>
                <input type="number" min={0} value={bulkRenameStart} onChange={(event) => setBulkRenameStart(Number(event.target.value) || 0)} />
              </label>
              <label className="ue-select-field ue-bulk-number-field">
                <span>{t("bulkRenamePadding")}</span>
                <input type="number" min={1} max={8} value={bulkRenamePadding} onChange={(event) => setBulkRenamePadding(Number(event.target.value) || 1)} />
              </label>
              <button className="ue-icon-action ue-icon-action--accent" onClick={() => void handleBatchRename()} aria-label={t("bulkRenameApply")} title={t("bulkRenameRuleHint")} disabled={!bulkRenameTemplate.trim()}>
                <PencilLine size={13} />
              </button>
            </div>
          </div>
        </div>

        <div className="ue-gallery-inspector-note">
          <strong>{t("bulkRenameRuleTitle")}</strong>
          <span>{t("bulkRenameRuleHint")}</span>
        </div>
      </aside>

      <BoardPickerModal
        open={boardPickerPaths.length > 0}
        boards={boards}
        selectedCount={boardPickerPaths.length}
        onClose={() => setBoardPickerPaths([])}
        onCreateBoard={onCreateBoard}
        onAddToBoard={handleAddToBoard}
      />
    </>
  );
};
