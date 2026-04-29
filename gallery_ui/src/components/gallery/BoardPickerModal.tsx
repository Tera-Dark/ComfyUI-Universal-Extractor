import { useMemo, useState } from "react";
import { Check, FolderPlus, Images, X } from "lucide-react";

import { useI18n } from "../../i18n/I18nProvider";
import type { BoardMutationResult, BoardSummary } from "../../types/universal-gallery";

interface BoardPickerModalProps {
  open: boolean;
  boards: BoardSummary[];
  selectedCount: number;
  onClose: () => void;
  onCreateBoard: (name: string) => Promise<BoardMutationResult>;
  onAddToBoard: (boardId: string) => Promise<void>;
}

export const BoardPickerModal = ({
  open,
  boards,
  selectedCount,
  onClose,
  onCreateBoard,
  onAddToBoard,
}: BoardPickerModalProps) => {
  const { t } = useI18n();
  const [selectedBoardId, setSelectedBoardId] = useState("");
  const [newBoardName, setNewBoardName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const defaultBoardId = useMemo(() => boards[0]?.id ?? "", [boards]);
  const targetBoardId = selectedBoardId || defaultBoardId;

  if (!open) {
    return null;
  }

  const handleSubmit = async () => {
    if (!targetBoardId && !newBoardName.trim()) {
      return;
    }

    setIsSubmitting(true);
    try {
      let boardId = targetBoardId;
      if (newBoardName.trim()) {
        const result = await onCreateBoard(newBoardName.trim());
        boardId = result.board?.id ?? "";
      }
      if (boardId) {
        await onAddToBoard(boardId);
        setNewBoardName("");
        setSelectedBoardId("");
        onClose();
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="ue-modal-backdrop" onClick={onClose}>
      <div className="ue-library-modal ue-board-picker-modal" onClick={(event) => event.stopPropagation()}>
        <button className="ue-modal-close ue-modal-close--light" onClick={onClose} aria-label={t("modalClose")}>
          <X size={18} />
        </button>

        <div className="ue-pane-copy">
          <p className="ue-pane-kicker">{t("sidebarBoards")}</p>
          <h2>{t("boardAddToTitle")}</h2>
          <p>{t("boardAddToText", { count: selectedCount })}</p>
        </div>

        <div className="ue-board-picker-list">
          {boards.map((board) => (
            <button
              key={board.id}
              className={`ue-board-picker-item ${targetBoardId === board.id && !newBoardName.trim() ? "is-active" : ""}`}
              onClick={() => {
                setSelectedBoardId(board.id);
                setNewBoardName("");
              }}
            >
              <span className="ue-board-cover">
                {board.cover_image ? <img src={board.cover_image.thumb_url} alt="" loading="lazy" /> : <Images size={15} />}
              </span>
              <span>{board.name}</span>
              <em>{board.count}</em>
            </button>
          ))}
          {boards.length === 0 ? <p className="ue-tool-helper">{t("boardEmptyText")}</p> : null}
        </div>

        <label className="ue-import-text-field">
          <span>{t("boardCreateInline")}</span>
          <input
            value={newBoardName}
            onChange={(event) => setNewBoardName(event.target.value)}
            placeholder={t("boardNamePlaceholder")}
          />
        </label>

        <div className="ue-library-modal-actions">
          <button className="ue-icon-action" onClick={onClose} aria-label={t("libraryCancel")} title={t("libraryCancel")}>
            <X size={14} />
          </button>
          <button
            className="ue-icon-action ue-icon-action--filled"
            onClick={() => void handleSubmit()}
            disabled={isSubmitting || (!targetBoardId && !newBoardName.trim())}
            aria-label={newBoardName.trim() ? t("sidebarCreateBoard") : t("boardAddToAction")}
            title={newBoardName.trim() ? t("sidebarCreateBoard") : t("boardAddToAction")}
          >
            {newBoardName.trim() ? <FolderPlus size={14} /> : <Check size={14} />}
          </button>
        </div>
      </div>
    </div>
  );
};
