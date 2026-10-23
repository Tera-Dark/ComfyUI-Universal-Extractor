import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { galleryApi } from "./galleryApi";
import { refreshGalleryJobs, subscribeGalleryJobs, waitForGalleryJob } from "./galleryJobMonitor";
import type { GalleryJob } from "../types/universal-gallery";

vi.mock("./galleryApi", async (original) => ({ ...await original<typeof import("./galleryApi")>(),
  galleryApi: { listJobs: vi.fn(), getJob: vi.fn() } }));
const job = { id: "shared", kind: "refresh_index", state: "running", payload: {}, created_at: 1, updated_at: 1 } as GalleryJob;
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible"); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("shared job monitor", () => {
  it("does not regress a completed job when its queued POST response arrives late", async () => {
    vi.mocked(galleryApi.listJobs).mockResolvedValue({ jobs: [{ ...job, state: "succeeded", updated_at: 2 }], total: 1, revision: 9 });
    const stop = subscribeGalleryJobs(vi.fn());
    await refreshGalleryJobs();
    await expect(waitForGalleryJob(job, new AbortController().signal)).resolves.toMatchObject({ state: "succeeded" });
    expect(galleryApi.listJobs).toHaveBeenCalledOnce();
    stop();
  });
  it("ten waiters and task feedback share one request and one terminal snapshot", async () => {
    let finish!: (value: { jobs: GalleryJob[]; total: number }) => void;
    vi.mocked(galleryApi.listJobs).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const feedback = vi.fn();
    const stop = subscribeGalleryJobs(feedback);
    const waiters = Array.from({ length: 10 }, () => waitForGalleryJob(job, new AbortController().signal));
    expect(galleryApi.listJobs).toHaveBeenCalledOnce();
    finish({ jobs: [{ ...job, state: "succeeded" }], total: 1 });
    const results = await Promise.all(waiters);
    expect(results.every((item) => item.state === "succeeded")).toBe(true);
    expect(feedback).toHaveBeenCalledOnce();
    expect(galleryApi.getJob).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10000);
    expect(galleryApi.listJobs).toHaveBeenCalledOnce();
    stop();
  });

  it("one cancelled waiter does not stop another or cancel the server task", async () => {
    let finish!: (value: { jobs: GalleryJob[]; total: number }) => void;
    vi.mocked(galleryApi.listJobs).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const first = new AbortController();
    const one = waitForGalleryJob(job, first.signal);
    const two = waitForGalleryJob(job, new AbortController().signal);
    const rejected = expect(one).rejects.toMatchObject({ name: "AbortError" });
    first.abort(); await rejected;
    expect(vi.mocked(galleryApi.listJobs).mock.calls[0][0]?.aborted).toBe(false);
    finish({ jobs: [{ ...job, state: "succeeded" }], total: 1 });
    await expect(two).resolves.toMatchObject({ state: "succeeded" });
  });
});
