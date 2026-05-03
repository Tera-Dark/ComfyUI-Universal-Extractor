import { useMemo, useState } from "react";
import {
  Check,
  CheckSquare,
  ClipboardCopy,
  ExternalLink,
  FileJson,
  Eye,
  FolderMinus,
  FolderPlus,
  Image as ImageIcon,
  PencilLine,
  Pin,
  Send,
  Square,
  Tag,
  Trash2,
  X,
} from "lucide-react";

import { useI18n } from "../../i18n/I18nProvider";
import { useConfirm } from "../shared/ConfirmDialog";
import { useToast } from "../shared/ToastViewport";
import { galleryApi } from "../../services/galleryApi";
import type { BoardMutationResult, BoardSummary, ImageRecord, MoveTargetOption } from "../../types/universal-gallery";
import { formatCompactDate, formatFileSize } from "../../utils/formatters";
import { getPositivePromptText } from "../../utils/metadata";
import { BoardPickerModal } from "./BoardPickerModal";
import { MetadataViewerModal } from "./MetadataViewerModal";

interface GalleryInspectorPanelProps {
  selectedImages: ImageRecord[];
  selectedPaths: string[];
  selectedSubfolder: string;
  selectedBoard: BoardSummary | null;
  boards: BoardSummary[];
  page: number;
  targetFolderOptions: MoveTargetOption[];
  onClose: () => void;
  onOpenDetail: (image: ImageRecord) => void;
  onOpenWorkflow: (image: ImageRecord) => Promise<void>;
  onUpdateImageState: (relativePath: string, updates: Record<string, unknown>) => Promise<void>;
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

const getGalleryImageUrl = (image: ImageRecord) => image.thumb_url || image.url;
const getAbsoluteImageUrl = (image: ImageRecord) =>
  new URL(image.original_url || image.url, window.location.origin).toString();

export const GalleryInspectorPanel = ({
  selectedImages,
  selectedPaths,
  selectedSubfolder,
  selectedBoard,
  boards,
  page,
  targetFolderOptions,
  onClose,
  onOpenDetail,
  onOpenWorkflow,
  onUpdateImageState,
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
  const [metadataViewerImage, setMetadataViewerImage] = useState<ImageRecord | null>(null);

  const selectedCount = selectedPaths.length;
  const primaryImage = selectedImages.length === 1 ? selectedImages[0] : null;
  const currentTitle = primaryImage
    ? primaryImage.title || primaryImage.filename
    : t("bulkSelected", { count: selectedCount });
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

  const handleCopyPositivePrompt = async (image: ImageRecord) => {
    try {
      const metadata = await galleryApi.getImageMetadata(image.relative_path);
      const prompt = getPositivePromptText(metadata);
      if (!prompt) {
        pushToast(t("metadataNoPositivePrompt"), "info");
        return;
      }
      await navigator.clipboard.writeText(prompt);
      pushToast(t("metadataCopyPositiveSuccess"), "success");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t("metadataLoadError"), "error");
    }
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
      <aside className="ue-gallery-inspector" aria-label={primaryImage ? t("galleryInspect") : t("bulkActions")}>
        <div className="ue-gallery-inspector-head">
          <div>
            <span>{primaryImage ? t("galleryInspect") : t("bulkActions")}</span>
            <strong title={currentTitle}>{currentTitle}</strong>
          </div>
          <button className="ue-icon-action" onClick={onClose} aria-label={t("bulkClear")} title={t("bulkClear")}>
            <X size={14} />
          </button>
        </div>

        {primaryImage ? (
          <>
            <div className="ue-gallery-inspector-preview">
              <img src={getGalleryImageUrl(primaryImage)} alt={primaryImage.title || primaryImage.filename} />
            </div>
            <div className="ue-gallery-inspector-summary">
              <div className="ue-gallery-inspector-title">
                <CheckSquare size={16} />
                <strong title={primaryImage.title || primaryImage.filename}>
                  {primaryImage.title || primaryImage.filename}
                </strong>
              </div>
              <span title={primaryImage.relative_path}>{primaryImage.relative_path}</span>
              {primaryImage.palette?.length ? (
                <div className="ue-gallery-inspector-palette" aria-label={t("galleryColorFamily")}>
                  {primaryImage.palette.slice(0, 6).map((color) => (
                    <i key={color} style={{ background: color }} title={color} />
                  ))}
                </div>
              ) : null}
              <p>{primaryImage.notes || t("inspectorSingleHint")}</p>
            </div>
            <dl className="ue-gallery-inspector-meta">
              <div>
                <dt>{t("inspectorFilename")}</dt>
                <dd title={primaryImage.filename}>{primaryImage.filename}</dd>
              </div>
              <div>
                <dt>{t("inspectorCategory")}</dt>
                <dd>{primaryImage.category || t("inspectorEmptyValue")}</dd>
              </div>
              <div>
                <dt>{t("inspectorSource")}</dt>
                <dd>{primaryImage.source_name || t("galleryOutputFolder")}</dd>
              </div>
              <div>
                <dt>{t("inspectorSize")}</dt>
                <dd>{formatFileSize(primaryImage.size)}</dd>
              </div>
              <div>
                <dt>{t("inspectorCreated")}</dt>
                <dd>{formatCompactDate(primaryImage.created_at)}</dd>
              </div>
            </dl>
            <div className="ue-gallery-inspector-actions">
              <button className="ue-secondary-btn" onClick={() => onOpenDetail(primaryImage)}>
                <Eye size={14} />
                <span>{t("galleryInspect")}</span>
              </button>
              <button className="ue-secondary-btn" onClick={() => void onOpenWorkflow(primaryImage)}>
                <Send size={14} />
                <span>{t("modalOpenWorkflow")}</span>
              </button>
              <button className="ue-secondary-btn" onClick={() => void handleCopyPositivePrompt(primaryImage)}>
                <ClipboardCopy size={14} />
                <span>{t("metadataCopyPositive")}</span>
              </button>
              <button className="ue-secondary-btn" onClick={() => setMetadataViewerImage(primaryImage)}>
                <FileJson size={14} />
                <span>{t("metadataView")}</span>
              </button>
              <button
                className="ue-secondary-btn"
                onClick={() => void onUpdateImageState(primaryImage.relative_path, { pinned: !primaryImage.pinned })}
              >
                <Pin size={14} fill={primaryImage.pinned ? "currentColor" : "none"} />
                <span>{primaryImage.pinned ? t("galleryUnpin") : t("galleryPin")}</span>
              </button>
              <button className="ue-secondary-btn" onClick={() => setBoardPickerPaths([primaryImage.relative_path])}>
                <FolderPlus size={14} />
                <span>{t("bulkAddToBoard")}</span>
              </button>
              <button
                className="ue-secondary-btn"
                onClick={() => window.open(getAbsoluteImageUrl(primaryImage), "_blank", "noopener,noreferrer")}
              >
                <ExternalLink size={14} />
                <span>{t("modalOpenFull")}</span>
              </button>
              <button className="ue-secondary-btn ue-secondary-btn--danger" onClick={() => void handleDeleteSelected()}>
                <Trash2 size={14} />
                <span>{t("commonDelete")}</span>
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="ue-gallery-inspector-summary">
              <div className="ue-gallery-inspector-title">
                <CheckSquare size={16} />
                <strong>{t("bulkSelected", { count: selectedCount })}</strong>
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
          </>
        )}
      </aside>

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
    </>
  );
};
