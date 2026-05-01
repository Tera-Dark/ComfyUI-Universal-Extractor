import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Check, Info, X } from "lucide-react";

import { useI18n } from "../../i18n/I18nProvider";

type ConfirmTone = "info" | "warning" | "danger";

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ConfirmTone;
}

interface ConfirmRequest extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export const ConfirmProvider = ({ children }: { children: ReactNode }) => {
  const { t } = useI18n();
  const [request, setRequest] = useState<ConfirmRequest | null>(null);

  const confirm = (options: ConfirmOptions) =>
    new Promise<boolean>((resolve) => {
      setRequest({ ...options, resolve });
    });

  const value = useMemo(() => ({ confirm }), []);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {request ? (
        <div className="ue-modal-backdrop" onClick={() => {
          request.resolve(false);
          setRequest(null);
        }}>
          <div className="ue-confirm-modal ue-dialog-modal" onClick={(event) => event.stopPropagation()}>
            <button
              className="ue-modal-close ue-modal-close--light"
              onClick={() => {
                request.resolve(false);
                setRequest(null);
              }}
              aria-label={t("modalClose")}
            >
              <X size={18} />
            </button>

            <div className={`ue-confirm-icon ue-confirm-icon--${request.tone || "info"}`}>
              {request.tone === "danger" || request.tone === "warning" ? <AlertTriangle size={18} /> : <Info size={18} />}
            </div>
            <div className="ue-pane-copy ue-dialog-heading">
              <h2>{request.title}</h2>
              <p>{request.message}</p>
            </div>
            <div className="ue-library-modal-actions ue-dialog-actions">
              <button
                className="ue-secondary-btn"
                onClick={() => {
                  request.resolve(false);
                  setRequest(null);
                }}
              >
                <X size={14} />
                <span>{request.cancelLabel || t("libraryCancel")}</span>
              </button>
              <button
                className={`ue-primary-btn ${request.tone === "danger" ? "ue-primary-btn--danger" : ""}`}
                onClick={() => {
                  request.resolve(true);
                  setRequest(null);
                }}
              >
                <Check size={14} />
                <span>{request.confirmLabel || t("commonConfirm")}</span>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </ConfirmContext.Provider>
  );
};

export const useConfirm = () => {
  const context = useContext(ConfirmContext);
  if (!context) {
    throw new Error("useConfirm must be used within ConfirmProvider");
  }
  return context;
};
