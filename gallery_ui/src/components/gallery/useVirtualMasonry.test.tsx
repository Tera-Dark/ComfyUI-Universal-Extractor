import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ImageRecord } from "../../types/universal-gallery";
import { getEffectiveMasonryColumns, getMasonryColumnWidth, mapVirtualMasonryItems, useVirtualMasonry } from "./useVirtualMasonry";

const makeImage = (index: number): ImageRecord => ({
  filename: `image-${index}.png`,
  relative_path: `folder/image-${index}.png`,
  subfolder: "folder",
  url: `/view?filename=image-${index}.png&type=output`,
  original_url: `/view?filename=image-${index}.png&type=output`,
  thumb_url: `/thumb/image-${index}.png`,
  size: 1024 + index,
  created_at: index,
  favorite: false,
  pinned: false,
  boards: [],
  category: "",
  title: "",
  notes: "",
});

describe("useVirtualMasonry", () => {
  it("clamps requested columns to the available width", () => {
    expect(getEffectiveMasonryColumns(8, 360, 14)).toBe(1);
    expect(getEffectiveMasonryColumns(8, 900, 14)).toBe(4);
    expect(getEffectiveMasonryColumns(3, 1600, 14)).toBe(3);
  });

  it("calculates a stable column width from the container", () => {
    expect(getMasonryColumnWidth(900, 4, 14)).toBeCloseTo(214.5);
    expect(getMasonryColumnWidth(240, 2, 14)).toBe(160);
  });

  it("maps virtual rows to masonry card positions", () => {
    const images = Array.from({ length: 4 }, (_, index) => makeImage(index));
    const items = mapVirtualMasonryItems({
      images,
      virtualItems: [
        { index: 0, start: 0, lane: 0 },
        { index: 1, start: 0, lane: 1 },
        { index: 2, start: 280, lane: 0 },
      ],
      columnWidth: 220,
      gap: 14,
    });

    expect(items).toEqual([
      { image: images[0], index: 0, top: 0, left: 0, width: 220, lane: 0 },
      { image: images[1], index: 1, top: 0, left: 234, width: 220, lane: 1 },
      { image: images[2], index: 2, top: 280, left: 0, width: 220, lane: 0 },
    ]);
  });

  it("returns stable layout metadata from the hook", () => {
    const scrollElement = document.createElement("div");
    Object.defineProperty(scrollElement, "clientHeight", { configurable: true, value: 720 });
    Object.defineProperty(scrollElement, "scrollHeight", { configurable: true, value: 2000 });
    const images = Array.from({ length: 40 }, (_, index) => makeImage(index));

    const { result } = renderHook(() =>
      useVirtualMasonry({
        images,
        requestedColumns: 6,
        gridWidth: 1200,
        viewportWidth: 1200,
        scrollElement,
        gap: 14,
      }),
    );

    expect(result.current.columnCount).toBe(6);
    expect(result.current.columnWidth).toBeCloseTo(188.33);
    expect(result.current.items.length).toBeLessThanOrEqual(images.length);
    expect(result.current.measureElement).toEqual(expect.any(Function));
  });
});
