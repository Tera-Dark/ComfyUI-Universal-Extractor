import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import contracts from "../../../tests/fixtures/gallery-contracts.json";
import { useGalleryJobs } from "./useGalleryJobs";
import type { GalleryJob } from "../types/universal-gallery";

const mocks = vi.hoisted(() => ({ listJobs: vi.fn(), getJob: vi.fn(), syncTask: vi.fn(), notify: vi.fn() }));
vi.mock("../services/galleryApi", () => ({ galleryApi: { listJobs: mocks.listJobs, getJob: mocks.getJob } }));
vi.mock("../components/shared/OperationStatusCenter", () => ({ useOperationStatus: () => ({ syncTask: mocks.syncTask, notify: mocks.notify }) }));
const translate = (key: string) => key;
vi.mock("../i18n/I18nProvider", () => ({ useI18n: () => ({ t: translate }) }));

const contract = contracts as { job: GalleryJob };

afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

describe("persistent tasks", () => {
  it("deduplicates progress, stops on completion, and aborts on unmount", async () => {
    vi.useFakeTimers();
    const job = contract.job;
    mocks.listJobs.mockResolvedValueOnce({ jobs: [job] }).mockResolvedValueOnce({ jobs: [{ ...job, state: "succeeded", completed: 1 }] });
    const { unmount } = renderHook(() => useGalleryJobs(true));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(mocks.syncTask).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(mocks.syncTask.mock.calls[1][0]).toBe(job.id);
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(mocks.listJobs).toHaveBeenCalledTimes(2);
    const signal = mocks.listJobs.mock.calls[1][0] as AbortSignal;
    unmount();
    expect(signal.aborted).toBe(true);
  });

  it("does not fetch tasks while the Gallery is inactive", async () => {
    vi.useFakeTimers();
    const { unmount } = renderHook(() => useGalleryJobs(false));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(mocks.listJobs).not.toHaveBeenCalled();
    unmount();
  });

  it("resolves displayed jobs that fall outside the first list page", async () => {
    vi.useFakeTimers();
    const job = contract.job;
    mocks.listJobs.mockResolvedValueOnce({ jobs: [job] }).mockResolvedValueOnce({ jobs: [] });
    mocks.getJob.mockResolvedValue({ job: { ...job, state: "succeeded", completed: 1 } });
    const { unmount } = renderHook(() => useGalleryJobs(true));
    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(mocks.getJob).toHaveBeenCalledWith(job.id, expect.any(AbortSignal));
    expect(mocks.syncTask.mock.calls[1][2]).toBe("success");
    await act(async () => { await vi.advanceTimersByTimeAsync(6000); });
    expect(mocks.listJobs).toHaveBeenCalledTimes(2);
    unmount();
  });
});
