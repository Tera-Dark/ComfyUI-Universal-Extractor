import { useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, Images, X } from "lucide-react";

import { useI18n } from "../../i18n/I18nProvider";
import { galleryApi } from "../../services/galleryApi";
import type { BoardSummary, ImageRecord } from "../../types/universal-gallery";
import { useToast } from "../shared/ToastViewport";

interface BoardShareModalProps {
  open: boolean;
  board: BoardSummary | null;
  onClose: () => void;
}

const SHARE_COLUMNS = 5;
const SHARE_ROWS = 4;
const SHARE_LIMIT = SHARE_COLUMNS * SHARE_ROWS;
const TILE_SIZE = 220;
const GAP = 14;
const PADDING = 34;
const HEADER_HEIGHT = 120;
const CANVAS_WIDTH = PADDING * 2 + TILE_SIZE * SHARE_COLUMNS + GAP * (SHARE_COLUMNS - 1);
const CANVAS_HEIGHT = PADDING * 2 + HEADER_HEIGHT + TILE_SIZE * SHARE_ROWS + GAP * (SHARE_ROWS - 1);

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });

const drawCover = (
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) => {
  const imageRatio = image.width / image.height;
  const tileRatio = width / height;
  const sourceWidth = imageRatio > tileRatio ? image.height * tileRatio : image.width;
  const sourceHeight = imageRatio > tileRatio ? image.height : image.width / tileRatio;
  const sourceX = (image.width - sourceWidth) / 2;
  const sourceY = (image.height - sourceHeight) / 2;
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, x, y, width, height);
};

export const BoardShareModal = ({ open, board, onClose }: BoardShareModalProps) => {
  const { t } = useI18n();
  const { pushToast } = useToast();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isRendering, setIsRendering] = useState(false);

  const title = board?.name ?? "";
  const subtitle = useMemo(
    () => (board ? t("boardShareSubtitle", { count: board.count }) : ""),
    [board, t],
  );

  useEffect(() => {
    if (!open || !board) {
      return;
    }

    let cancelled = false;
    setIsLoading(true);
    void galleryApi
      .listImages(1, SHARE_LIMIT, "", "", "", board.id, "", "", false, "created_at", "desc", false)
      .then((response) => {
        if (!cancelled) {
          setImages(response.images ?? []);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          pushToast(error instanceof Error ? error.message : t("boardShareError"), "error");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [board, open, pushToast, t]);

  useEffect(() => {
    if (!open || !board || !canvasRef.current) {
      return;
    }

    let cancelled = false;
    const render = async () => {
      setIsRendering(true);
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = CANVAS_WIDTH;
      canvas.height = CANVAS_HEIGHT;
      const context = canvas.getContext("2d");
      if (!context) return;

      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
      context.fillStyle = "#18181b";
      context.font = "700 46px Inter, Arial, sans-serif";
      context.fillText(title, PADDING, PADDING + 42, CANVAS_WIDTH - PADDING * 2);
      context.fillStyle = "#71717a";
      context.font = "500 22px Inter, Arial, sans-serif";
      context.fillText(subtitle, PADDING, PADDING + 80, CANVAS_WIDTH - PADDING * 2);

      context.fillStyle = "#f4f4f5";
      const startY = PADDING + HEADER_HEIGHT;
      for (let index = 0; index < SHARE_LIMIT; index += 1) {
        const col = index % SHARE_COLUMNS;
        const row = Math.floor(index / SHARE_COLUMNS);
        const x = PADDING + col * (TILE_SIZE + GAP);
        const y = startY + row * (TILE_SIZE + GAP);
        context.fillRect(x, y, TILE_SIZE, TILE_SIZE);
      }

      const loaded = await Promise.allSettled(images.slice(0, SHARE_LIMIT).map((image) => loadImage(image.thumb_url || image.url)));
      if (cancelled) return;

      loaded.forEach((result, index) => {
        if (result.status !== "fulfilled") return;
        const col = index % SHARE_COLUMNS;
        const row = Math.floor(index / SHARE_COLUMNS);
        const x = PADDING + col * (TILE_SIZE + GAP);
        const y = startY + row * (TILE_SIZE + GAP);
        drawCover(context, result.value, x, y, TILE_SIZE, TILE_SIZE);
      });

      setIsRendering(false);
    };

    void render();
    return () => {
      cancelled = true;
    };
  }, [board, images, open, subtitle, title]);

  const getCanvasBlob = () =>
    new Promise<Blob | null>((resolve) => {
      canvasRef.current?.toBlob((blob) => resolve(blob), "image/png", 0.94);
    });

  const handleDownload = async () => {
    const blob = await getCanvasBlob();
    if (!blob || !board) return;
    const objectUrl = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = objectUrl;
    anchor.download = `${board.name}-share.png`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(objectUrl);
  };

  const handleCopy = async () => {
    const blob = await getCanvasBlob();
    if (!blob || !("ClipboardItem" in window)) {
      pushToast(t("contextCopyImageError"), "error");
      return;
    }
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      pushToast(t("contextCopyImageSuccess"), "success");
    } catch {
      pushToast(t("contextCopyImageError"), "error");
    }
  };

  if (!open || !board) {
    return null;
  }

  return (
    <div className="ue-modal-backdrop" onClick={onClose}>
      <div className="ue-library-modal ue-board-share-modal" onClick={(event) => event.stopPropagation()}>
        <button className="ue-modal-close ue-modal-close--light" onClick={onClose} aria-label={t("modalClose")}>
          <X size={18} />
        </button>

        <div className="ue-pane-copy">
          <p className="ue-pane-kicker">{t("boardShareTitle")}</p>
          <h2>{board.name}</h2>
          <p>{isLoading || isRendering ? t("commonLoading") : t("boardShareText")}</p>
        </div>

        <div className="ue-board-share-preview">
          {images.length ? (
            <canvas ref={canvasRef} aria-label={t("boardShareTitle")} />
          ) : (
            <div className="ue-gallery-state ue-gallery-state--empty">
              <Images size={32} />
              <p>{isLoading ? t("commonLoading") : t("boardEmptyText")}</p>
            </div>
          )}
        </div>

        <div className="ue-library-modal-actions">
          <button className="ue-icon-action" onClick={onClose} aria-label={t("libraryCancel")} title={t("libraryCancel")}>
            <X size={14} />
          </button>
          <button
            className="ue-icon-action"
            onClick={() => void handleCopy()}
            disabled={!images.length || isRendering}
            aria-label={t("contextCopyImage")}
            title={t("contextCopyImage")}
          >
            <Copy size={14} />
          </button>
          <button
            className="ue-icon-action ue-icon-action--filled"
            onClick={() => void handleDownload()}
            disabled={!images.length || isRendering}
            aria-label={t("boardShareDownload")}
            title={t("boardShareDownload")}
          >
            <Download size={14} />
          </button>
        </div>
      </div>
    </div>
  );
};
