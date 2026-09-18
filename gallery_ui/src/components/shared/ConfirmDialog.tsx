import { createPortal } from "react-dom";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check, Info, X } from "lucide-react";

import { useI18n } from "../../i18n/I18nProvider";

type ConfirmTone = "info" | "warning" | "danger";

export interface ConfirmOptions {
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

  const pending = useRef<ConfirmRequest | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const value = useMemo(() => ({confirm:(options:ConfirmOptions)=>new Promise<boolean>(resolve=>{
    // A replaced confirmation must never leave its caller waiting forever.
    pending.current?.resolve(false);
    pending.current={...options,resolve};
    setRequest(pending.current);
  })}),[]);
  const finish=(approved:boolean)=>{pending.current?.resolve(approved);pending.current=null;setRequest(null);};
  useEffect(()=>()=>{pending.current?.resolve(false);pending.current=null;},[]);
  useEffect(()=>{
    if(!request)return;
    const previous=document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root=document.getElementById("root"), wasInert=root?.inert ?? false;
    if(root)root.inert=true;
    dialog.current?.querySelector<HTMLButtonElement>(".ue-secondary-btn")?.focus({preventScroll:true});
    const key=(event:KeyboardEvent)=>{
      event.stopPropagation();
      if(event.key==="Escape"){event.preventDefault();pending.current?.resolve(false);pending.current=null;setRequest(null);}
      if(event.key!=="Tab")return;
      const buttons=dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
      if(!buttons?.length)return;
      const first=buttons[0],last=buttons[buttons.length-1];
      if(event.shiftKey && document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first.focus();}
    };
    document.addEventListener("keydown",key,true);
    return ()=>{document.removeEventListener("keydown",key,true);if(root)root.inert=wasInert;if(previous?.isConnected && !previous.closest("[inert]"))previous.focus({preventScroll:true});};
  },[request]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {request ? createPortal(
        <div className="ue-modal-backdrop ue-confirm-backdrop" onClick={() => {
          finish(false);
        }}>
          <div ref={dialog} role="alertdialog" aria-modal="true" aria-labelledby="ue-confirm-title" aria-describedby="ue-confirm-body" className="ue-confirm-modal ue-dialog-modal" onClick={(event) => event.stopPropagation()}>
            <button
              className="ue-modal-close ue-modal-close--light"
              onClick={() => {
                finish(false);
              }}
              aria-label={t("modalClose")}
            >
              <X size={18} />
            </button>

            <div className={`ue-confirm-icon ue-confirm-icon--${request.tone || "info"}`}>
              {request.tone === "danger" || request.tone === "warning" ? <AlertTriangle size={18} /> : <Info size={18} />}
            </div>
            <div className="ue-pane-copy ue-dialog-heading">
              <h2 id="ue-confirm-title">{request.title}</h2>
              <p id="ue-confirm-body">{request.message}</p>
            </div>
            <div className="ue-library-modal-actions ue-dialog-actions">
              <button
                className="ue-secondary-btn"
                onClick={() => {
                  finish(false);
                }}
              >
                <X size={14} />
                <span>{request.cancelLabel || t("libraryCancel")}</span>
              </button>
              <button
                className={`ue-primary-btn ${request.tone === "danger" ? "ue-primary-btn--danger" : ""}`}
                onClick={() => {
                  finish(true);
                }}
              >
                <Check size={14} />
                <span>{request.confirmLabel || t("commonConfirm")}</span>
              </button>
            </div>
          </div>
        </div>,document.body
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
