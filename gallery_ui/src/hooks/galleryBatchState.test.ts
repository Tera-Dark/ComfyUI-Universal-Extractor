import { describe, expect, it } from "vitest";
import { applyBatchImageState } from "./galleryBatchState";
import type { ImageRecord, ImageState } from "../types/universal-gallery";

describe("batch updates", () => {
  it("retains unrelated per-image data with an older server", () => {
    const image = { relative_path: "a.png", title: "My title", notes: "My notes", boards: ["a"] } as ImageRecord;
    const last = { title: "Other title", notes: "Other notes", boards: ["b"], category: "new" } as ImageState;
    const result = applyBatchImageState(image, { ok: true, updated: ["a.png"], last_state: last, categories: [] }, { category: "new" });
    expect(result.title).toBe("My title");
    expect(result.notes).toBe("My notes");
    expect(result.boards).toEqual(["a"]);
    expect(result.category).toBe("new");
  });
});
