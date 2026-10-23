import { useConfirm } from "../shared/ConfirmDialog";
import { ModalSurface } from "../shared/ModalSurface";
import { useState, useRef } from "react";
import { Save, Sparkles, Trash2, X } from "lucide-react";

import { useI18n } from "../../i18n/I18nProvider";
import type { LibraryEntry } from "../../types/universal-gallery";
import { useToast } from "../shared/ToastViewport";

interface EntryTemplate {
  id: string;
  label: string;
  description: string;
  entry: LibraryEntry;
}

interface LibraryEntryEditorModalProps {
  open: boolean;
  title: string;
  initialEntry: LibraryEntry | null;
  templates?: EntryTemplate[];
  isSubmitting: boolean;
  onClose: () => void;
  onSave: (entry: LibraryEntry) => Promise<boolean>;
  onDelete?: () => Promise<boolean>;
}

export const LibraryEntryEditorModal = ({
  open,
  title,
  initialEntry,
  templates = [],
  isSubmitting,
  onClose,
  onSave,
  onDelete,
}: LibraryEntryEditorModalProps) => {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const { confirm } = useConfirm();
  const confirming = useRef(false);
  const [value, setValue] = useState(() => JSON.stringify(initialEntry ?? {}, null, 2));

  const requestClose = async () => {
    if (isSubmitting || confirming.current) return;
    if (value !== JSON.stringify(initialEntry ?? {}, null, 2)) {
      confirming.current = true;
      try {
        if (!(await confirm({ title: t("libraryUnsavedTitle"), message: t("libraryUnsavedConfirm"),
          confirmLabel: t("libraryDiscardChanges"), cancelLabel: t("libraryCancel"), tone: "warning" }))) return;
      } finally { confirming.current = false; }
    }
    onClose();
  };

  if (!open) {
    return null;
  }

  return (
    <ModalSurface className="ue-library-modal ue-library-modal--wide" title={title} onClose={() => void requestClose()} closeDisabled={isSubmitting}>
        <button className="ue-modal-close ue-modal-close--light" disabled={isSubmitting} onClick={() => void requestClose()} aria-label={t("modalClose")}>
          <X size={18} />
        </button>

        <div className="ue-pane-copy">
          <p className="ue-pane-kicker">{t("libraryDetail")}</p>
          <h2>{title}</h2>
          <p>{t("libraryEntryEditorHint")}</p>
        </div>

        {templates.length ? (
          <section className="ue-library-template-panel">
            <div className="ue-library-guide-head">
              <Sparkles size={15} />
              <strong>{t("libraryTemplatePanelTitle")}</strong>
            </div>
            <div className="ue-library-template-grid">
              {templates.map((template) => (
                <button
                  key={template.id}
                  className="ue-library-template-card" disabled={isSubmitting}
                  onClick={() => setValue(JSON.stringify(template.entry, null, 2))}
                  type="button"
                >
                  <strong>{template.label}</strong>
                  <span>{template.description}</span>
                </button>
              ))}
            </div>
          </section>
        ) : null}

        <div className="ue-library-field-guide-inline">
          <span>name</span>
          <span>prompt</span>
          <span>other_names</span>
          <span>tags</span>
          <span>model</span>
          <span>description</span>
        </div>

        <textarea
          className="ue-library-entry-editor" disabled={isSubmitting}
          aria-label={`${t("libraryDetail")} JSON`}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />

        <div className="ue-library-modal-actions">
          {onDelete ? (
            <button
              className="ue-icon-action ue-icon-action--danger"
              onClick={async () => {
                const ok = await onDelete();
                if (ok) {
                  onClose();
                }
              }}
              disabled={isSubmitting}
              aria-label={t("commonDelete")}
              title={t("commonDelete")}
            >
              <Trash2 size={14} /><span>{t("commonDelete")}</span>
            </button>
          ) : null}

          <button className="ue-icon-action" disabled={isSubmitting} onClick={() => void requestClose()} aria-label={t("libraryCancel")} title={t("libraryCancel")}>
            <X size={14} /><span>{t("libraryCancel")}</span>
          </button>
          <button
            className="ue-icon-action ue-icon-action--filled"
            disabled={isSubmitting}
            aria-label={t("librarySave")}
            title={t("librarySave")}
            onClick={async () => {
              try {
                const parsed = JSON.parse(value) as LibraryEntry;
                const ok = await onSave(parsed);
                if (ok) {
                  onClose();
                }
              } catch (error) {
                pushToast(error instanceof Error ? error.message : t("errorJsonInvalid"), "error");
              }
            }}
          >
            <Save size={14} /><span>{t("librarySave")}</span>
          </button>
        </div>
    </ModalSurface>
  );
};
