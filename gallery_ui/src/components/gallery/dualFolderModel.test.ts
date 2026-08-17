import { describe, expect, it } from "vitest";

import {
  INTERNAL_IMAGE_MIME,
  dragHasInternalImage,
  emptySelectionState,
  getDualFolderShortcutAction,
  invertPaneSelection,
  readInternalDragPayload,
  selectPaneImage,
  togglePaneBadgeSelection,
  type DragState,
} from "./dualFolderModel";

describe("dualFolderModel", () => {
  it("selects, toggles, and range-selects pane images", () => {
    const paths = ["a.png", "b.png", "c.png", "d.png"];

    const selected = selectPaneImage({
      current: emptySelectionState(),
      paths,
      path: "b.png",
      shiftKey: false,
      toggleKey: false,
    });
    expect(selected.selectedPaths).toEqual(["b.png"]);

    const toggled = selectPaneImage({
      current: selected,
      paths,
      path: "d.png",
      shiftKey: false,
      toggleKey: true,
    });
    expect(toggled.selectedPaths).toEqual(["b.png", "d.png"]);

    const ranged = selectPaneImage({
      current: toggled,
      paths,
      path: "a.png",
      shiftKey: true,
      toggleKey: false,
    });
    expect(ranged.selectedPaths).toEqual(["a.png", "b.png", "c.png", "d.png"]);
  });

  it("inverts and badge-toggles pane selection", () => {
    const current = { selectedPaths: ["a.png", "c.png"], focusedPath: "c.png", lastSelectedPath: "c.png" };

    expect(invertPaneSelection(["a.png", "b.png", "c.png"], current)).toEqual({
      selectedPaths: ["b.png"],
      focusedPath: "b.png",
      lastSelectedPath: "b.png",
    });

    expect(togglePaneBadgeSelection("c.png", current)).toEqual({
      selectedPaths: ["a.png"],
      focusedPath: "a.png",
      lastSelectedPath: "c.png",
    });
  });

  it("parses internal image drag payloads", () => {
    const payload = {
      from: "left",
      relativePaths: ["a.png"],
      image: { relative_path: "a.png" },
      sourceFolder: "default_output::",
    } as DragState;

    expect(dragHasInternalImage(["text/plain", INTERNAL_IMAGE_MIME])).toBe(true);
    expect(readInternalDragPayload((format) => (format === INTERNAL_IMAGE_MIME ? JSON.stringify(payload) : ""))).toEqual(payload);
    expect(readInternalDragPayload(() => "{broken")).toBeNull();
    expect(readInternalDragPayload(() => JSON.stringify({ ...payload, relativePaths: "a.png" }))).toBeNull();
    expect(readInternalDragPayload(() => JSON.stringify({ ...payload, from: "center" }))).toBeNull();
  });

  it("maps supported keyboard shortcuts to stable actions", () => {
    expect(getDualFolderShortcutAction({ key: "a", ctrlKey: true, metaKey: false })).toBe("selectAll");
    expect(getDualFolderShortcutAction({ key: "M", ctrlKey: false, metaKey: true })).toBe("moveToOtherPane");
    expect(getDualFolderShortcutAction({ key: "r", ctrlKey: true, metaKey: false })).toBe("refresh");
    expect(getDualFolderShortcutAction({ key: "Escape", ctrlKey: false, metaKey: false })).toBe("escape");
    expect(getDualFolderShortcutAction({ key: "Delete", ctrlKey: false, metaKey: false })).toBe("delete");
    expect(getDualFolderShortcutAction({ key: "Enter", ctrlKey: false, metaKey: false })).toBe("openDetail");
    expect(getDualFolderShortcutAction({ key: "Tab", ctrlKey: false, metaKey: false })).toBe("togglePane");
  });
});
