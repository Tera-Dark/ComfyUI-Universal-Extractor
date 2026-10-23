import { describe, expect, it } from "vitest";
import { reconcileGalleryContext, reconcileImageRecords, sameImageContent } from "./gallerySnapshot";
import type { GalleryContext, ImageRecord } from "../types/universal-gallery";

const image = { asset_id: "asset", relative_path: "old.png", content_revision: 1, boards: ["board"], width: 100 } as ImageRecord;
describe("committed gallery snapshots", () => {
  it("keeps card and page identity for an unchanged refresh", () => {
    const page = [image];
    expect(reconcileImageRecords(page, [{ ...image, boards: ["board"] }])).toBe(page);
  });
  it("reuses unchanged cards when another card was added or updated", () => {
    const next = reconcileImageRecords([image], [{ ...image }, { ...image, asset_id: "copy", relative_path: "copy.png" }]);
    expect(next[0]).toBe(image);
    expect(next).toHaveLength(2);
  });
  it("separates metadata backfill from actual page content changes", () => {
    expect(sameImageContent([image], [{ ...image, width: 200 }])).toBe(true);
    expect(sameImageContent([image], [{ ...image, content_revision: 2 }])).toBe(false);
    expect(sameImageContent([image], [])).toBe(false);
  });
  it("updates counts without invalidating unchanged navigation, and applies real folder changes", () => {
    const before = { sources: [{ id: "output", image_count: 10 }], subfolders: ["day"], subfolder_details: [{ path: "day", modified_at: 1 }],
      boards: [{ id: "board", cover_image: { relative_path: "old.png" } }] } as unknown as GalleryContext;
    const copied = JSON.parse(JSON.stringify(before)) as GalleryContext;
    expect(reconcileGalleryContext(before, copied)).toBe(before);
    const changed = reconcileGalleryContext(before, { ...copied, sources: [{ ...copied.sources[0], image_count: 11 }] });
    expect(changed.sources).not.toBe(before.sources);
    expect(changed.subfolders).toBe(before.subfolders);
    expect(changed.subfolder_details).toBe(before.subfolder_details);
    expect(changed.boards).toBe(before.boards);
    const moved = reconcileGalleryContext(changed, { ...changed, subfolders: ["new-day"], subfolder_details: [{ path: "day", modified_at: 2, source_id: "output", relative_path: "day" }] });
    expect(moved.subfolders).toEqual(["new-day"]);
    expect(moved.subfolder_details).not.toBe(before.subfolder_details);
  });
});
