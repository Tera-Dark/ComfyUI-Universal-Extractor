import { describe, expect, it } from "vitest";
import type { DeleteImagesResult, MoveImagesResult } from "../types/universal-gallery";
import { describeFailedPaths, getDeleteOutcome, getMoveOutcome } from "./galleryOperationResults";

const moveResult = (updates: Partial<MoveImagesResult> = {}): MoveImagesResult => ({
  ok: true, moved: [], missing: [], blocked: [], unchanged: [], categories: [], subfolders: [], ...updates,
});
const deleteResult = (updates: Partial<DeleteImagesResult> = {}): DeleteImagesResult => ({
  ok: true, deleted: [], missing: [], categories: [], ...updates,
});

describe("gallery operation accounting", () => {
  it("retains missing, read-only, and already-in-destination images while clearing only moved sources", () => {
    const paths = ["a.png", "b.png", "c.png", "d.png"];
    const result = getMoveOutcome(paths, moveResult({
      moved: ["target/a.png"], moved_sources: ["a.png"], missing: ["b.png"],
      blocked: ["c.png"], unchanged: ["d.png"],
    }));
    expect([...result.movedSources]).toEqual(["a.png"]);
    expect(result.failedPaths).toEqual(["b.png", "c.png", "d.png"]);
    expect(result.complete).toBe(false);
    expect(result.unaccounted).toBe(0);
  });

  it("conservatively retains unknown outcomes from older servers", () => {
    const result = getMoveOutcome(["a.png", "b.png"], moveResult({ moved: ["target/a.png"] }));
    expect([...result.movedSources]).toEqual([]);
    expect(result.failedPaths).toEqual(["a.png", "b.png"]);
    expect(result.unaccounted).toBe(2);
  });

  it("infers only fully accounted-for source paths from an older server", () => {
    const result = getMoveOutcome(["a.png", "b.png"], moveResult({
      moved: ["target/a.png"], missing: ["b.png"],
    }));
    expect([...result.movedSources]).toEqual(["a.png"]);
    expect(result.failedPaths).toEqual(["b.png"]);
  });

  it("never clears selections outside the operation, even for inconsistent server responses", () => {
    const move = getMoveOutcome(["a.png", "b.png"], moveResult({
      moved: ["target/a.png", "target/b.png"], moved_sources: ["a.png", "unrelated.png"], blocked: ["b.png"],
    }));
    expect([...move.movedSources]).toEqual(["a.png"]);
    expect(move.failedPaths).toEqual(["b.png"]);
    expect([...getDeleteOutcome(["a.png"], deleteResult({ deleted: ["unrelated.png"] })).deletedPaths]).toEqual([]);
  });

  it("does not remove a selection merely because delete was requested", () => {
    const result = getDeleteOutcome(["a.png", "b.png"], deleteResult({ deleted: ["a.png"], missing: ["b.png"] }));
    expect([...result.deletedPaths]).toEqual(["a.png"]);
    expect(result.failedPaths).toEqual(["b.png"]);
    expect(result.complete).toBe(false);
    expect(describeFailedPaths(["a.png", "b.png", "c.png", "d.png"])).toBe("a.png; b.png; c.png; d.png");
  });
});
