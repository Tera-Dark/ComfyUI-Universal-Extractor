import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiRequestError, galleryApi } from "./galleryApi";

describe("galleryApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("surfaces backend JSON error messages with status details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "same-origin request required" }), { status: 403 })),
    );

    await expect(galleryApi.getContext()).rejects.toMatchObject({
      name: "ApiRequestError",
      message: "same-origin request required",
      status: 403,
    });
  });

  it("returns typed context JSON on success", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              base_dir: "D:/ComfyUI",
              output_dir_absolute: "D:/ComfyUI/output",
              output_dir_relative: "./output",
              import_image_subfolder: "universal_gallery_imports",
              import_image_target_relative: "./output/universal_gallery_imports",
              categories: [],
              subfolders: [],
              move_targets: [],
              sources: [],
              active_source_count: 0,
              pinned_count: 0,
              boards: [],
            }),
          ),
      ),
    );

    await expect(galleryApi.getContext()).resolves.toMatchObject({ base_dir: "D:/ComfyUI" });
  });

  it("requests image freshness with scoped subfolder and known fingerprint", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            fingerprint: "next",
            changed: true,
            image_count: 2,
            latest_created_at: 10,
            latest_relative_path: "current/new.png",
            checked_at: 12,
            subfolder: "current",
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(galleryApi.getImageFreshness("current", "known")).resolves.toMatchObject({
      fingerprint: "next",
      changed: true,
    });
    expect(fetchMock).toHaveBeenCalledWith("/universal_gallery/api/images/freshness?subfolder=current&known=known", undefined);
  });

  it("keeps ApiRequestError available for callers that need status checks", () => {
    const error = new ApiRequestError("failed", 500, { error: "failed" });
    expect(error.status).toBe(500);
    expect(error.details).toEqual({ error: "failed" });
  });
});
