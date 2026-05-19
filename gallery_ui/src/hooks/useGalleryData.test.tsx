import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { I18nProvider } from "../i18n/I18nProvider";
import type { GalleryContext, ImageListResponse } from "../types/universal-gallery";
import { galleryApi } from "../services/galleryApi";
import { useGalleryData } from "./useGalleryData";

vi.mock("../services/galleryApi", () => ({
  galleryApi: {
    getContext: vi.fn(),
    getImageFreshness: vi.fn(),
    listImages: vi.fn(),
    listTrash: vi.fn(),
    prewarmThumbnails: vi.fn(),
    getColorIndexStatus: vi.fn(),
    updateImageState: vi.fn(),
  },
}));

const contextResponse: GalleryContext = {
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
  color_index_status: {
    running: false,
    queued: 0,
    total: 1,
    indexed: 1,
    missing: 0,
    complete: true,
    version: "3",
    threshold: 0.25,
  },
};

const imagePage = (suffix: string, total: number): ImageListResponse => ({
  images: [
    {
      filename: `image-${suffix}.png`,
      relative_path: `image-${suffix}.png`,
      subfolder: "",
      url: `/view?filename=image-${suffix}.png&type=output`,
      original_url: `/view?filename=image-${suffix}.png&type=output`,
      thumb_url: `/universal_gallery/api/thumb?relative_path=image-${suffix}.png`,
      size: 10,
      created_at: 100,
      favorite: false,
      pinned: false,
      boards: [],
      category: "",
      title: "",
      notes: "",
    },
  ],
  total,
  page: 1,
  limit: 48,
  color_index_status: contextResponse.color_index_status,
});

const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider>{children}</I18nProvider>;

const flushAsyncEffects = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

const deferred = <T,>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
};

describe("useGalleryData live refresh", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(galleryApi.getContext).mockResolvedValue(contextResponse);
    vi.mocked(galleryApi.getImageFreshness).mockResolvedValue({
      fingerprint: "initial",
      changed: false,
      image_count: 1,
      latest_created_at: 100,
      latest_relative_path: "image-initial.png",
      checked_at: 1,
      subfolder: "",
    });
    vi.mocked(galleryApi.prewarmThumbnails).mockResolvedValue({
      ok: true,
      queued: [],
      skipped: [],
      status: {
        pending: 0,
        queued: 0,
        completed: 0,
        failed: 0,
        last_error: "",
        updated_at: 0,
      },
    });
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("quietly refreshes the first gallery page while visible", async () => {
    vi.mocked(galleryApi.listImages)
      .mockResolvedValueOnce(imagePage("initial", 1))
      .mockResolvedValue(imagePage("refresh", 2));
    vi.mocked(galleryApi.getImageFreshness).mockResolvedValue({
      fingerprint: "refresh",
      changed: true,
      image_count: 2,
      latest_created_at: 101,
      latest_relative_path: "image-refresh.png",
      checked_at: 2,
      subfolder: "",
    });

    const { result } = renderHook(() => useGalleryData({ isActive: true, liveRefreshEnabled: true }), { wrapper });

    await flushAsyncEffects();
    expect(galleryApi.listImages).toHaveBeenCalled();
    const callsBeforeInterval = vi.mocked(galleryApi.listImages).mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    await flushAsyncEffects();

    expect(galleryApi.getImageFreshness).toHaveBeenCalledWith("default_output::", "");
    expect(galleryApi.listImages).toHaveBeenCalledTimes(callsBeforeInterval + 1);
    expect(result.current.images[0]?.filename).toBe("image-refresh.png");
    expect(result.current.total).toBe(2);
    expect(vi.mocked(galleryApi.listImages).mock.calls.at(-1)?.at(-1)).toBe(true);
  });

  it("does not force a list refresh when freshness is unchanged", async () => {
    vi.mocked(galleryApi.listImages).mockResolvedValue(imagePage("initial", 1));

    renderHook(() => useGalleryData({ isActive: true, liveRefreshEnabled: true }), { wrapper });

    await flushAsyncEffects();
    const callsBeforeInterval = vi.mocked(galleryApi.listImages).mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    await flushAsyncEffects();

    expect(galleryApi.getImageFreshness).toHaveBeenCalled();
    expect(galleryApi.listImages).toHaveBeenCalledTimes(callsBeforeInterval);
  });

  it("keeps browsing position and marks pending refresh away from the newest first page", async () => {
    vi.mocked(galleryApi.listImages).mockResolvedValue(imagePage("initial", 2));
    vi.mocked(galleryApi.getImageFreshness).mockResolvedValue({
      fingerprint: "refresh",
      changed: true,
      image_count: 3,
      latest_created_at: 101,
      latest_relative_path: "image-refresh.png",
      checked_at: 2,
      subfolder: "",
    });

    const { result } = renderHook(() => useGalleryData({ isActive: true, liveRefreshEnabled: true }), { wrapper });
    await flushAsyncEffects();
    await act(async () => {
      result.current.setPage(2);
    });
    await flushAsyncEffects();
    const callsBeforeInterval = vi.mocked(galleryApi.listImages).mock.calls.length;

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    await flushAsyncEffects();

    expect(galleryApi.listImages).toHaveBeenCalledTimes(callsBeforeInterval);
    expect(result.current.hasPendingLiveRefresh).toBe(true);
    expect(result.current.images[0]?.filename).toBe("image-initial.png");
  });

  it("keeps separate freshness fingerprints for different view scopes", async () => {
    vi.mocked(galleryApi.listImages).mockResolvedValue(imagePage("initial", 2));
    vi.mocked(galleryApi.getImageFreshness)
      .mockResolvedValueOnce({
        fingerprint: "page-1",
        changed: false,
        image_count: 1,
        latest_created_at: 100,
        latest_relative_path: "image-initial.png",
        checked_at: 1,
        subfolder: "",
      })
      .mockResolvedValueOnce({
        fingerprint: "page-2",
        changed: false,
        image_count: 1,
        latest_created_at: 100,
        latest_relative_path: "image-initial.png",
        checked_at: 2,
        subfolder: "",
      })
      .mockResolvedValueOnce({
        fingerprint: "page-1-refresh",
        changed: true,
        image_count: 2,
        latest_created_at: 101,
        latest_relative_path: "image-refresh.png",
        checked_at: 3,
        subfolder: "",
      });

    const { result } = renderHook(() => useGalleryData({ isActive: true, liveRefreshEnabled: true }), { wrapper });
    await flushAsyncEffects();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    await flushAsyncEffects();
    expect(galleryApi.getImageFreshness).toHaveBeenLastCalledWith("default_output::", "");

    await act(async () => {
      result.current.setPage(2);
    });
    await flushAsyncEffects();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    await flushAsyncEffects();
    expect(galleryApi.getImageFreshness).toHaveBeenLastCalledWith("default_output::", "");

    await act(async () => {
      result.current.setPage(1);
    });
    await flushAsyncEffects();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    await flushAsyncEffects();
    expect(galleryApi.getImageFreshness).toHaveBeenLastCalledWith("default_output::", "page-1");
  });

  it("does not schedule live refresh when the preference is disabled", async () => {
    vi.mocked(galleryApi.listImages).mockResolvedValue(imagePage("initial", 1));

    renderHook(() => useGalleryData({ isActive: true, liveRefreshEnabled: false }), { wrapper });

    await flushAsyncEffects();
    expect(galleryApi.listImages).toHaveBeenCalled();
    const callsBeforeInterval = vi.mocked(galleryApi.listImages).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(24_000);
    });
    await flushAsyncEffects();

    expect(galleryApi.listImages).toHaveBeenCalledTimes(callsBeforeInterval);
    expect(galleryApi.getImageFreshness).not.toHaveBeenCalled();
  });

  it("does not poll freshness while the page is hidden", async () => {
    vi.mocked(galleryApi.listImages).mockResolvedValue(imagePage("initial", 1));
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");

    renderHook(() => useGalleryData({ isActive: true, liveRefreshEnabled: true }), { wrapper });

    await flushAsyncEffects();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });
    await flushAsyncEffects();

    expect(galleryApi.getImageFreshness).not.toHaveBeenCalled();
  });

  it("applies pin changes immediately without forcing a list reload", async () => {
    vi.mocked(galleryApi.listImages).mockResolvedValue(imagePage("initial", 1));
    const update = deferred<Awaited<ReturnType<typeof galleryApi.updateImageState>>>();
    vi.mocked(galleryApi.updateImageState).mockReturnValue(update.promise);

    const { result } = renderHook(() => useGalleryData({ isActive: true, liveRefreshEnabled: false }), { wrapper });
    await flushAsyncEffects();
    const callsBeforePin = vi.mocked(galleryApi.listImages).mock.calls.length;

    let updatePromise: Promise<void>;
    await act(async () => {
      updatePromise = result.current.updateImageState("image-initial.png", { pinned: true });
      await Promise.resolve();
    });

    expect(result.current.images[0]?.pinned).toBe(true);

    update.resolve({
      ok: true,
      state: {
        favorite: true,
        pinned: true,
        boards: [],
        category: "",
        title: "",
        notes: "",
        updated_at: 2,
      },
      categories: [],
    });
    await act(async () => {
      await updatePromise;
    });

    expect(result.current.images[0]?.pinned).toBe(true);
    expect(galleryApi.listImages).toHaveBeenCalledTimes(callsBeforePin);
  });
});
