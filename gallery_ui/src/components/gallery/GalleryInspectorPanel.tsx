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
import { useToast } from "../shared/ToastViewport";
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
  const { pushToast } = useToast();
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
    await onUpdateBoardPins(boardId, boardPickerPaths, true);
    pushToast(t("boardAddSuccess", { count: boardPickerPaths.length }), "success");
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

    await onDeleteImages(selectedPaths);
    onClose();
  };

  const handleRemoveFromSelectedBoard = async () => {
    if (!selectedBoard || !selectedPaths.length) {
      return;
    }
    await onUpdateBoardPins(selectedBoard.id, selectedPaths, false);
    onClose();
  };

  const handleBatchMove = async () => {
    if (!selectedPaths.length || !bulkTargetSubfolder) {
      return;
    }

    const target = targetFolderOptions.find((option) => option.value === bulkTargetSubfolder);
    await onMoveImages(selectedPaths, bulkTargetSubfolder, target?.source_id);
    onClose();
  };

  const handleBatchRename = async () => {
    if (!selectedPaths.length || !bulkRenameTemplate.trim()) {
      return;
    }

    await onBatchRenameImages(
      selectedPaths,
      bulkRenameTemplate.trim(),
      bulkRenameStart,
      bulkRenamePadding,
      page,
    );
    onClose();
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
          <button className="ue-icon-action" onClick={() => void onBatchUpdateImages(selectedPaths, { pinned: true })} aria-label={t("bulkPin")} title={t("bulkPin")}>
            <Pin size={14} />
          </button>
          <button className="ue-icon-action" onClick={() => void onBatchUpdateImages(selectedPaths, { pinned: false })} aria-label={t("bulkUnpin")} title={t("bulkUnpin")}>
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
              <button className="ue-icon-action ue-icon-action--filled" onClick={() => void onBatchUpdateImages(selectedPaths, { category: bulkCategory })} aria-label={t("bulkSetCategory")} title={t("bulkSetCategory")} disabled={!bulkCategory.trim()}>
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
