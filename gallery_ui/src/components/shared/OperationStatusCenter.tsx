import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, CircleAlert, Info, Loader2, X } from "lucide-react";

import { useI18n } from "../../i18n/I18nProvider";

export type OperationTone = "success" | "error" | "info" | "pending";

interface OperationItem {
  id: string;
  tone: OperationTone;
  message: string;
  detail?: string;
  createdAt: number;
}

interface RunOperationOptions<T> {
  pending: string;
  success?: string | ((value: T) => string);
  error?: string | ((error: unknown) => string);
}

interface OperationStatusContextValue {
  notify: (message: string, tone?: Exclude<OperationTone, "pending">, detail?: string) => string;
  startOperation: (message: string, detail?: string) => string;
  updateOperation: (id: string, message: string, tone: Exclude<OperationTone, "pending">, detail?: string) => void;
  dismissOperation: (id: string) => void;
  runOperation: <T>(operation: () => Promise<T>, options: RunOperationOptions<T>) => Promise<T>;
}

const OperationStatusContext = createContext<OperationStatusContextValue | null>(null);
const MAX_OPERATION_ITEMS = 5;
const COMPLETE_DISMISS_MS = 3600;
const ERROR_DISMISS_MS = 6200;

const createOperationId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const getErrorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

const trimOperationItems = (items: OperationItem[]) => {
  const next = [...items];
  while (next.length > MAX_OPERATION_ITEMS) {
    const removableIndex = [...next].reverse().findIndex((item) => item.tone !== "pending");
    if (removableIndex === -1) {
      next.pop();
      continue;
    }
    next.splice(next.length - 1 - removableIndex, 1);
  }
  return next;
};

export const OperationStatusProvider = ({ children }: { children: ReactNode }) => {
  const { t } = useI18n();
  const [items, setItems] = useState<OperationItem[]>([]);
  const dismissTimersRef = useRef<Map<string, number>>(new Map());

  const clearDismissTimer = useCallback((id: string) => {
    const timer = dismissTimersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      dismissTimersRef.current.delete(id);
    }
  }, []);

  const dismissOperation = useCallback((id: string) => {
    clearDismissTimer(id);
    setItems((current) => current.filter((item) => item.id !== id));
  }, [clearDismissTimer]);

  const scheduleDismiss = useCallback((id: string, tone: OperationTone) => {
    clearDismissTimer(id);
    if (tone === "pending") {
      return;
    }
    const timer = window.setTimeout(() => dismissOperation(id), tone === "error" ? ERROR_DISMISS_MS : COMPLETE_DISMISS_MS);
    dismissTimersRef.current.set(id, timer);
  }, [clearDismissTimer, dismissOperation]);

  const upsertItem = useCallback((item: OperationItem) => {
    setItems((current) => {
      const withoutExisting = current.filter((entry) => entry.id !== item.id);
      return trimOperationItems([item, ...withoutExisting]);
    });
    scheduleDismiss(item.id, item.tone);
  }, [scheduleDismiss]);

  const notify = useCallback((message: string, tone: Exclude<OperationTone, "pending"> = "info", detail = "") => {
    const id = createOperationId();
    upsertItem({ id, tone, message, detail, createdAt: Date.now() });
    return id;
  }, [upsertItem]);

  const startOperation = useCallback((message: string, detail = "") => {
    const id = createOperationId();
    upsertItem({ id, tone: "pending", message, detail, createdAt: Date.now() });
    return id;
  }, [upsertItem]);

  const updateOperation = useCallback((id: string, message: string, tone: Exclude<OperationTone, "pending">, detail = "") => {
    upsertItem({ id, tone, message, detail, createdAt: Date.now() });
  }, [upsertItem]);

  const runOperation = useCallback(async <T,>(operation: () => Promise<T>, options: RunOperationOptions<T>) => {
    const id = startOperation(options.pending);
    try {
      const value = await operation();
      if (options.success) {
        updateOperation(id, typeof options.success === "function" ? options.success(value) : options.success, "success");
      } else {
        dismissOperation(id);
      }
      return value;
    } catch (error) {
      const fallback = typeof options.error === "string" ? options.error : "Operation failed";
      updateOperation(
        id,
        typeof options.error === "function" ? options.error(error) : getErrorMessage(error, fallback),
        "error",
      );
      throw error;
    }
  }, [dismissOperation, startOperation, updateOperation]);

  useEffect(() => () => {
    dismissTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    dismissTimersRef.current.clear();
  }, []);

  const value = useMemo(
    () => ({ notify, startOperation, updateOperation, dismissOperation, runOperation }),
    [dismissOperation, notify, runOperation, startOperation, updateOperation],
  );

  return (
    <OperationStatusContext.Provider value={value}>
      {children}
      <div className="ue-operation-status-center" aria-live="polite" aria-atomic="false">
        {items.map((item) => (
          <article
            key={item.id}
            className={`ue-operation-card ue-operation-card--${item.tone}`}
            role={item.tone === "error" ? "alert" : "status"}
          >
            <div className="ue-operation-icon" aria-hidden="true">
              {item.tone === "pending" ? (
                <Loader2 size={16} className="ue-operation-spinner" />
              ) : item.tone === "success" ? (
                <CheckCircle2 size={16} />
              ) : item.tone === "error" ? (
                <CircleAlert size={16} />
              ) : (
                <Info size={16} />
              )}
            </div>
            <div className="ue-operation-copy">
              <strong>{item.message}</strong>
              {item.detail ? <span>{item.detail}</span> : null}
            </div>
            <button className="ue-operation-dismiss" onClick={() => dismissOperation(item.id)} aria-label={t("notificationDismiss")}>
              <X size={14} />
            </button>
          </article>
        ))}
      </div>
    </OperationStatusContext.Provider>
  );
};

export const useOperationStatus = () => {
  const context = useContext(OperationStatusContext);
  if (!context) {
    throw new Error("useOperationStatus must be used within OperationStatusProvider");
  }
  return context;
};
