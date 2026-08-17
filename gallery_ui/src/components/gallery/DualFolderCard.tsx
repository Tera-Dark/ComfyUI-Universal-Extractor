import type { DragEvent, MouseEvent } from "react";
import { Check } from "lucide-react";

import type { ImageRecord } from "../../types/universal-gallery";
import { formatCompactDate, formatFileSize } from "../../utils/formatters";
import { getGalleryImageUrl } from "./galleryImagePrefetch";

export const getDualFolderImageResolution = (image: ImageRecord) => {
  const width = Number(image.width ?? 0);
  const height = Number(image.height ?? 0);
  return width > 0 && height > 0 ? `${width} × ${height}` : "";
};

interface DualFolderCardProps {
  image: ImageRecord;
  selected: boolean;
  focused: boolean;
  draggedPaths: string[];
  deselectLabel: string;
  onClick: (event: MouseEvent<HTMLElement>) => void;
  onDoubleClick: (event: MouseEvent<HTMLElement>) => void;
  onContextMenu: (event: MouseEvent<HTMLElement>) => void;
  onDragStart: (event: DragEvent<HTMLElement>, draggedPaths: string[]) => void;
  onDragEnd: () => void;
  onToggleSelected: () => void;
}

export const DualFolderCard = ({
  image,
  selected,
  focused,
  draggedPaths,
  deselectLabel,
  onClick,
  onDoubleClick,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onToggleSelected,
}: DualFolderCardProps) => {
  const resolution = getDualFolderImageResolution(image);

  return (
    <article
      className={`ue-dual-card ${selected ? "is-selected" : ""} ${focused ? "is-focused" : ""}`}
      draggable
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
      onDragStart={(event) => onDragStart(event, draggedPaths)}
      onDragEnd={onDragEnd}
    >
      <button className="ue-dual-card-preview" type="button" tabIndex={-1}>
        <img src={getGalleryImageUrl(image)} alt={image.title || image.filename} loading="lazy" decoding="async" />
      </button>
      <div className="ue-dual-card-copy">
        <div className="ue-dual-card-heading">
          <strong title={image.filename}>{image.filename}</strong>
          {resolution ? <span className="ue-dual-card-resolution">{resolution}</span> : null}
        </div>
        <span className="ue-dual-card-meta">
          {formatCompactDate(image.created_at)}
          <i aria-hidden="true">/</i>
          {formatFileSize(image.size)}
        </span>
        {image.title ? <em title={image.title}>{image.title}</em> : null}
      </div>
      {selected ? (
        <button
          className="ue-dual-card-check"
          type="button"
          aria-label={deselectLabel}
          title={deselectLabel}
          onClick={(event) => {
            event.stopPropagation();
            onToggleSelected();
          }}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          <Check size={16} />
        </button>
      ) : null}
    </article>
  );
};
