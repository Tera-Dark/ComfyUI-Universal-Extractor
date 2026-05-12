import { describe, expect, it } from "vitest";

import { dedupeVisibleSelection, getSelectionBoxRect, rectsIntersect, selectPathRange, togglePathSelection } from "./gallerySelectionModel";

describe("gallerySelectionModel", () => {
  it("dedupes selection while keeping only visible paths", () => {
    expect(dedupeVisibleSelection(["b", "a", "b", "missing"], ["a", "b"])).toEqual(["b", "a"]);
  });

  it("toggles one path in the current selection", () => {
    expect(togglePathSelection(["a", "b"], "a")).toEqual(["b"]);
    expect(togglePathSelection(["a"], "b")).toEqual(["a", "b"]);
  });

  it("selects an inclusive visible range from anchor to target", () => {
    expect(
      selectPathRange({
        anchorPath: "b",
        targetPath: "d",
        selectedPaths: ["a"],
        visibleSelectionPaths: ["a", "b", "c", "d"],
      }),
    ).toEqual(["a", "b", "c", "d"]);
  });

  it("normalizes drag box coordinates and tests intersections", () => {
    const box = getSelectionBoxRect({ startX: 120, startY: 80, currentX: 40, currentY: 140 });
    expect(box).toEqual({ left: 40, right: 120, top: 80, bottom: 140 });
    expect(rectsIntersect(box, { left: 100, right: 130, top: 100, bottom: 160 })).toBe(true);
    expect(rectsIntersect(box, { left: 130, right: 150, top: 100, bottom: 160 })).toBe(false);
  });
});
