import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError, galleryApi } from "../services/galleryApi";
import { useGalleryAutoSync } from "./useGalleryAutoSync";

vi.mock("../services/galleryApi", async (original) => {
  const real = await original<typeof import("../services/galleryApi")>();
  return { ...real, galleryApi: { getImageFreshness: vi.fn(), createJob: vi.fn(), getJob: vi.fn(), getSyncStatus: vi.fn() } };
});
class Channel {
  static current: Channel;
  onmessage?: (event: { data: unknown }) => void;
  close = vi.fn();
  constructor() { Channel.current = this; }
  static complete(id: unknown) { Channel.current.onmessage?.({ data: { version: 1, type: "outputs-changed", prompt_id: id } }); }
}
const succeeded = { job: { id: "j", state: "succeeded", error: "" } } as Awaited<ReturnType<typeof galleryApi.createJob>>;
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const props = () => ({ enabled: true, active: true, loaded: true, scope: "default_output::", viewKey: "view", refresh: vi.fn().mockResolvedValue(undefined), onError: vi.fn() });

beforeEach(() => {
  vi.useFakeTimers(); vi.clearAllMocks(); vi.stubGlobal("BroadcastChannel", Channel);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  vi.mocked(galleryApi.getImageFreshness).mockResolvedValue({ fingerprint: "f", changed: false } as Awaited<ReturnType<typeof galleryApi.getImageFreshness>>);
  vi.mocked(galleryApi.createJob).mockResolvedValue(succeeded);
  vi.mocked(galleryApi.getJob).mockResolvedValue(succeeded);
  vi.mocked(galleryApi.getSyncStatus).mockResolvedValue({ instance: "server", sequence: 0, events: [] });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("automatic gallery synchronization", () => {
  it("uses the HTTP relay without a browser broadcast and skips freshness before completion scans", async () => {
    const options = props();
    renderHook(() => useGalleryAutoSync(options));
    await advance(1000);
    const before = vi.mocked(galleryApi.getImageFreshness).mock.calls.length;
    vi.mocked(galleryApi.getSyncStatus).mockResolvedValue({ instance: "server", sequence: 1,
      events: [{ version: 1, type: "outputs-changed", prompt_id: "desktop-round", scopes: ["default_output::new"] }] });
    await advance(2000);
    expect(galleryApi.createJob).toHaveBeenLastCalledWith("refresh_index", { subfolder: "default_output::new", force: true });
    expect(galleryApi.getImageFreshness).toHaveBeenCalledTimes(before);
    expect(options.refresh).toHaveBeenCalledTimes(2);
    act(() => Channel.complete("desktop-round"));
    await advance(4000);
    expect(options.refresh).toHaveBeenCalledTimes(2);
  });
  it("reconciles a missing baseline once, and leaves unchanged polling cheap", async () => {
    const options = props(); renderHook(() => useGalleryAutoSync(options));
    await advance(999); expect(galleryApi.createJob).not.toHaveBeenCalled();
    await advance(1); expect(options.refresh).toHaveBeenCalledWith(false, expect.any(AbortSignal));
    await advance(15000); expect(galleryApi.createJob).toHaveBeenCalledTimes(1);
    expect(galleryApi.getImageFreshness).toHaveBeenLastCalledWith(options.scope, "f", expect.any(AbortSignal));
  });
  it("repairs all sources once even when a saved old folder is initially open", async () => {
    const options = { ...props(), scope: "default_output::old-folder" };
    renderHook(() => useGalleryAutoSync(options));
    await advance(1000);
    expect(galleryApi.createJob).toHaveBeenLastCalledWith("refresh_index", { subfolder: "", force: true });
    act(() => Channel.current.onmessage?.({ data: { version: 1, type: "outputs-changed", prompt_id: "new-folder-output", scopes: ["default_output::new-folder"] } }));
    await advance(1000);
    expect(galleryApi.createJob).toHaveBeenLastCalledWith("refresh_index", { subfolder: "default_output::new-folder", force: true });
  });
  it("coalesces completions and rejects duplicate or malformed notifications", async () => {
    renderHook(() => useGalleryAutoSync(props())); await advance(1000);
    act(() => { Channel.complete("a"); Channel.complete("a"); Channel.complete("b"); Channel.complete("x".repeat(201)); Channel.complete(null); });
    await advance(1000);
    expect(galleryApi.createJob).toHaveBeenCalledTimes(2);
    expect(galleryApi.createJob).toHaveBeenLastCalledWith("refresh_index", { subfolder: "", force: true });
  });
  it("retains dirty completions outside Gallery without requesting image data", async () => {
    const options = props(); const { rerender } = renderHook(({ active }) => useGalleryAutoSync({ ...options, active }), { initialProps: { active: false } });
    act(() => Channel.complete("inactive")); await advance(30000);
    expect(galleryApi.getImageFreshness).not.toHaveBeenCalled();
    rerender({ active: true }); await advance(1000);
    expect(galleryApi.createJob).toHaveBeenCalledWith("refresh_index", { subfolder: "", force: true });
  });
  it("does not acknowledge a fingerprint after a failed scan and retries 503", async () => {
    vi.mocked(galleryApi.createJob).mockRejectedValueOnce(new ApiRequestError("busy", 503, null)).mockResolvedValue(succeeded);
    const options = props(); renderHook(() => useGalleryAutoSync(options));
    await advance(1000); expect(options.refresh).not.toHaveBeenCalled();
    await advance(2000); expect(galleryApi.getImageFreshness).toHaveBeenLastCalledWith(options.scope, "", expect.any(AbortSignal));
    expect(options.refresh).toHaveBeenCalledOnce();
  });
  it("retains failures and supports an explicit retry without losing dirty state", async () => {
    vi.mocked(galleryApi.createJob).mockRejectedValueOnce(new Error("denied"));
    const options = props(); renderHook(() => useGalleryAutoSync(options)); await advance(1000);
    expect(options.onError).toHaveBeenCalledOnce();
    await advance(300000);
    act(() => window.dispatchEvent(new Event("focus"))); await advance(0);
    expect(galleryApi.createJob).toHaveBeenCalledTimes(1);
    expect(options.onError).toHaveBeenCalledOnce();
    act(() => options.onError.mock.calls[0][1]()); await advance(1000);
    expect(options.refresh).toHaveBeenCalledOnce();
  });
  it("stops after two transient retries and permits one new attempt for a new workflow", async () => {
    vi.mocked(galleryApi.createJob).mockRejectedValue(new ApiRequestError("busy", 503, null));
    const options = props(); renderHook(() => useGalleryAutoSync(options));
    await advance(13000);
    expect(galleryApi.createJob).toHaveBeenCalledTimes(3);
    expect(options.onError).toHaveBeenCalledOnce();
    await advance(300000);
    expect(galleryApi.createJob).toHaveBeenCalledTimes(3);
    vi.mocked(galleryApi.createJob).mockResolvedValue(succeeded);
    act(() => Channel.complete("after-failure")); await advance(1000);
    expect(options.refresh).toHaveBeenCalledOnce();
    expect(galleryApi.createJob).toHaveBeenCalledTimes(4);
  });
  it("runs one follow-up when a completion arrives during a scan", async () => {
    let resolve!: (value: typeof succeeded) => void;
    vi.mocked(galleryApi.createJob).mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
    renderHook(() => useGalleryAutoSync(props())); await advance(1000);
    act(() => Channel.complete("during-scan"));
    await act(async () => { resolve(succeeded); }); await advance(1000);
    expect(galleryApi.createJob).toHaveBeenCalledTimes(2);
  });
  it("pauses in hidden tabs, reconciles on visibility, and aborts on unmount", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const { unmount } = renderHook(() => useGalleryAutoSync(props())); await advance(30000);
    expect(galleryApi.getImageFreshness).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible"); act(() => document.dispatchEvent(new Event("visibilitychange"))); await advance(0);
    const signal = vi.mocked(galleryApi.getImageFreshness).mock.calls[0][2]!;
    unmount(); expect(signal.aborted).toBe(true); expect(Channel.current.close).toHaveBeenCalled();
  });
});
