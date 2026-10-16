import { useCallback, useEffect, useRef, useState } from "react";
import { ClipboardCopy, FolderSearch, ImagePlus, Loader2, Search, X } from "lucide-react";
import { useI18n } from "../../i18n/I18nProvider";
import { galleryApi } from "../../services/galleryApi";
import type { ImageRecord, ImageSearchResponse } from "../../types/universal-gallery";
import { FloatingLayerPortal, useDismissableLayer } from "../../utils/interaction";
import { useOperationStatus } from "../shared/OperationStatusCenter";
import "./imageSearch.css";

interface Props {
  suspended?: boolean;
  initialFile?: File | null;
  onClose: () => void;
  onOpenDetail: (image: ImageRecord, scope?: ImageRecord[]) => void;
  onLocate: (image: ImageRecord) => void;
}

export const ImageSearchModal = ({ initialFile, onClose, onOpenDetail, onLocate, suspended = false }: Props) => {
  const { t } = useI18n();
  const { notify } = useOperationStatus();
  const [file, setFile] = useState<File | null>(initialFile ?? null);
  const [preview, setPreview] = useState("");
  const [result, setResult] = useState<ImageSearchResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState("");
  const [broad, setBroad] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLElement>(null);
  useDismissableLayer(!suspended, onClose, { closeOnResize: false });

  useEffect(() => { if (initialFile) setFile(initialFile); }, [initialFile]);

  const accept = useCallback((candidate?: File | null) => {
    if (!candidate) return;
    if ((!candidate.type.startsWith("image/") && !/\.(png|jpe?g|webp|gif|bmp|tiff?)$/i.test(candidate.name)) || candidate.size > 20 * 1024 * 1024) {
      setError(t("imageSearchInvalid"));
      return;
    }
    setFile(candidate);
    setAttempt((value) => value + 1);
  }, [t]);

  useEffect(() => {
    if (suspended) return;
    const previous = document.activeElement;
    dialog.current?.focus();
    const paste = (event: ClipboardEvent) => {
      const image = [...(event.clipboardData?.files ?? [])].find((item) => item.type.startsWith("image/"));
      if (image) { event.preventDefault(); accept(image); }
    };
    const focus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const elements = dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input, a[href]");
      if (!elements?.length) return;
      const first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
    };
    window.addEventListener("paste", paste);
    window.addEventListener("keydown", focus);
    return () => {
      window.removeEventListener("paste", paste);
      window.removeEventListener("keydown", focus);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, [accept, suspended]);

  useEffect(() => {
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) { setError(t("imageSearchInvalid")); setBusy(false); return; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file, t]);

  useEffect(() => {
    if (!file || suspended) return;
    if (file.size > 20 * 1024 * 1024) return;
    const controller = new AbortController();
    let timer: number | undefined;
    const wait = () => new Promise<void>((resolve, reject) => {
      const abort = () => { window.clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); };
      controller.signal.addEventListener("abort", abort, { once: true });
      timer = window.setTimeout(() => { controller.signal.removeEventListener("abort", abort); resolve(); }, 2000);
    });
    const run = async () => {
      setBusy(true); setError(""); setProgress(t("imageSearchSearching"));
      try {
        const response = await galleryApi.searchByImage(file, broad ? 55 : 70, controller.signal);
        if (controller.signal.aborted) return;
        setResult(response);
        if (response.job) {
          let job = response.job;
          while (["queued", "running", "cancelling"].includes(job.state)) {
            setProgress(t("imageSearchIndexing", { loaded: job.completed, total: job.total || response.total }));
            await wait();
            while (document.visibilityState === "hidden") await wait();
            job = (await galleryApi.getJob(job.id, controller.signal)).job;
          }
          if (job.state !== "succeeded") throw new Error(job.error || t("imageSearchIndexFailed"));
          const complete = await galleryApi.searchByImage(file, broad ? 55 : 70, controller.signal);
          if (!controller.signal.aborted) setResult(complete);
        }
      } catch (failure) {
        if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : t("imageSearchIndexFailed"));
      } finally {
        if (!controller.signal.aborted) { setBusy(false); setProgress(""); }
      }
    };
    void run();
    return () => { controller.abort(); window.clearTimeout(timer); };
  }, [file, broad, attempt, t, suspended]);

  const copy = async (path: string) => {
    try { await navigator.clipboard.writeText(path); notify(t("imageSearchCopied"), "success"); }
    catch { notify(t("contextCopyError"), "error"); }
  };

  return <FloatingLayerPortal>
    <div className="ue-modal-backdrop ue-image-search-backdrop" style={suspended ? { display: "none" } : undefined} aria-hidden={suspended || undefined} onClick={(event) => { event.stopPropagation(); onClose(); }}
      onDragOver={(event) => { event.preventDefault(); event.stopPropagation(); }}
      onDrop={(event) => { event.preventDefault(); event.stopPropagation(); accept(event.dataTransfer.files[0]); }}>
      <section ref={dialog} tabIndex={-1} className="ue-image-search" role="dialog" aria-modal={!suspended || undefined} aria-labelledby="image-search-title"
        onClick={(event) => event.stopPropagation()}>
        <header><div><h2 id="image-search-title"><FolderSearch size={20} />{t("imageSearchTitle")}</h2><p>{t("imageSearchIntro")}</p></div>
          <button type="button" className="ue-icon-action" aria-label={t("imageSearchClose")} onClick={onClose}><X size={18} /></button></header>
        <div className="ue-image-search-body">
          <aside>
            <button type="button" className="ue-image-search-drop" onClick={() => input.current?.click()}>
              {preview ? <img src={preview} alt={t("imageSearchReference")} /> : <ImagePlus size={32} />}
              <strong>{t(preview ? "imageSearchReplace" : "imageSearchChoose")}</strong><span>{t("imageSearchPaste")}</span>
            </button>
            <input ref={input} type="file" accept="image/*" aria-label={t("imageSearchChoose")} hidden onChange={(event) => { accept(event.target.files?.[0]); event.target.value = ""; }} />
            {file ? <p className="ue-image-search-filename" title={file.name}>{file.name}</p> : null}
            <label className="ue-image-search-broad"><input type="checkbox" checked={broad} onChange={(event) => setBroad(event.target.checked)} />{t("imageSearchBroader")}</label>
            <p className="ue-image-search-hint">{t("imageSearchPrivacy")}</p>
            <p className="ue-image-search-hint">{t("imageSearchLimits")}</p>
          </aside>
          <main>
            <div role="status" aria-live="polite" className="ue-image-search-status">
              {busy ? <><Loader2 className="ue-image-search-spin" size={16} />{progress}</> : result ? t("imageSearchCoverage", { loaded: result.indexed, total: result.total, count: result.matches.length }) : <><Search size={17} />{t("imageSearchReady")}</>}
            </div>
            {result?.failed ? <p className="ue-image-search-hint">{t("imageSearchFailedCount", { count: result.failed })}</p> : null}
            {result?.pending && !busy ? <p className="ue-image-search-hint">{t("imageSearchPartial")}</p> : null}
            {error ? <div role="alert" className="ue-inline-error">{error}<button type="button" className="ue-secondary-action" onClick={() => setAttempt((value) => value + 1)}>{t("imageSearchRetry")}</button></div> : null}
            {result && !busy && !result.matches.length ? <p className="ue-image-search-empty">{t("imageSearchEmpty")}</p> : null}
            <div className="ue-image-search-results">
              {result?.matches.map((match) => <article key={match.image.relative_path} className="ue-image-search-result">
                <button type="button" className="ue-image-search-thumb" onClick={() => { onOpenDetail(match.image, result.matches.map((item) => item.image)); }} aria-label={`${t("imageSearchView")} ${match.image.filename}`}>
                  <img src={match.image.thumb_url} alt={match.image.filename} loading="lazy" /></button>
                <div className="ue-image-search-result-info"><span className={`ue-image-search-match ${match.match_type === "exact" ? "is-exact" : ""}`}>{match.match_type === "exact" ? t("imageSearchExact") : t("imageSearchScore", { count: match.score })}</span>
                  <strong title={match.image.filename}>{match.image.filename}</strong><code title={match.full_path}>{match.full_path}</code>
                  <div className="ue-image-search-actions"><button type="button" className="ue-secondary-action" onClick={() => onLocate(match.image)}><FolderSearch size={13} />{t("imageSearchLocate")}</button>
                    <button type="button" className="ue-secondary-action" onClick={() => void copy(match.full_path)}><ClipboardCopy size={13} />{t("imageSearchCopyPath")}</button></div>
                </div>
              </article>)}
            </div>
          </main>
        </div>
      </section>
    </div>
  </FloatingLayerPortal>;
};
