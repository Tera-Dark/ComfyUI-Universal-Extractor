import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from "react";
import {
  BookOpen,
  Boxes,
  ChevronLeft,
  ChevronRight,
  Expand,
  ExternalLink,
  FileJson,
  Palette,
  PencilLine,
  Pin,
  Save,
  Shrink,
  Trash2,
  X,
} from "lucide-react";

import { useI18n } from "../../i18n/I18nProvider";
import { galleryApi } from "../../services/galleryApi";
import { useConfirm } from "../shared/ConfirmDialog";
import { useToast } from "../shared/ToastViewport";
import type { DetailNavigationState, ImageMetadata, ImageRecord } from "../../types/universal-gallery";
import { formatFileSize, formatLongDateTime } from "../../utils/formatters";

interface ImageDetailModalProps {
  image: ImageRecord;
  onClose: () => void;
  onSaveState: (relativePath: string, updates: Record<string, unknown>) => Promise<void>;
  onRenameFile: (relativePath: string, newFilename: string) => Promise<void>;
  onDeleteFile: (relativePath: string) => Promise<void>;
  onOpenWorkflow: (image: ImageRecord) => Promise<void>;
  navigation: DetailNavigationState | null;
  onNavigate: (index: number) => void;
}

interface PanPosition {
  x: number;
  y: number;
}

interface DragState {
  pointerId: number;
  startX: number;
  startY: number;
  originX: number;
  originY: number;
}

interface DraftStateSnapshot {
  title: string;
  category: string;
  notes: string;
  pinned: boolean;
}

const MIN_ZOOM = 1;
const MAX_ZOOM = 5;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const clampPan = (value: number, scale: number, viewportSize: number) => {
  if (scale <= MIN_ZOOM) {
    return 0;
  }

  const limit = ((scale - 1) * viewportSize) / 2 + 48;
  return clamp(value, -limit, limit);
};

export const ImageDetailModal = ({
  image,
  onClose,
  onSaveState,
  onRenameFile,
  onDeleteFile,
  onOpenWorkflow,
  navigation,
  onNavigate,
}: ImageDetailModalProps) => {
  const { t } = useI18n();
  const { confirm } = useConfirm();
  const { pushToast } = useToast();
  const [metadata, setMetadata] = useState<ImageMetadata | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState(() => image.title || "");
  const [draftCategory, setDraftCategory] = useState(() => image.category || "");
  const [draftNotes, setDraftNotes] = useState(() => image.notes || "");
  const [draftPinned, setDraftPinned] = useState(() => image.pinned || image.favorite || false);
  const [draftFilename, setDraftFilename] = useState(() => image.filename || "");
  const [isExpandedView, setIsExpandedView] = useState(false);
  const [showInspector, setShowInspector] = useState(false);
  const [savedStateSnapshot, setSavedStateSnapshot] = useState<DraftStateSnapshot>({
    title: image.title || "",
    category: image.category || "",
    notes: image.notes || "",
    pinned: image.pinned || image.favorite || false,
  });
  const [isSavingState, setIsSavingState] = useState(false);
  const [stateSaveError, setStateSaveError] = useState<string | null>(null);
  const [zoomScale, setZoomScale] = useState(MIN_ZOOM);
  const [pan, setPan] = useState<PanPosition>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const mediaRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const previousOverflowRef = useRef<string>("");

  useEffect(() => {
    let cancelled = false;

    const loadMetadata = async () => {
      try {
        const response = await galleryApi.getImageMetadata(image.relative_path);
        if (cancelled) {
          return;
        }

        setMetadata(response);
        setDraftTitle(response.state.title || image.title || "");
        setDraftCategory(response.state.category || image.category || "");
        setDraftNotes(response.state.notes || image.notes || "");
        setDraftPinned(response.state.pinned || response.state.favorite || image.pinned || image.favorite || false);
        setDraftFilename(response.filename || image.filename || "");
        setSavedStateSnapshot({
          title: response.state.title || image.title || "",
          category: response.state.category || image.category || "",
          notes: response.state.notes || image.notes || "",
          pinned: response.state.pinned || response.state.favorite || image.pinned || image.favorite || false,
        });
        setStateSaveError(null);
      } catch (fetchError) {
        if (!cancelled) {
          setError(fetchError instanceof Error ? fetchError.message : t("modalLoading"));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    void loadMetadata();

    return () => {
      cancelled = true;
    };
  }, [image, t]);

  useEffect(() => {
    previousOverflowRef.current = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflowRef.current;
    };
  }, []);

  const metadataKeys = metadata?.metadata ? Object.keys(metadata.metadata) : [];
  const canOpenWorkflow = Boolean(
    metadata?.workflow ||
      (metadata?.metadata && typeof metadata.metadata === "object" && "prompt" in metadata.metadata),
  );

  const backgroundImage = image.thumb_url || image.original_url || image.url;
  const currentIndex = navigation?.currentIndex ?? 0;
  const totalItems = navigation?.items.length ?? 1;
  const isZoomed = zoomScale > MIN_ZOOM + 0.01;
  const zoomPercentage = Math.round(zoomScale * 100);
  const pinLabel = draftPinned ? t("galleryUnpin") : t("galleryPin");
  const getTooltipProps = (label: string) => ({
    title: label,
    "data-tooltip": label,
  });

  const detailStats = [formatFileSize(image.size), formatLongDateTime(image.created_at)];
  const isStateDirty =
    draftTitle !== savedStateSnapshot.title ||
    draftCategory !== savedStateSnapshot.category ||
    draftNotes !== savedStateSnapshot.notes ||
    draftPinned !== savedStateSnapshot.pinned;

  const resetViewport = () => {
    dragStateRef.current = null;
    setPan({ x: 0, y: 0 });
    setZoomScale(MIN_ZOOM);
    setIsExpandedView(false);
    setIsDragging(false);
  };

  const updateZoom = (nextScale: number, clientX?: number, clientY?: number) => {
    const media = mediaRef.current;
    const boundedScale = clamp(nextScale, MIN_ZOOM, MAX_ZOOM);

    if (!media || clientX === undefined || clientY === undefined || zoomScale === MIN_ZOOM && boundedScale === MIN_ZOOM) {
      if (boundedScale === MIN_ZOOM) {
        resetViewport();
        return;
      }

      setZoomScale(boundedScale);
      setPan({ x: 0, y: 0 });
      setIsExpandedView(boundedScale > MIN_ZOOM);
      return;
    }

    const rect = media.getBoundingClientRect();
    const pointerX = clientX - rect.left - rect.width / 2;
    const pointerY = clientY - rect.top - rect.height / 2;
    const factor = boundedScale / zoomScale;

    setPan((current) => ({
      x:
        boundedScale === MIN_ZOOM
          ? 0
          : clampPan(current.x + (pointerX - current.x) * (1 - factor), boundedScale, rect.width),
      y:
        boundedScale === MIN_ZOOM
          ? 0
          : clampPan(current.y + (pointerY - current.y) * (1 - factor), boundedScale, rect.height),
    }));
    setZoomScale(boundedScale);
    setIsExpandedView(boundedScale > MIN_ZOOM);
    if (boundedScale === MIN_ZOOM) {
      setIsDragging(false);
    }
  };

  const handleWheelZoom = (event: ReactWheelEvent<HTMLDivElement>) => {
    event.preventDefault();

    const multiplier = event.deltaY < 0 ? 1.16 : 0.86;
    const nextScale = Number((zoomScale * multiplier).toFixed(3));
    updateZoom(nextScale, event.clientX, event.clientY);
  };

  const handlePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || !isZoomed) {
      return;
    }

    event.preventDefault();
    dragStateRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: pan.x,
      originY: pan.y,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsDragging(true);
  };

  const handlePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    const media = mediaRef.current;
    if (!dragState || !media || dragState.pointerId !== event.pointerId) {
      return;
    }

    const rect = media.getBoundingClientRect();
    setPan({
      x: clampPan(dragState.originX + event.clientX - dragState.startX, zoomScale, rect.width),
      y: clampPan(dragState.originY + event.clientY - dragState.startY, zoomScale, rect.height),
    });
  };

  const handlePointerEnd = (event: ReactPointerEvent<HTMLDivElement>) => {
    const dragState = dragStateRef.current;
    if (!dragState || dragState.pointerId !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    dragStateRef.current = null;
    setIsDragging(false);
  };

  const handleDoubleClick = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (isZoomed) {
      resetViewport();
      return;
    }

    updateZoom(2, event.clientX, event.clientY);
  };

  const handleSave = async () => {
    setIsSavingState(true);
    setStateSaveError(null);
    try {
      await onSaveState(image.relative_path, {
        title: draftTitle,
        category: draftCategory,
        notes: draftNotes,
        pinned: draftPinned,
      });
      setSavedStateSnapshot({
        title: draftTitle,
        category: draftCategory,
        notes: draftNotes,
        pinned: draftPinned,
      });
      pushToast(t("modalSaveState"), "success");
    } catch (saveError) {
      setStateSaveError(saveError instanceof Error ? saveError.message : t("imageStateSaveError"));
      pushToast(saveError instanceof Error ? saveError.message : t("imageStateSaveError"), "error");
      throw saveError;
    } finally {
      setIsSavingState(false);
    }
  };

  const handleRename = async () => {
    await onRenameFile(image.relative_path, draftFilename);
  };

  const handleDelete = async () => {
    const approved = await confirm({
      title: t("modalDeleteFile"),
      message: t("imageDeleteConfirm", { name: image.filename }),
      tone: "warning",
      confirmLabel: t("commonDelete"),
      cancelLabel: t("libraryCancel"),
    });
    if (!approved) {
      return;
    }

    await onDeleteFile(image.relative_path);
    onClose();
  };

  const handleRequestClose = async () => {
    if (isStateDirty) {
      const approved = await confirm({
        title: t("modalUnsavedStateTitle"),
        message: t("modalUnsavedStateText"),
        tone: "warning",
        confirmLabel: t("modalDiscardChanges"),
        cancelLabel: t("libraryCancel"),
      });
      if (!approved) {
        return;
      }
    }
    onClose();
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void handleSave();
      }

      if (event.key === "Escape") {
        event.preventDefault();
        void handleRequestClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  return (
    <div className="ue-modal-backdrop ue-modal-backdrop--lightbox" onClick={() => void handleRequestClose()}>
      <div className="ue-lightbox-shell" onClick={(event) => event.stopPropagation()}>
        <div className="ue-lightbox-backdrop" style={{ backgroundImage: `url(${backgroundImage})` }} />

        <button
          className="ue-lightbox-close"
          onClick={() => void handleRequestClose()}
          aria-label={t("modalClose")}
          {...getTooltipProps(t("modalClose"))}
        >
          <X size={20} />
        </button>

        <div className={`ue-lightbox-stage ${showInspector ? "has-inspector" : ""}`}>
          <div
            ref={mediaRef}
            className={`ue-lightbox-media ${isExpandedView ? "is-expanded" : "is-fit"} ${isZoomed ? "is-zoomed" : ""} ${isDragging ? "is-dragging" : ""}`}
            onWheel={handleWheelZoom}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerEnd}
            onPointerCancel={handlePointerEnd}
            onDoubleClick={handleDoubleClick}
          >
            <div className="ue-lightbox-gesture-hint">{t("modalGestureHint")}</div>
            <img
              src={image.original_url || image.url}
              alt={image.title || image.filename}
              draggable={false}
              style={{ transform: `translate3d(${pan.x}px, ${pan.y}px, 0) scale(${zoomScale})` }}
            />
          </div>

          <aside className={`ue-lightbox-inspector ${showInspector ? "is-open" : ""}`}>
            <div className="ue-lightbox-inspector-head">
              <div>
                <h3>{draftFilename || image.filename}</h3>
                <p>{detailStats.join(" · ")}</p>
              </div>
              <a
                href={image.url}
                target="_blank"
                rel="noreferrer"
                className="ue-detail-link ue-detail-link--icon"
                aria-label={t("modalOpenFull")}
                title={t("modalOpenFull")}
              >
                <ExternalLink size={14} />
              </a>
            </div>

            <section className="ue-detail-section">
              <div className="ue-detail-section-title">
                <Palette size={15} />
                <span>{t("modalEditSection")}</span>
              </div>

              <div className="ue-detail-form">
                <label>
                  <span>{t("modalTitleField")}</span>
                  <input
                    value={draftTitle}
                    onChange={(event) => setDraftTitle(event.target.value)}
                    placeholder={t("galleryTitlePlaceholder")}
                  />
                </label>
                <label>
                  <span>{t("modalFilenameField")}</span>
                  <input value={draftFilename} onChange={(event) => setDraftFilename(event.target.value)} />
                </label>
                <label>
                  <span>{t("modalCategory")}</span>
                  <input
                    value={draftCategory}
                    onChange={(event) => setDraftCategory(event.target.value)}
                    placeholder={t("galleryCategoryPlaceholder")}
                  />
                </label>
                <label>
                  <span>{t("modalNotesField")}</span>
                  <textarea
                    value={draftNotes}
                    onChange={(event) => setDraftNotes(event.target.value)}
                    placeholder={t("galleryNotesPlaceholder")}
                  />
                </label>
              </div>

              <div className="ue-detail-savebar">
                <div className="ue-detail-savecopy">
                  <strong>{isStateDirty ? t("modalUnsavedStateBadge") : t("modalSavedStateBadge")}</strong>
                  <span>{t("modalSaveHint")}</span>
                </div>
                <button
                  className="ue-icon-action ue-icon-action--filled"
                  onClick={() => void handleSave()}
                  disabled={!isStateDirty || isSavingState}
                  aria-label={isSavingState ? t("commonLoading") : t("modalSaveState")}
                  title={isSavingState ? t("commonLoading") : t("modalSaveState")}
                >
                  <Save size={14} />
                </button>
              </div>
              {stateSaveError ? <div className="ue-inline-error">{stateSaveError}</div> : null}
            </section>

            {isLoading ? (
              <div className="ue-detail-state">
                <div className="ue-loading-orb" />
                <p>{t("modalLoading")}</p>
              </div>
            ) : error ? (
              <div className="ue-inline-error">{error}</div>
            ) : (
              <>
                {metadata?.artist_prompts?.length ? (
                  <details className="ue-detail-disclosure">
                    <summary>
                      <Palette size={15} />
                      <span>{t("modalPromptSection")}</span>
                      <strong>{metadata.artist_prompts.length}</strong>
                    </summary>
                    <div className="ue-detail-pill-list">
                      {metadata.artist_prompts.map((prompt, index) => (
                        <div key={`${prompt}-${index}`} className="ue-detail-pill">
                          {prompt}
                        </div>
                      ))}
                    </div>
                  </details>
                ) : null}

                {metadata?.metadata && metadataKeys.length ? (
                  <details className="ue-detail-disclosure">
                    <summary>
                      <FileJson size={15} />
                      <span>{t("modalMetadataSection")}</span>
                      <strong>{metadataKeys.length}</strong>
                    </summary>
                    <pre className="ue-meta-raw">{JSON.stringify(metadata.metadata, null, 2)}</pre>
                  </details>
                ) : (
                  <div className="ue-detail-state ue-detail-state--empty">
                    <p>{t("modalNoMetadata")}</p>
                  </div>
                )}
              </>
            )}
          </aside>
        </div>

        <div className="ue-lightbox-toolbar">
          <button
            className="ue-toolbar-btn"
            disabled={!navigation || currentIndex <= 0}
            onClick={() => onNavigate(Math.max(0, currentIndex - 1))}
            aria-label={t("galleryPrevious")}
            {...getTooltipProps(t("galleryPrevious"))}
          >
            <ChevronLeft size={17} />
          </button>
          <span className="ue-lightbox-page-indicator">
            {currentIndex + 1}/{totalItems}
          </span>
          <span className="ue-lightbox-zoom-indicator">{zoomPercentage}%</span>
          <button
            className="ue-toolbar-btn"
            disabled={!navigation || currentIndex >= totalItems - 1}
            onClick={() => onNavigate(Math.min(totalItems - 1, currentIndex + 1))}
            aria-label={t("galleryNext")}
            {...getTooltipProps(t("galleryNext"))}
          >
            <ChevronRight size={17} />
          </button>
          <span className="ue-toolbar-divider" />
          <button
            className="ue-toolbar-btn"
            onClick={() => setShowInspector((current) => !current)}
            aria-label={t("modalToggleInspector")}
            {...getTooltipProps(t("modalToggleInspector"))}
          >
            <BookOpen size={17} />
          </button>
          <span className="ue-toolbar-divider" />
          <button
            className="ue-toolbar-btn"
            onClick={resetViewport}
            aria-label={t("modalFitImage")}
            {...getTooltipProps(t("modalFitImage"))}
          >
            <Shrink size={17} />
          </button>
          <button
            className="ue-toolbar-btn"
            onClick={() => updateZoom(Math.max(zoomScale, 2))}
            aria-label={t("modalExpandImage")}
            {...getTooltipProps(t("modalExpandImage"))}
          >
            <Expand size={17} />
          </button>
          <span className="ue-toolbar-divider" />
          <button
            className="ue-toolbar-btn ue-toolbar-btn--filled"
            onClick={() => void handleSave()}
            aria-label={t("modalSaveState")}
            {...getTooltipProps(t("modalSaveState"))}
            disabled={isSavingState}
          >
            <Save size={17} />
          </button>
          {canOpenWorkflow ? (
            <button
              className="ue-toolbar-btn"
              onClick={() => void onOpenWorkflow(image)}
              aria-label={t("modalOpenWorkflow")}
              {...getTooltipProps(t("modalOpenWorkflow"))}
            >
              <Boxes size={17} />
            </button>
          ) : null}
          <button
            className="ue-toolbar-btn"
            onClick={() => setDraftPinned((current) => !current)}
            aria-label={pinLabel}
            {...getTooltipProps(pinLabel)}
          >
            <Pin size={17} fill={draftPinned ? "currentColor" : "none"} />
          </button>
          <button
            className="ue-toolbar-btn"
            onClick={() => void handleRename()}
            aria-label={t("modalRenameFile")}
            {...getTooltipProps(t("modalRenameFile"))}
          >
            <PencilLine size={17} />
          </button>
          <button
            className="ue-toolbar-btn ue-toolbar-btn--danger"
            onClick={() => void handleDelete()}
            aria-label={t("modalDeleteFile")}
            {...getTooltipProps(t("modalDeleteFile"))}
          >
            <Trash2 size={17} />
          </button>
          <span className="ue-toolbar-divider" />
          <a
            href={image.url}
            target="_blank"
            rel="noreferrer"
            className="ue-toolbar-btn"
            aria-label={t("modalOpenFull")}
            {...getTooltipProps(t("modalOpenFull"))}
          >
            <ExternalLink size={17} />
          </a>
        </div>
      </div>
    </div>
  );
};
