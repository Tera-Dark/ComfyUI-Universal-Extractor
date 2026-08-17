import { useEffect, useState } from "react";
import { Check, X } from "lucide-react";

import { useI18n } from "../../i18n/I18nProvider";

interface TextInputDialogProps {
  open: boolean;
  title: string;
  text: string;
  label: string;
  placeholder?: string;
  initialValue?: string;
  confirmLabel: string;
  onClose: () => void;
  onSubmit: (value: string) => Promise<void> | void;
}

export const TextInputDialog = ({
  open,
  title,
  text,
  label,
  placeholder = "",
  initialValue = "",
  confirmLabel,
  onClose,
  onSubmit,
}: TextInputDialogProps) => {
  const { t } = useI18n();
  const [value, setValue] = useState(initialValue);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setValue(initialValue);
      setIsSubmitting(false);
    }
  }, [initialValue, open]);

  if (!open) {
    return null;
  }

  const trimmedValue = value.trim();

  return (
    <div className="ue-modal-backdrop" onClick={onClose}>
      <form
        className="ue-library-modal ue-dialog-modal ue-text-input-modal"
        onClick={(event) => event.stopPropagation()}
        onSubmit={async (event) => {
          event.preventDefault();
          if (!trimmedValue || isSubmitting) {
            return;
          }
          setIsSubmitting(true);
          try {
            await onSubmit(trimmedValue);
            setIsSubmitting(false);
            onClose();
          } catch {
            setIsSubmitting(false);
          }
        }}
      >
        <button className="ue-modal-close ue-modal-close--light" onClick={onClose} aria-label={t("modalClose")} type="button">
          <X size={18} />
        </button>

        <div className="ue-pane-copy ue-dialog-heading">
          <h2>{title}</h2>
          <p>{text}</p>
        </div>

        <label className="ue-import-text-field ue-dialog-field">
          <span>{label}</span>
          <input
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={placeholder}
          />
        </label>

        <div className="ue-library-modal-actions ue-dialog-actions">
          <button className="ue-secondary-btn" onClick={onClose} type="button">
            <X size={14} />
            <span>{t("libraryCancel")}</span>
          </button>
          <button
            className="ue-primary-btn"
            disabled={!trimmedValue || isSubmitting}
            aria-label={confirmLabel}
            title={confirmLabel}
            type="submit"
          >
            <Check size={14} />
            <span>{confirmLabel}</span>
          </button>
        </div>
      </form>
    </div>
  );
};
