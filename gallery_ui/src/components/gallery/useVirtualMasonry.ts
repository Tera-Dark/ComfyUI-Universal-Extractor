import { useCallback, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import type { ImageRecord } from "../../types/universal-gallery";
import { galleryDensityMetrics, type InterfaceDensity } from "./galleryDensity";

// Six columns fit a normal 1440px window after sidebar and gallery padding.
// The metadata row is now single-line, so 160px cards do not grow while scrolling.
const MIN_CARD_WIDTH_DESKTOP = 160;
const MIN_CARD_WIDTH_TABLET = 190;
const MIN_CARD_WIDTH_MOBILE = 145; // Compact mobile preset fits two tappable cards at ~390px.
const MIN_COLUMN_WIDTH = 160;
const DEFAULT_CARD_RATIO = 1.36;
// gallery.css + minimal.css: 1px borders, 100px minimum media height, and
// ~43px for the caption on a single line. Wrapped metadata is RO-measured.
const CARD_BORDER_WIDTH = 2;
const MIN_MEDIA_HEIGHT = 100;

// The media box and the virtualizer must agree on the size of images without
// dimensions. Otherwise a lazy thumbnail expands the card when it finally loads
// (often at the bottom of a page) and scroll anchoring jumps with it.
export const getMasonryImageHeightRatio = (image?: Pick<ImageRecord, "width" | "height">) => {
  const width = Number(image?.width ?? 0);
  const height = Number(image?.height ?? 0);
  const ratio = width > 0 && height > 0 ? height / width : 0;
  return Number.isFinite(ratio) && ratio > 0 ? ratio : DEFAULT_CARD_RATIO;
};

export interface VirtualMasonryItem {
  image: ImageRecord;
  index: number;
  top: number;
  left: number;
  width: number;
  lane: number;
  height?: number;
  mediaRatio?: number;
}

export const masonryImageKey = (image: ImageRecord) => JSON.stringify([
  image.relative_path, image.asset_id ?? "", image.content_revision ?? 0,
  image.size, image.created_at,
]);

export const getEffectiveMasonryColumns = (requestedColumns: number, availableWidth: number, gap: number) => {
  const minCardWidth =
    availableWidth <= 560 ? MIN_CARD_WIDTH_MOBILE : availableWidth <= 960 ? MIN_CARD_WIDTH_TABLET : MIN_CARD_WIDTH_DESKTOP;
  const maxColumnsForWidth = Math.max(1, Math.floor((availableWidth + gap) / (minCardWidth + gap)));
  return Math.max(1, Math.min(requestedColumns, maxColumnsForWidth));
};

export const getMasonryColumnWidth = (availableWidth: number, columnCount: number, gap: number) =>
  Math.max(MIN_COLUMN_WIDTH, (availableWidth - gap * (columnCount - 1)) / columnCount);

export const estimateMasonryCardHeight = (columnWidth: number, image?: Pick<ImageRecord, "width" | "height">, density: InterfaceDensity = "standard") => {
  const ratio = getMasonryImageHeightRatio(image);
  // CSS gives very wide images a 100px media minimum. Use the same aspect
  // ratio as the rendered card, including the fallback for missing metadata.
  return Math.round(Math.max(MIN_MEDIA_HEIGHT, (columnWidth - CARD_BORDER_WIDTH) * ratio) + galleryDensityMetrics(density).chrome);
};

export const mapVirtualMasonryItems = ({
  images,
  virtualItems,
  columnWidth,
  gap,
  scrollMargin = 0,
}: {
  images: ImageRecord[];
  virtualItems: Array<{ index: number; start: number; lane: number }>;
  columnWidth: number;
  gap: number;
  scrollMargin?: number;
}) =>
  virtualItems
    .map((item) => {
      const image = images[item.index];
      if (!image) {
        return null;
      }
      return {
        image,
        index: item.index,
        top: item.start - scrollMargin,
        left: item.lane * (columnWidth + gap),
        width: columnWidth,
        lane: item.lane,
      };
    })
    .filter((item): item is VirtualMasonryItem => item !== null);

export const useVirtualMasonry = ({
  images,
  requestedColumns,
  gridWidth,
  viewportWidth,
  scrollElement,
  gap,
  density = "standard",
  scrollMargin = 0,
}: {
  images: ImageRecord[];
  requestedColumns: number;
  gridWidth: number;
  viewportWidth: number;
  scrollElement: HTMLElement | null;
  gap: number;
  density?: InterfaceDensity;
  scrollMargin?: number;
}) => {
  const availableWidth = gridWidth > 0 ? gridWidth : Math.max(320, viewportWidth - 32);
  const columnCount = useMemo(
    () => getEffectiveMasonryColumns(requestedColumns, availableWidth, gap),
    [availableWidth, gap, requestedColumns],
  );
  const columnWidth = useMemo(
    () => getMasonryColumnWidth(availableWidth, columnCount, gap),
    [availableWidth, columnCount, gap],
  );

  const signature = JSON.stringify(images.map(masonryImageKey));
  const keys = useMemo<string[]>(() => JSON.parse(signature), [signature]);
  const [geometry, setGeometry] = useState(() => ({ keys, ratios: images.map(getMasonryImageHeightRatio) }));
  let ratios = geometry.ratios;
  if (geometry.keys !== keys) {
    const previous = new Map(geometry.keys.map((key, index) => [key, geometry.ratios[index]]));
    const next = { keys, ratios: images.map((image, index) => previous.get(keys[index]) ?? getMasonryImageHeightRatio(image)) };
    setGeometry(next);
    ratios = next.ratios;
  }
  // Background dimensions/annotations must not rearrange an already browsed
  // content version. New content gets new geometry; leaving the page releases it.
  const getItemKey = useCallback((index: number) => keys[index] ?? index, [keys]);
  const estimateSize = useCallback((index: number) =>
    estimateMasonryCardHeight(columnWidth, { width: 1, height: ratios[index] }, density),
  [columnWidth, density, ratios]);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual intentionally returns imperative measurement functions.
  const virtualizer = useVirtualizer<HTMLElement, HTMLElement>({
    count: images.length,
    getScrollElement: () => scrollElement,
    getItemKey,
    estimateSize,
    scrollMargin,
    gap,
    lanes: columnCount,
    overscan: Math.max(columnCount * 3, 8),
    useAnimationFrameWithResizeObserver: true,
    laneAssignmentMode: "estimate",
  });

  const measuredColumnWidth = useRef(columnWidth);
  const measuredDensity = useRef(density);
  const browseAnchor = useRef<{ key: string | number | bigint; offset: number } | null>(null);
  useLayoutEffect(() => {
    if (Math.abs(measuredColumnWidth.current - columnWidth) > 0.5 || measuredDensity.current !== density) {
      // Cached card heights (and their cached lanes) belong to the old width.
      // Mounted cards get ResizeObserver updates, but offscreen cards do not;
      // without invalidation they move as the user scrolls back toward the end.
      measuredColumnWidth.current = columnWidth;
      measuredDensity.current = density;
      const anchor = browseAnchor.current;
      virtualizer.measure();
      if (anchor) {
        const index = keys.findIndex((key) => key === anchor.key);
        virtualizer.getTotalSize();
        const item = virtualizer.measurementsCache[index];
        if (item) virtualizer.scrollToOffset(item.start - anchor.offset, { align: "start" });
      }
    }
    const offset = virtualizer.scrollOffset ?? 0;
    const anchor = virtualizer.getVirtualItems().find((item) => item.end >= offset);
    browseAnchor.current = anchor ? { key: anchor.key, offset: anchor.start - offset } : null;
  });

  const virtualItems = virtualizer.getVirtualItems();
  const items = useMemo<VirtualMasonryItem[]>(
    () =>
      mapVirtualMasonryItems({
        images,
        virtualItems,
        columnWidth,
        gap,
        scrollMargin,
      }).map((item) => ({ ...item, height: estimateSize(item.index), mediaRatio: ratios[item.index] })),
    [columnWidth, gap, images, virtualItems, scrollMargin, estimateSize, ratios],
  );
  const getItemLayout = useCallback((index: number) => {
    // The public measurement cache includes offscreen items and their actual
    // shortest-lane assignment. Box selection must share the renderer's geometry.
    const item = virtualizer.measurementsCache[index];
    return item ? { top: item.start - scrollMargin, left: item.lane * (columnWidth + gap), width: columnWidth, height: item.size } : null;
  }, [virtualizer, scrollMargin, columnWidth, gap]);

  return {
    columnCount,
    columnWidth,
    items,
    totalHeight: virtualizer.getTotalSize(),
    measureElement: virtualizer.measureElement,
    scrollToIndex: virtualizer.scrollToIndex,
    getItemLayout,
  };
};
