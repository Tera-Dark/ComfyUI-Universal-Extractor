import { useDismissableLayer } from "../../utils/interaction";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { CheckCircle2, CircleAlert, Info, Loader2, ListChecks, X } from "lucide-react";

import { useI18n } from "../../i18n/I18nProvider";

export type OperationTone = "success" | "error" | "info" | "pending";

export interface OperationMetadata {
  taskKind?: string;
  source?: string;
  phase?: string;
  completed?: number;
  total?: number;
  jobId?: string;
  cancel?: () => void;
  quiet?: boolean;
}

interface OperationItem extends OperationMetadata {
  id: string;
  tone: OperationTone;
  message: string;
  detail?: string;
  createdAt: number;
  retry?: () => void;
  hidden?: boolean;
  occurrences?: number;
}

export interface RunOperationOptions<T> extends OperationMetadata {
  pending: string;
  success?: string | ((value: T) => string);
  successTone?: (value: T) => Exclude<OperationTone, "pending">;
  successDetail?: (value: T) => string;
  successRetry?: (value: T) => (() => void) | undefined;
  error?: string | ((error: unknown) => string);
}

interface OperationStatusContextValue {
  notify: (message: string, tone?: Exclude<OperationTone, "pending">, detail?: string) => string;
  startOperation: (message: string, detail?: string, metadata?: OperationMetadata) => string;
  updateOperation: (id: string, message: string, tone: Exclude<OperationTone, "pending">, detail?: string, retry?: () => void) => void;
  dismissOperation: (id: string) => void;
  runOperation: <T>(operation: () => Promise<T>, options: RunOperationOptions<T>) => Promise<T>;
  syncTask: (id: string, message: string, tone: OperationTone, detail: string, retry?: () => void, metadata?: OperationMetadata) => void;
}

const OperationStatusContext = createContext<OperationStatusContextValue | null>(null);
const COMPLETE_DISMISS_MS = 3000;

const createOperationId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const getErrorMessage = (error: unknown, fallback: string) => (error instanceof Error ? error.message : fallback);

const trimOperationItems = (items: OperationItem[]) => {
  const next = [...items];
  while (next.filter((item) => item.tone === "success" || item.tone === "info").length > 50) {
    // Errors and in-flight file operations are durable; only transient cards
    // can be evicted before the user explicitly dismisses a failure.
    const removableIndex = [...next].reverse().findIndex((item) => item.tone === "success" || item.tone === "info");
    if (removableIndex === -1) break;
    next.splice(next.length - 1 - removableIndex, 1);
  }
  return next;
};

export const OperationStatusProvider = ({ children }: { children: ReactNode }) => {
  const { t } = useI18n();
  const [items, setItems] = useState<OperationItem[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [filter, setFilter] = useState<"pending" | "error" | "recent">("pending");
  const closeCenter = useCallback(() => setExpanded(false), []);
  useDismissableLayer(expanded, closeCenter, { closeOnScroll: false });
  const [epoch, tick] = useState(() => Date.now());
  const dismissTimersRef = useRef<Map<string, number>>(new Map());
  const errorIds = useRef(new Map<string, string>());

  const clearDismissTimer = useCallback((id: string) => {
    const timer = dismissTimersRef.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      dismissTimersRef.current.delete(id);
    }
  }, []);

  const dismissOperation = useCallback((id: string) => {
    clearDismissTimer(id);
    setItems((current) => current.map((item) => item.id === id ? { ...item, hidden: true } : item));
  }, [clearDismissTimer]);

  const scheduleDismiss = useCallback((id: string, tone: OperationTone) => {
    clearDismissTimer(id);
    // A failed file operation needs to remain visible until the user dismisses it.
    if (tone === "pending" || tone === "error") {
      return;
    }
    const timer = window.setTimeout(() => dismissOperation(id), COMPLETE_DISMISS_MS);
    dismissTimersRef.current.set(id, timer);
  }, [clearDismissTimer, dismissOperation]);

  const upsertItem = useCallback((item: OperationItem) => {
    tick(Date.now());
    setItems((current) => {
      const linked = item.jobId ? current.find((entry) => entry.jobId === item.jobId) ?? current.find((entry) =>
        entry.tone === "pending" && entry.taskKind === item.taskKind && item.taskKind && !entry.jobId) : undefined;
      const id = linked?.id ?? item.id;
      const withoutExisting = current.filter((entry) => entry.id !== id);
      const previous = current.find((entry) => entry.id === id);
      const quietCompleted = item.quiet && item.tone !== "error" && item.tone !== "pending" &&
        (!previous || Date.now() - previous.createdAt < 2000);
      return trimOperationItems([{ ...previous, ...item, id, createdAt: previous?.createdAt ?? item.createdAt,
        hidden: item.tone === "error" && previous?.tone !== "error" ? false : previous?.hidden || quietCompleted,
        occurrences: previous?.tone === "error" && item.tone === "error" && !item.jobId ? (previous.occurrences ?? 1) + 1 : previous?.occurrences,
      }, ...withoutExisting]);
    });
  }, []);

  useEffect(() => {
    for (const item of items) {
      if (item.tone === "pending" || item.tone === "error") clearDismissTimer(item.id);
      else if (!item.hidden && !dismissTimersRef.current.has(item.id)) scheduleDismiss(item.id, item.tone);
    }
  }, [clearDismissTimer, items, scheduleDismiss]);

  const notify = useCallback((message: string, tone: Exclude<OperationTone, "pending"> = "info", detail = "") => {
    const key = `${message}\n${detail}`;
    const id = tone === "error" ? errorIds.current.get(key) ?? createOperationId() : createOperationId();
    if (tone === "error") errorIds.current.set(key, id);
    upsertItem({ id, tone, message, detail, createdAt: Date.now() });
    return id;
  }, [upsertItem]);

  const startOperation = useCallback((message: string, detail = "", metadata?: OperationMetadata) => {
    const id = createOperationId();
    upsertItem({ id, tone: "pending", message, detail, ...metadata, createdAt: Date.now() });
    return id;
  }, [upsertItem]);

  const updateOperation = useCallback((id: string, message: string, tone: Exclude<OperationTone, "pending">, detail = "", retry?: () => void) => {
    upsertItem({ id, tone, message, detail, retry, cancel: undefined, createdAt: Date.now() });
  }, [upsertItem]);

  const runOperation = useCallback(async <T,>(operation: () => Promise<T>, options: RunOperationOptions<T>) => {
    const id = startOperation(options.pending, "", { taskKind: options.taskKind, source: options.source });
    try {
      const value = await operation();
      if (options.success) {
        updateOperation(
          id,
          typeof options.success === "function" ? options.success(value) : options.success,
          options.successTone?.(value) ?? "success",
          options.successDetail?.(value) ?? "",
          options.successRetry?.(value),
        );
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

  const syncTask = useCallback((id: string, message: string, tone: OperationTone, detail: string, retry?: () => void, metadata?: OperationMetadata) => {
    upsertItem({ id: `task:${id}`, message, tone, detail, retry, ...metadata, createdAt: Date.now() });
  }, [upsertItem]);

  useEffect(() => {
    const waiting = items.filter((item) => !item.hidden && item.quiet && item.tone === "pending" && Date.now() - item.createdAt < 2000);
    if (!waiting.length) return;
    const timer = window.setTimeout(() => tick(Date.now()), Math.max(0, Math.min(...waiting.map((item) => item.createdAt + 2000 - Date.now()))));
    return () => window.clearTimeout(timer);
  }, [items, epoch]);

  useEffect(() => () => {
    dismissTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    dismissTimersRef.current.clear();
  }, []);

  const value = useMemo(
    () => ({ notify, startOperation, updateOperation, dismissOperation, runOperation, syncTask }),
    [dismissOperation, notify, runOperation, startOperation, updateOperation, syncTask],
  );

  const visible = items.filter((item) => !item.hidden && (!item.quiet || item.tone !== "pending" || epoch - item.createdAt >= 2000));
  const priority = (item: OperationItem) => item.tone === "error" ? 0 : item.tone === "pending" ? 1 : 2;
  const floating = [...visible].sort((a, b) => priority(a) - priority(b)).slice(0, 3);
  const history = items.filter((item) => filter === "recent" ? ["success", "info"].includes(item.tone) : item.tone === filter);
  const pendingCount = items.filter((item) => item.tone === "pending").length;
  const errorCount = items.filter((item) => item.tone === "error").length;

  const card = (item: OperationItem, inHistory = false) => (
    <article key={item.id} className={`ue-operation-card ue-operation-card--${item.tone}`}
      role={inHistory || item.tone === "pending" ? undefined : item.tone === "error" ? "alert" : "status"}>
      <div className="ue-operation-icon" aria-hidden="true">
        {item.tone === "pending" ? <Loader2 size={16} className="ue-operation-spinner" /> : item.tone === "success" ? <CheckCircle2 size={16} /> : item.tone === "error" ? <CircleAlert size={16} /> : <Info size={16} />}
      </div>
      <div className="ue-operation-copy">
        <strong>{item.message}{(item.occurrences ?? 1) > 1 ? ` ×${item.occurrences}` : ""}</strong>
        {item.retry && <button type="button" onClick={item.retry}>{t("jobRetry")}</button>}
        {item.cancel && item.tone === "pending" && <button type="button" onClick={item.cancel}>{t("jobRequestCancel")}</button>}
        {item.detail && item.tone === "error" ? <details className="ue-operation-details"><summary>{t("operationViewDetails")}</summary><span>{item.detail}</span></details> : item.detail ? <span>{item.detail}</span> : null}
      </div>
      <button className="ue-operation-dismiss" aria-label={t(inHistory && item.tone !== "pending" ? "operationClear" : "notificationDismiss")}
        onClick={() => inHistory && item.tone !== "pending" ? setItems((current) => current.filter((entry) => entry.id !== item.id)) : dismissOperation(item.id)}><X size={14} /></button>
    </article>
  );

  return (
    <OperationStatusContext.Provider value={value}>
      {children}
      <div className="ue-operation-status-center" onClick={(event) => event.stopPropagation()}>
        {expanded ? <section className="ue-task-panel" aria-label={t("operationCenter")}>
          <header><strong>{t("operationCenter")}</strong><button onClick={() => setExpanded(false)} aria-label={t("notificationDismiss")}><X size={16} /></button></header>
          <nav aria-label={t("operationCenter")}>
            {(["pending", "error", "recent"] as const).map((tab) => <button key={tab} aria-pressed={filter === tab} onClick={() => setFilter(tab)}>{t(`operationTab_${tab}`)}</button>)}
          </nav>
          <div className="ue-task-history">{history.length ? history.map((item) => card(item, true)) : <p>{t("operationEmpty")}</p>}</div>
        </section> : floating.map((item) => card(item))}
        <button className="ue-task-center-toggle" aria-expanded={expanded} onClick={() => { if (!expanded) setFilter(pendingCount ? "pending" : errorCount ? "error" : "recent"); setExpanded((current) => !current); }}>
          <ListChecks size={16} /><span>{t("operationCenter")}</span>{pendingCount > 0 && <span>{pendingCount} {t("operationTab_pending")}</span>}{errorCount > 0 && <span className="ue-task-error-count">{errorCount} {t("operationTab_error")}</span>}
        </button>
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
