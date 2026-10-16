import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, galleryApi } from "./galleryApi";
import { synchronizeGalleryIndex } from "./gallerySync";

vi.mock("./galleryApi", async (original) => {
  const real = await original<typeof import("./galleryApi")>();
  return { ...real, galleryApi: { createJob: vi.fn(), getJob: vi.fn() } };
});
const running = { job: { id: "scan", state: "running" } } as Awaited<ReturnType<typeof galleryApi.createJob>>;
beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks();
  vi.mocked(galleryApi.createJob).mockResolvedValue(running);
  vi.mocked(galleryApi.getJob).mockResolvedValue({ job: { ...running.job, state: "succeeded" } });
});
afterEach(() => { vi.useRealTimers(); });

describe("shared index refresh", () => {
  it("shares a whole-source scan and keeps it alive for remaining subscribers", async () => {
    const first = new AbortController(), second = new AbortController();
    const one = synchronizeGalleryIndex("", first.signal), two = synchronizeGalleryIndex("default_output::old", second.signal);
    const cancelled = expect(one).rejects.toMatchObject({ name: "AbortError" });
    first.abort(); await cancelled;
    await vi.advanceTimersByTimeAsync(250);
    await expect(two).resolves.toBe(false);
    expect(galleryApi.createJob).toHaveBeenCalledTimes(1);
    expect(galleryApi.createJob).toHaveBeenCalledWith("refresh_index", { force: true, subfolder: "" });
  });
  it("stops polling when the last subscriber leaves without cancelling the backend job", async () => {
    const controller = new AbortController();
    const result = synchronizeGalleryIndex("cancelled", controller.signal);
    const rejected = expect(result).rejects.toMatchObject({ name: "AbortError" });
    controller.abort(); await rejected; await vi.advanceTimersByTimeAsync(1000);
    expect(galleryApi.getJob).not.toHaveBeenCalled();
  });
  it("falls back only when task creation is unsupported, not when an existing task disappears", async () => {
    vi.mocked(galleryApi.createJob).mockRejectedValueOnce(new ApiRequestError("not supported", 404, null));
    await expect(synchronizeGalleryIndex("legacy", new AbortController().signal)).resolves.toBe(true);
    vi.mocked(galleryApi.getJob).mockRejectedValueOnce(new ApiRequestError("job missing", 404, { error: "job missing" }));
    const rejected = expect(synchronizeGalleryIndex("missing", new AbortController().signal)).rejects.toMatchObject({ status: 404 });
    await vi.advanceTimersByTimeAsync(250); await rejected;
  });
});
