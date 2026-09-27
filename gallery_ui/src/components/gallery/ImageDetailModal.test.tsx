import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n/I18nProvider";
import { galleryApi } from "../../services/galleryApi";
import type { ImageMetadata, ImageRecord } from "../../types/universal-gallery";
import { loadDecodedImage } from "../../utils/imageLoading";
import { ImageDetailModal } from "./ImageDetailModal";

const { confirm, choose } = vi.hoisted(() => ({
  confirm: vi.fn().mockResolvedValue(false),
  choose: vi.fn().mockResolvedValue("cancel"),
}));
vi.mock("../shared/ConfirmDialog", () => ({ useConfirm: () => ({ confirm, choose }) }));
vi.mock("../shared/ToastViewport", () => ({ useToast: () => ({ pushToast: vi.fn() }) }));
vi.mock("../../utils/imageLoading", () => ({ loadDecodedImage: vi.fn(), preferredScrollBehavior: () => "instant" }));
vi.mock("../../services/galleryApi", () => ({ galleryApi: {
  getImageMetadata: vi.fn(),
  listVariantGroups: vi.fn().mockResolvedValue({ groups: [] }),
  prewarmFingerprints: vi.fn().mockResolvedValue({}),
} }));

const metadata: ImageMetadata = {
  filename: "a.png", relative_path: "a.png", metadata: {}, workflow: null, artist_prompts: [],
  state: { favorite: false, pinned: false, boards: [], category: "", title: "", notes: "", updated_at: 0 },
  summary: { positive_prompt: "", negative_prompt: "", size: "", seed: null, steps: null, sampler: "", cfg: null, scheduler: "", denoise: null },
};
const image = (name: string): ImageRecord => ({
  filename: `${name}.png`, relative_path: `${name}.png`, subfolder: "", url: `/${name}.png`,
  original_url: `/${name}.png`, thumb_url: `/${name}-thumb.png`, size: 100, created_at: 1,
  favorite: false, pinned: false, boards: [], category: "", title: "", notes: "",
});
const propsFor = (photo = image("a")) => ({
  image: photo, navigation: null, onClose: vi.fn(), onSaveState: vi.fn().mockResolvedValue(undefined),
  onRenameFile: vi.fn().mockResolvedValue(undefined), onDeleteFile: vi.fn().mockResolvedValue(undefined),
  onOpenWorkflow: vi.fn().mockResolvedValue(undefined), onApplyLoraStack: vi.fn().mockResolvedValue(undefined), onNavigate: vi.fn(),
});
const view = (props: Parameters<typeof ImageDetailModal>[0] = propsFor()) =>
  render(<I18nProvider><ImageDetailModal {...props} /></I18nProvider>);
const openInspector = () => fireEvent.click(screen.getByRole("button", { name: "Toggle inspector" }));

beforeEach(() => {
  vi.mocked(loadDecodedImage).mockReset().mockResolvedValue(true);
  vi.mocked(galleryApi.getImageMetadata).mockReset().mockResolvedValue(metadata);
  confirm.mockReset().mockResolvedValue(false);
  choose.mockReset().mockResolvedValue("cancel");
  localStorage.setItem("universal-extractor-locale", "en");
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe("image detail", () => {
  it("traps focus in the portal, makes the app inert, and restores the opener", () => {
    const appRoot = document.createElement("div");
    appRoot.id = "root";
    const opener = document.createElement("button");
    opener.textContent = "Open detail";
    appRoot.appendChild(opener);
    const mount = document.createElement("div");
    appRoot.appendChild(mount);
    document.body.appendChild(appRoot);
    opener.focus();
    const { unmount } = render(<I18nProvider><ImageDetailModal {...propsFor()} /></I18nProvider>, { container: mount });
    const dialog = screen.getByRole("dialog", { name: "a.png" });
    expect(appRoot.inert).toBe(true);
    expect(appRoot).not.toContainElement(dialog);
    expect(screen.getByRole("button", { name: "Close detail" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(document, { key: "Tab" });
    expect(dialog.contains(document.activeElement)).toBe(true);
    unmount();
    expect(appRoot.inert).toBe(false);
    expect(opener).toHaveFocus();
    appRoot.remove();
  });

  it("keeps a preview until decoded and ignores a late response after navigation", async () => {
    const pending: Array<{ resolve: (ready: boolean) => void; signal: AbortSignal }> = [];
    vi.mocked(loadDecodedImage).mockImplementation((_url, signal) => new Promise((resolve) => pending.push({ resolve, signal })));
    const props = propsFor();
    const wrap = (photo: ImageRecord) => <I18nProvider><ImageDetailModal key={photo.relative_path} {...props} image={photo} /></I18nProvider>;
    const { rerender } = render(wrap(image("a")));
    expect(document.body.querySelector(".ue-lightbox-media img")).toHaveAttribute("src", "/a-thumb.png");
    rerender(wrap(image("b")));
    expect(pending[0].signal.aborted).toBe(true);
    await act(async () => pending[1].resolve(true));
    expect(document.body.querySelector(".ue-lightbox-media img")).toHaveAttribute("src", "/b.png");
    await act(async () => pending[0].resolve(true));
    expect(document.body.querySelector(".ue-lightbox-media img")).toHaveAttribute("src", "/b.png");
    expect(document.body.querySelector(".ue-lightbox-loading")).not.toBeInTheDocument();
  });

  it("shows a translated error and retries with a cache-busting URL", async () => {
    vi.mocked(loadDecodedImage).mockResolvedValueOnce(false).mockResolvedValue(true);
    view();
    fireEvent.click(await screen.findByRole("button", { name: "Retry image" }));
    await waitFor(() => expect(document.body.querySelector(".ue-lightbox-media img")).toHaveAttribute("src", "/a.png?_retry=1"));
  });

  it("does not overwrite a draft when metadata arrives after the user starts typing", async () => {
    let resolveMetadata!: (value: ImageMetadata) => void;
    vi.mocked(galleryApi.getImageMetadata).mockReturnValueOnce(new Promise((resolve) => { resolveMetadata = resolve; }));
    view();
    openInspector();
    const title = document.body.querySelector<HTMLInputElement>(".ue-lightbox-inspector.is-open input")!;
    fireEvent.change(title, { target: { value: "My title" } });
    await act(async () => resolveMetadata({ ...metadata, state: { ...metadata.state, title: "Server title" } }));
    expect(title.value).toBe("My title");
    expect(document.body.querySelector(".ue-lightbox-inspector.is-open .ue-detail-savecopy strong")).toHaveTextContent("Unsaved");
  });

  it("detects a filename-only edit and protects closing and keyboard navigation", async () => {
    const props = { ...propsFor(), navigation: { items: [image("a"), image("b")], currentIndex: 0 } };
    view(props);
    openInspector();
    await waitFor(() => expect(galleryApi.getImageMetadata).toHaveBeenCalled());
    const filename = document.body.querySelectorAll<HTMLInputElement>(".ue-lightbox-inspector.is-open input")[1];
    fireEvent.change(filename, { target: { value: "renamed.png" } });
    expect(document.body.querySelector(".ue-lightbox-inspector.is-open .ue-detail-savecopy strong")).toHaveTextContent("Unsaved");
    expect(document.body.querySelector(".ue-lightbox-inspector.is-open button[aria-label='Save image info']")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Close detail" }));
    await waitFor(() => expect(choose).toHaveBeenCalledTimes(1));
    expect(props.onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await waitFor(() => expect(choose).toHaveBeenCalledTimes(2));
    expect(props.onNavigate).not.toHaveBeenCalled();
    expect(filename.value).toBe("renamed.png");
  });

  it("guards the toolbar arrow and filmstrip; discarding proceeds only after confirmation", async () => {
    const props = { ...propsFor(), navigation: { items: [image("a"), image("b")], currentIndex: 0 } };
    view(props);
    openInspector();
    fireEvent.change(document.body.querySelector<HTMLInputElement>(".ue-lightbox-inspector.is-open input")!, { target: { value: "Draft" } });
    fireEvent.click(document.body.querySelector<HTMLButtonElement>(".ue-lightbox-toolbar button[aria-label='Next']")!);
    await waitFor(() => expect(choose).toHaveBeenCalledTimes(1));
    expect(props.onNavigate).not.toHaveBeenCalled();
    choose.mockResolvedValueOnce("alternative");
    fireEvent.click(document.body.querySelector<HTMLButtonElement>(".ue-lightbox-filmstrip button[aria-label='b.png']")!);
    await waitFor(() => expect(props.onNavigate).toHaveBeenCalledWith(1));
    expect(props.onSaveState).not.toHaveBeenCalled();
  });

  it("saves state and filename before navigating; a failed save retains the draft", async () => {
    const props = { ...propsFor(), navigation: { items: [image("a"), image("b")], currentIndex: 0 } };
    view(props);
    openInspector();
    await waitFor(() => expect(document.body.querySelector(".ue-detail-state .ue-loading-orb")).not.toBeInTheDocument());
    const inputs = document.body.querySelectorAll<HTMLInputElement>(".ue-lightbox-inspector.is-open input");
    fireEvent.change(inputs[0], { target: { value: "Ready to save" } });
    fireEvent.change(inputs[1], { target: { value: "renamed.png" } });
    choose.mockResolvedValueOnce("confirm");
    fireEvent.click(document.body.querySelector<HTMLButtonElement>(".ue-lightbox-toolbar button[aria-label='Next']")!);
    await waitFor(() => expect(props.onNavigate).toHaveBeenCalledWith(1));
    expect(props.onSaveState).toHaveBeenCalledWith("a.png", expect.objectContaining({ title: "Ready to save" }));
    expect(props.onRenameFile).toHaveBeenCalledWith("a.png", "renamed.png");
    expect(props.onSaveState.mock.invocationCallOrder[0]).toBeLessThan(props.onRenameFile.mock.invocationCallOrder[0]);
  });

  it("locks the editor while save-and-continue is pending, then unlocks after completion", async () => {
    let finishSave!: () => void;
    const props = { ...propsFor(), navigation: { items: [image("a"), image("b")], currentIndex: 0 } };
    props.onSaveState.mockImplementation(() => new Promise<void>((resolve) => { finishSave = resolve; }));
    choose.mockResolvedValue("confirm");
    view(props);
    openInspector();
    await waitFor(() => expect(document.body.querySelector(".ue-detail-state .ue-loading-orb")).not.toBeInTheDocument());
    const fields = document.body.querySelectorAll<HTMLInputElement>(".ue-lightbox-inspector.is-open input");
    fireEvent.change(fields[0], { target: { value: "Keep this title" } });
    fireEvent.click(document.body.querySelector<HTMLButtonElement>(".ue-lightbox-toolbar button[aria-label='Next']")!);
    await waitFor(() => expect(props.onSaveState).toHaveBeenCalledTimes(1));
    expect(fields[0]).toBeDisabled();
    expect(fields[1]).toBeDisabled();
    expect(screen.getByRole("button", { name: "Pin" })).toBeDisabled();
    expect(props.onNavigate).not.toHaveBeenCalled();
    await act(async () => finishSave());
    await waitFor(() => expect(props.onNavigate).toHaveBeenCalledWith(1));
    expect(fields[0]).not.toBeDisabled();
  });

  it("does not navigate when saving fails and permits retry without losing edits", async () => {
    const props = { ...propsFor(), navigation: { items: [image("a"), image("b")], currentIndex: 0 } };
    props.onSaveState.mockRejectedValueOnce(new Error("Disk full"));
    choose.mockResolvedValueOnce("confirm").mockResolvedValueOnce("confirm");
    view(props);
    openInspector();
    await waitFor(() => expect(document.body.querySelector(".ue-detail-state .ue-loading-orb")).not.toBeInTheDocument());
    const title = document.body.querySelector<HTMLInputElement>(".ue-lightbox-inspector.is-open input")!;
    fireEvent.change(title, { target: { value: "Keep me" } });
    const next = document.body.querySelector<HTMLButtonElement>(".ue-lightbox-toolbar button[aria-label='Next']")!;
    fireEvent.click(next);
    await waitFor(() => expect(document.body.querySelector(".ue-lightbox-inspector.is-open .ue-inline-error")).toHaveTextContent("Disk full"));
    expect(props.onNavigate).not.toHaveBeenCalled();
    expect(title.value).toBe("Keep me");
    fireEvent.click(next);
    await waitFor(() => expect(props.onNavigate).toHaveBeenCalledWith(1));
    expect(props.onSaveState).toHaveBeenCalledTimes(2);
  });

  it("uses the same guard for workspace switches and blocks them when the user cancels or saving fails", async () => {
    const props = { ...propsFor(), onRegisterLeave: vi.fn() };
    props.onSaveState.mockRejectedValueOnce(new Error("Cannot save"));
    view(props);
    openInspector();
    await waitFor(() => expect(document.body.querySelector(".ue-detail-state .ue-loading-orb")).not.toBeInTheDocument());
    fireEvent.change(document.body.querySelector<HTMLInputElement>(".ue-lightbox-inspector.is-open input")!, { target: { value: "Draft" } });
    const guard = props.onRegisterLeave.mock.calls.find(([value]) => typeof value === "function")![0]!;
    await act(async () => expect(await guard()).toBe(false));
    expect(props.onSaveState).not.toHaveBeenCalled();
    choose.mockResolvedValueOnce("confirm");
    await act(async () => expect(await guard()).toBe(false));
    expect(props.onSaveState).toHaveBeenCalledTimes(1);
    expect(props.onClose).not.toHaveBeenCalled();
    choose.mockResolvedValueOnce("confirm");
    await act(async () => expect(await guard()).toBe(true));
    expect(props.onSaveState).toHaveBeenCalledTimes(2);
  });

  it("keeps the detail open on a rejected delete and shows an inline error", async () => {
    const props = propsFor();
    props.onDeleteFile.mockRejectedValue(new Error("Delete failed"));
    confirm.mockResolvedValue(true);
    view(props);
    fireEvent.click(screen.getByRole("button", { name: "Delete file" }));
    await waitFor(() => expect(document.body.querySelector(".ue-lightbox-action-error")).toHaveTextContent("Delete failed"));
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("keeps a filename draft on a rejected rename", async () => {
    const props = propsFor();
    props.onRenameFile.mockRejectedValue(new Error("Rename failed"));
    confirm.mockResolvedValue(true);
    view(props);
    openInspector();
    const filename = document.body.querySelectorAll<HTMLInputElement>(".ue-lightbox-inspector.is-open input")[1];
    fireEvent.change(filename, { target: { value: "new.png" } });
    fireEvent.click(screen.getByRole("button", { name: "Rename file" }));
    await waitFor(() => expect(document.body.querySelector(".ue-lightbox-action-error")).toHaveTextContent("Rename failed"));
    expect(filename.value).toBe("new.png");
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it("does not close after cancelling unsaved changes, but discarding does", async () => {
    const props = propsFor();
    view(props);
    fireEvent.click(screen.getByRole("button", { name: "Pin" }));
    fireEvent.click(screen.getByRole("button", { name: "Close detail" }));
    await waitFor(() => expect(choose).toHaveBeenCalledTimes(1));
    expect(props.onClose).not.toHaveBeenCalled();
    choose.mockResolvedValueOnce("alternative");
    fireEvent.click(screen.getByRole("button", { name: "Close detail" }));
    await waitFor(() => expect(props.onClose).toHaveBeenCalledTimes(1));
  });
});
