import { describe, expect, it } from "vitest";

import {
  adjustRectForScrollDelta,
  dedupeVisibleSelection,
  getIntersectingSelectionKeys,
  getSelectionBoxRect,
  rectsIntersect,
  selectPathRange,
  togglePathSelection,
} from "./gallerySelectionModel";

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

  it("adjusts frozen card rects by scroll delta before intersection", () => {
    expect(adjustRectForScrollDelta({ left: 10, right: 50, top: 80, bottom: 120 }, 30)).toEqual({
      left: 10,
      right: 50,
      top: 50,
      bottom: 90,
    });

    const keys = getIntersectingSelectionKeys({
      selectionBox: { startX: 0, startY: 0, currentX: 100, currentY: 100 },
      keys: ["visible-after-scroll", "outside"],
      scrollDelta: 120,
      getRect: (key) =>
        key === "visible-after-scroll"
          ? { left: 10, right: 90, top: 130, bottom: 200 }
          : { left: 10, right: 90, top: 240, bottom: 300 },
    });

    expect(keys).toEqual(["visible-after-scroll"]);
  });
  it("anchors the rectangle in content coordinates while scrolling",()=>{
    const rects:Record<string,{left:number;right:number;top:number;bottom:number}>={first:{left:10,right:90,top:100,bottom:200},next:{left:10,right:90,top:800,bottom:900}};
    expect(getIntersectingSelectionKeys({selectionBox:{startX:0,startY:90,currentX:100,currentY:350},keys:["first","next"],scrollDelta:600,getRect:key=>rects[key]})).toEqual(["first","next"]);
  });
  it("shrinking the box excludes cards no longer inside its geometry",()=>{
    const getRect=(key:string)=>key==="a" ? {left:10,right:90,top:100,bottom:200} : {left:110,right:190,top:100,bottom:200};
    const box={startX:0,startY:90,currentX:200,currentY:210};
    expect(getIntersectingSelectionKeys({selectionBox:box,keys:["a","b"],getRect})).toEqual(["a","b"]);
    expect(getIntersectingSelectionKeys({selectionBox:{...box,currentX:100},keys:["a","b"],getRect})).toEqual(["a"]);
  });

});
