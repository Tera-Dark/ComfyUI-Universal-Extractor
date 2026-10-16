import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { I18nProvider } from "../../i18n/I18nProvider";
import { OperationStatusProvider } from "../shared/OperationStatusCenter";
import { galleryApi } from "../../services/galleryApi";
import type { GalleryJob, ImageRecord, ImageSearchResponse } from "../../types/universal-gallery";
import { ImageSearchModal } from "./ImageSearchModal";

vi.mock("../../services/galleryApi", () => ({ galleryApi: { searchByImage: vi.fn(), getJob: vi.fn() } }));

const image = { filename: "old.png", relative_path: "2025/old.png", thumb_url: "/thumb", source_id: "default_output" } as ImageRecord;
const result: ImageSearchResponse = { matches: [{ image, score: 100, match_type: "exact", full_path: "C:\\output\\2025\\old.png" }], indexed: 1, total: 1, pending: 0, failed: 0 };
const reference = () => new File(["image"], "social.jpg", { type: "image/jpeg" });
const mount = (initialFile?: File) => {
  const props = { initialFile, onClose: vi.fn(), onLocate: vi.fn(), onOpenDetail: vi.fn() };
  return { ...render(<I18nProvider><OperationStatusProvider><ImageSearchModal {...props} /></OperationStatusProvider></I18nProvider>), props };
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn() }));
  vi.mocked(galleryApi.searchByImage).mockResolvedValue(result);
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("ImageSearchModal", () => {
  it("shows full paths and locates the matched image", async () => {
    const { props } = mount(reference());
    expect(await screen.findByText("文件完全相同")).toBeInTheDocument();
    expect(screen.getByText("C:\\output\\2025\\old.png")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "定位文件夹" }));
    expect(props.onClose).not.toHaveBeenCalled();
    expect(props.onLocate).toHaveBeenCalledWith(image);
  });

  it("accepts paste and drop without importing; keeps the dialog open on internal clicks", async () => {
    const { props } = mount();
    fireEvent.paste(window, { clipboardData: { files: [reference()] } });
    await screen.findByText("文件完全相同");
    fireEvent.click(screen.getByText("扩大匹配范围"));
    await waitFor(() => expect(galleryApi.searchByImage).toHaveBeenLastCalledWith(expect.any(File), 55, expect.any(AbortSignal)));
    fireEvent.drop(screen.getByRole("dialog"), { dataTransfer: { files: [reference()] } });
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent(window, new Event("resize"));
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("aborts replaced references and ignores late responses", async () => {
    let finish: (value: ImageSearchResponse) => void;
    vi.mocked(galleryApi.searchByImage).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const { unmount } = mount(reference());
    const firstSignal = vi.mocked(galleryApi.searchByImage).mock.calls[0][2]!;
    fireEvent.paste(window, { clipboardData: { files: [reference()] } });
    await screen.findByText("文件完全相同");
    expect(firstSignal.aborted).toBe(true);
    await act(async () => { finish({ ...result, matches: [] }); });
    expect(screen.getByText("文件完全相同")).toBeInTheDocument();
    const lastSignal = vi.mocked(galleryApi.searchByImage).mock.calls.at(-1)![2]!;
    unmount();
    expect(lastSignal.aborted).toBe(true);
  });

  it("waits for persistent indexing then searches again and stops polling", async () => {
    vi.useFakeTimers();
    const job = { id: "search-index", state: "running", completed: 0, total: 400 } as GalleryJob;
    vi.mocked(galleryApi.searchByImage).mockResolvedValueOnce({ ...result, matches: [], pending: 400, job });
    vi.mocked(galleryApi.getJob).mockResolvedValue({ job: { ...job, state: "succeeded" } });
    mount(reference());
    await act(async () => {});
    expect(screen.getByText("正在建立全库检索索引 · 0 / 400")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(screen.getByText("文件完全相同")).toBeInTheDocument();
    expect(galleryApi.searchByImage).toHaveBeenCalledTimes(2);
    await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
    expect(galleryApi.getJob).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized paste without sending a request and lets failures retry", async () => {
    mount();
    const huge = reference();
    Object.defineProperty(huge, "size", { value: 21 * 1024 * 1024 });
    fireEvent.paste(window, { clipboardData: { files: [huge] } });
    expect(screen.getByText("请选择不超过 20 MB 的图片文件。")).toBeInTheDocument();
    expect(galleryApi.searchByImage).not.toHaveBeenCalled();
    vi.mocked(galleryApi.searchByImage).mockRejectedValueOnce(new Error("temporary error"));
    fireEvent.paste(window, { clipboardData: { files: [reference()] } });
    await screen.findByText("temporary error");
    fireEvent.click(screen.getByRole("button", { name: "重新搜索" }));
    expect(await screen.findByText("文件完全相同")).toBeInTheDocument();
  });
});
