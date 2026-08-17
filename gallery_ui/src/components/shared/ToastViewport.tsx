import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useOperationStatus } from "./OperationStatusCenter";

type ToastTone = "success" | "error" | "info";

interface ToastContextValue {
  pushToast: (message: string, tone?: ToastTone, detail?: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const { notify } = useOperationStatus();

  const pushToast = useCallback((message: string, tone: ToastTone = "info", detail = "") => {
    notify(message, tone, detail);
  }, [notify]);

  const value = useMemo(() => ({ pushToast }), [pushToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }
  return context;
};
