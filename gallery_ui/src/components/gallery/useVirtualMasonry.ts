import { useMemo } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";

import type { ImageRecord } from "../../types/universal-gallery";

const MIN_CARD_WIDTH_DESKTOP = 180;
const MIN_CARD_WIDTH_TABLET = 190;
const MIN_CARD_WIDTH_MOBILE = 220;
const MIN_COLUMN_WIDTH = 160;
const DEFAULT_CARD_RATIO = 1.36;
const CARD_CHROME_HEIGHT = 54;

export interface VirtualMasonryItem {
  image: ImageRecord;
  index: number;
  top: number;
  left: number;
  width: number;
  lane: number;
}

export const getEffectiveMasonryColumns = (requestedColumns: number, availableWidth: number, gap: number) => {
  const minCardWidth =
    availableWidth <= 560 ? MIN_CARD_WIDTH_MOBILE : availableWidth <= 960 ? MIN_CARD_WIDTH_TABLET : MIN_CARD_WIDTH_DESKTOP;
  const maxColumnsForWidth = Math.max(1, Math.floor((availableWidth + gap) / (minCardWidth + gap)));
  return Math.max(1, Math.min(requestedColumns, maxColumnsForWidth));
};

export const getMasonryColumnWidth = (availableWidth: number, columnCount: number, gap: number) =>
  Math.max(MIN_COLUMN_WIDTH, (availableWidth - gap * (columnCount - 1)) / columnCount);

export const estimateMasonryCardHeight = (columnWidth: number) => Math.round(columnWidth * DEFAULT_CARD_RATIO + CARD_CHROME_HEIGHT);

export const mapVirtualMasonryItems = ({
  images,
  virtualItems,
  columnWidth,
  gap,
}: {
  images: ImageRecord[];
  virtualItems: Array<{ index: number; start: number; lane: number }>;
  columnWidth: number;
  gap: number;
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
        top: item.start,
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
}: {
  images: ImageRecord[];
  requestedColumns: number;
  gridWidth: number;
  viewportWidth: number;
  scrollElement: HTMLElement | null;
  gap: number;
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
  const estimatedCardHeight = useMemo(() => estimateMasonryCardHeight(columnWidth), [columnWidth]);

  // eslint-disable-next-line react-hooks/incompatible-library -- TanStack Virtual intentionally returns imperative measurement functions.
  const virtualizer = useVirtualizer<HTMLElement, HTMLElement>({
    count: images.length,
    getScrollElement: () => scrollElement,
    getItemKey: (index) => images[index]?.relative_path ?? index,
    estimateSize: () => estimatedCardHeight,
    gap,
    lanes: columnCount,
    overscan: Math.max(columnCount * 3, 8),
    useAnimationFrameWithResizeObserver: true,
    laneAssignmentMode: "estimate",
  });

  const virtualItems = virtualizer.getVirtualItems();
  const items = useMemo<VirtualMasonryItem[]>(
    () =>
      mapVirtualMasonryItems({
        images,
        virtualItems,
        columnWidth,
        gap,
      }),
    [columnWidth, gap, images, virtualItems],
  );

  return {
    columnCount,
    columnWidth,
    items,
    totalHeight: virtualizer.getTotalSize(),
    measureElement: virtualizer.measureElement,
  };
};
