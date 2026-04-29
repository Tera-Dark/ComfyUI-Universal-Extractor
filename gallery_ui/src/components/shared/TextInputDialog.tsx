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
        className="ue-library-modal"
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

        <div className="ue-pane-copy">
          <p className="ue-pane-kicker">{label}</p>
          <h2>{title}</h2>
          <p>{text}</p>
        </div>

        <label className="ue-import-text-field">
          <span>{label}</span>
          <input
            autoFocus
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder={placeholder}
          />
        </label>

        <div className="ue-library-modal-actions">
          <button className="ue-icon-action" onClick={onClose} aria-label={t("libraryCancel")} title={t("libraryCancel")} type="button">
            <X size={14} />
          </button>
          <button
            className="ue-icon-action ue-icon-action--filled"
            disabled={!trimmedValue || isSubmitting}
            aria-label={confirmLabel}
            title={confirmLabel}
            type="submit"
          >
            <Check size={14} />
          </button>
        </div>
      </form>
    </div>
  );
};
