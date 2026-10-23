import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useModalFocus } from "../../utils/interaction";

/** Shared light modal. Confirmation dialogs keep their independent top layer. */
export const ModalSurface = ({ children, className, title, onClose, backdropClassName = "", closeDisabled = false }: {
  children: ReactNode;
  className: string;
  title: string;
  onClose: () => void;
  backdropClassName?: string;
  closeDisabled?: boolean;
}) => {
  const dialog = useRef<HTMLElement>(null);
  const pressedBackdrop = useRef(false);
  const requestClose = useRef(onClose);
  useEffect(() => { requestClose.current = () => { if (!closeDisabled) onClose(); }; }, [closeDisabled, onClose]);
  useModalFocus(dialog, () => requestClose.current());
  return createPortal(<div className={`ue-modal-backdrop ${backdropClassName}`}
    onPointerDown={(event) => { pressedBackdrop.current = event.target === event.currentTarget; }}
    onClick={(event) => { if (pressedBackdrop.current && event.target === event.currentTarget) requestClose.current(); }}>
    <section ref={dialog} tabIndex={-1} className={className} role="dialog" aria-modal="true" aria-label={title} aria-busy={closeDisabled || undefined}
      onClick={(event) => event.stopPropagation()}>{children}</section>
  </div>, document.body);
};
