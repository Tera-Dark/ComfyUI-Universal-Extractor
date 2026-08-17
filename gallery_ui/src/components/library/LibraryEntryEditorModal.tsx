import { useState } from "react";
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
  const [value, setValue] = useState(() => JSON.stringify(initialEntry ?? {}, null, 2));

  if (!open) {
    return null;
  }

  return (
    <div className="ue-modal-backdrop" onClick={onClose}>
      <div className="ue-library-modal ue-library-modal--wide" onClick={(event) => event.stopPropagation()}>
        <button className="ue-modal-close ue-modal-close--light" onClick={onClose} aria-label={t("modalClose")}>
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
                  className="ue-library-template-card"
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
          className="ue-library-entry-editor"
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
              <Trash2 size={14} />
            </button>
          ) : null}

          <button className="ue-icon-action" onClick={onClose} aria-label={t("libraryCancel")} title={t("libraryCancel")}>
            <X size={14} />
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
            <Save size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};
