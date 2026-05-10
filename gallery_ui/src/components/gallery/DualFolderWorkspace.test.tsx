import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n/I18nProvider";
import { galleryApi } from "../../services/galleryApi";
import type { GalleryContext, ImageListResponse } from "../../types/universal-gallery";
import { ConfirmProvider } from "../shared/ConfirmDialog";
import { ToastProvider } from "../shared/ToastViewport";
import { DualFolderWorkspace } from "./DualFolderWorkspace";

vi.mock("../../services/galleryApi", () => ({
  galleryApi: {
    listImages: vi.fn(),
  },
}));

const imagePage = (filename: string): ImageListResponse => ({
  images: [
    {
      filename,
      relative_path: filename,
      subfolder: "",
      url: `/view?filename=${filename}&type=output`,
      original_url: `/view?filename=${filename}&type=output`,
      thumb_url: `/thumb/${filename}`,
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
  total: 1,
  page: 1,
  limit: 80,
});

const imagePageMany = (filenames: string[]): ImageListResponse => ({
  images: filenames.map((filename, index) => ({
    filename,
    relative_path: filename,
    subfolder: "",
    url: `/view?filename=${filename}&type=output`,
    original_url: `/view?filename=${filename}&type=output`,
    thumb_url: `/thumb/${filename}`,
    size: 10 + index,
    created_at: 100 + index,
    favorite: false,
    pinned: false,
    boards: [],
    category: "",
    title: "",
    notes: "",
  })),
  total: filenames.length,
  page: 1,
  limit: 80,
});

const imagePageWithDimensions = (): ImageListResponse => ({
  images: [
    {
      filename: "wide-image-with-a-very-long-name-that-should-clip-inside-card.png",
      relative_path: "wide-image-with-a-very-long-name-that-should-clip-inside-card.png",
      subfolder: "",
      url: "/view?filename=wide.png&type=output",
      original_url: "/view?filename=wide.png&type=output",
      thumb_url: "/thumb/wide.png",
      size: 4_200_000,
      width: 1536,
      height: 1024,
      created_at: 100,
      favorite: false,
      pinned: false,
      boards: [],
      category: "",
      title: "A long descriptive title that should not spill out of the card",
      notes: "",
    },
    {
      filename: "unknown.png",
      relative_path: "unknown.png",
      subfolder: "",
      url: "/view?filename=unknown.png&type=output",
      original_url: "/view?filename=unknown.png&type=output",
      thumb_url: "/thumb/unknown.png",
      size: 10,
      width: 0,
      height: 0,
      created_at: 90,
      favorite: false,
      pinned: false,
      boards: [],
      category: "",
      title: "",
      notes: "",
    },
  ],
  total: 2,
  page: 1,
  limit: 80,
});

const context: GalleryContext = {
  base_dir: "D:/ComfyUI",
  output_dir_absolute: "D:/ComfyUI/output",
  output_dir_relative: "./output",
  import_image_subfolder: "universal_gallery_imports",
  import_image_target_relative: "./output/universal_gallery_imports",
  categories: [],
  subfolders: ["default_output::left", "default_output::right"],
  move_targets: [],
  sources: [
    {
      id: "default_output",
      name: "ComfyUI Output",
      kind: "output",
      path: "D:/ComfyUI/output",
      enabled: true,
      writable: true,
      recursive: true,
      import_target: true,
      exists: true,
    },
  ],
  active_source_count: 1,
  pinned_count: 0,
  boards: [],
};

const renderDual = (overrides: Partial<Parameters<typeof DualFolderWorkspace>[0]> = {}) => {
  const props: Parameters<typeof DualFolderWorkspace>[0] = {
    context,
    initialFolder: "default_output::left",
    sortBy: "created_at",
    sortOrder: "desc",
    boards: [],
    onOpenDetail: vi.fn(),
    onOpenWorkflow: vi.fn().mockResolvedValue(undefined),
    onMoveImages: vi.fn().mockResolvedValue({ ok: true, moved: [], missing: [], categories: [], subfolders: [] }),
    onDeleteImages: vi.fn().mockResolvedValue(undefined),
    onUpdateImageState: vi.fn().mockResolvedValue(undefined),
    onCreateBoard: vi.fn().mockResolvedValue({ ok: true, boards: [] }),
    onUpdateBoardPins: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };

  return render(
    <I18nProvider>
      <ToastProvider>
        <ConfirmProvider>
          <DualFolderWorkspace {...props} />
        </ConfirmProvider>
      </ToastProvider>
    </I18nProvider>,
  );
};

describe("DualFolderWorkspace", () => {
  it("searches and selects a nested folder with the custom combobox", async () => {
    vi.mocked(galleryApi.listImages).mockResolvedValue(imagePage("folder.png"));

    const { container } = renderDual();

    await screen.findAllByText("folder.png");
    const triggers = container.querySelectorAll(".ue-folder-combobox-trigger");
    fireEvent.click(triggers[1]);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "right" } });
    fireEvent.click(screen.getByRole("option", { name: /right/i }));

    await waitFor(() => {
      expect(triggers[1]).toHaveTextContent("right");
    });
  });

  it("shows an empty state for unmatched folder search without changing the selection", async () => {
    vi.mocked(galleryApi.listImages).mockResolvedValue(imagePage("folder.png"));

    const { container } = renderDual();

    await screen.findAllByText("folder.png");
    const trigger = container.querySelectorAll(".ue-folder-combobox-trigger")[1];
    fireEvent.click(trigger);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "missing-folder" } });

    expect(container.querySelector(".ue-folder-combobox-empty")).toBeInTheDocument();
    expect(trigger).not.toHaveTextContent("missing-folder");
  });

  it("moves a dragged image to the other folder scope through the internal drag MIME", async () => {
    const onMoveImages = vi.fn().mockResolvedValue({ ok: true, moved: ["left.png"], missing: [], categories: [], subfolders: [] });
    vi.mocked(galleryApi.listImages)
      .mockResolvedValueOnce(imagePage("left.png"))
      .mockResolvedValueOnce(imagePage("right.png"))
      .mockResolvedValue(imagePage("refreshed.png"));

    const { container } = renderDual({ onMoveImages });

    await screen.findAllByText("left.png");
    const triggers = container.querySelectorAll(".ue-folder-combobox-trigger");
    fireEvent.click(triggers[1]);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "right" } });
    fireEvent.click(screen.getByRole("option", { name: /right/i }));
    await waitFor(() => {
      expect(triggers[1]).toHaveTextContent("right");
    });

    const cards = container.querySelectorAll(".ue-dual-card");
    const panes = container.querySelectorAll(".ue-dual-pane");
    const dragStore = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: "",
      types: [] as string[],
      setData: vi.fn((type: string, value: string) => {
        dragStore.set(type, value);
        if (!dataTransfer.types.includes(type)) {
          dataTransfer.types.push(type);
        }
      }),
      getData: vi.fn((type: string) => dragStore.get(type) ?? ""),
    };
    fireEvent.dragStart(cards[0], { dataTransfer });
    fireEvent.drop(panes[1], { dataTransfer });

    await waitFor(() => {
      expect(onMoveImages).toHaveBeenCalledWith(["left.png"], "right", "default_output");
    });
  });

  it("supports click, ctrl, and shift range selection inside a pane", async () => {
    vi.mocked(galleryApi.listImages).mockResolvedValue(imagePageMany(["a.png", "b.png", "c.png"]));

    const { container } = renderDual();

    await screen.findAllByText("a.png");
    const leftCards = container.querySelectorAll(".ue-dual-pane")[0].querySelectorAll(".ue-dual-card");
    fireEvent.click(leftCards[0]);
    expect(container.querySelectorAll(".ue-dual-pane")[0]).toHaveTextContent("已选 1 张");

    fireEvent.click(leftCards[1], { ctrlKey: true });
    expect(container.querySelectorAll(".ue-dual-pane")[0]).toHaveTextContent("已选 2 张");

    fireEvent.click(leftCards[2], { shiftKey: true });
    expect(container.querySelectorAll(".ue-dual-pane")[0]).toHaveTextContent("已选 2 张");
    expect(leftCards[1]).toHaveClass("is-selected");
    expect(leftCards[2]).toHaveClass("is-selected");
  });

  it("shows real image dimensions without inventing fallback dimensions", async () => {
    vi.mocked(galleryApi.listImages).mockResolvedValue(imagePageWithDimensions());

    const { container } = renderDual();

    await waitFor(() => {
      expect(screen.getAllByText("1536 × 1024").length).toBeGreaterThanOrEqual(1);
    });
    expect(container.querySelector(".ue-dual-card-resolution")).toHaveTextContent("1536 × 1024");
    expect(screen.queryByText("--")).not.toBeInTheDocument();
    expect(screen.getAllByTitle("wide-image-with-a-very-long-name-that-should-clip-inside-card.png").length).toBeGreaterThanOrEqual(1);
  });

  it("moves the selected batch when dragging a selected image to the other pane", async () => {
    const onMoveImages = vi.fn().mockResolvedValue({ ok: true, moved: ["a.png", "b.png"], missing: [], categories: [], subfolders: [] });
    vi.mocked(galleryApi.listImages)
      .mockResolvedValueOnce(imagePageMany(["a.png", "b.png", "c.png"]))
      .mockResolvedValueOnce(imagePageMany(["right.png"]))
      .mockResolvedValue(imagePageMany(["refreshed.png"]));

    const { container } = renderDual({ onMoveImages });
    await screen.findByText("a.png");
    const triggers = container.querySelectorAll(".ue-folder-combobox-trigger");
    fireEvent.click(triggers[1]);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "right" } });
    fireEvent.click(screen.getByRole("option", { name: /right/i }));

    const leftCards = container.querySelectorAll(".ue-dual-pane")[0].querySelectorAll(".ue-dual-card");
    fireEvent.click(leftCards[0]);
    fireEvent.click(leftCards[1], { ctrlKey: true });

    const dragStore = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: "",
      types: [] as string[],
      setData: vi.fn((type: string, value: string) => {
        dragStore.set(type, value);
        if (!dataTransfer.types.includes(type)) {
          dataTransfer.types.push(type);
        }
      }),
      getData: vi.fn((type: string) => dragStore.get(type) ?? ""),
    };
    fireEvent.dragStart(leftCards[0], { dataTransfer });
    fireEvent.drop(container.querySelectorAll(".ue-dual-pane")[1], { dataTransfer });

    await waitFor(() => {
      expect(onMoveImages).toHaveBeenCalledWith(["a.png", "b.png"], "right", "default_output");
    });
  });

  it("opens the custom context menu and applies batch pin actions", async () => {
    const onUpdateImageState = vi.fn().mockResolvedValue(undefined);
    const onOpenDetail = vi.fn();
    vi.mocked(galleryApi.listImages).mockResolvedValue(imagePageMany(["a.png", "b.png"]));

    const { container } = renderDual({ onOpenDetail, onUpdateImageState });
    await screen.findAllByText("a.png");
    const leftCards = container.querySelectorAll(".ue-dual-pane")[0].querySelectorAll(".ue-dual-card");
    fireEvent.click(leftCards[0]);
    fireEvent.click(leftCards[1], { ctrlKey: true });
    fireEvent.contextMenu(leftCards[1]);

    fireEvent.click(screen.getByText("打开详情"));
    expect(onOpenDetail).toHaveBeenCalledWith(expect.objectContaining({ filename: "b.png" }));

    fireEvent.contextMenu(leftCards[1]);
    fireEvent.click(screen.getByText("置顶"));
    await waitFor(() => {
      expect(onUpdateImageState).toHaveBeenCalledWith("a.png", { pinned: true });
      expect(onUpdateImageState).toHaveBeenCalledWith("b.png", { pinned: true });
    });
  });

  it("lets the selected badge deselect one image without opening detail or collapsing the rest", async () => {
    const onOpenDetail = vi.fn();
    vi.mocked(galleryApi.listImages).mockResolvedValue(imagePageMany(["a.png", "b.png"]));

    const { container } = renderDual({ onOpenDetail });
    await screen.findAllByText("a.png");
    const leftCards = container.querySelectorAll(".ue-dual-pane")[0].querySelectorAll(".ue-dual-card");
    fireEvent.click(leftCards[0]);
    fireEvent.click(leftCards[1], { ctrlKey: true });

    const badgeButtons = container.querySelectorAll(".ue-dual-card-check");
    expect(badgeButtons).toHaveLength(2);
    fireEvent.click(badgeButtons[0]);

    expect(onOpenDetail).not.toHaveBeenCalled();
    expect(leftCards[0]).not.toHaveClass("is-selected");
    expect(leftCards[1]).toHaveClass("is-selected");
    expect(container.querySelectorAll(".ue-dual-card-check")).toHaveLength(1);
  });

  it("places the dual context menu near the right-click pointer", async () => {
    vi.mocked(galleryApi.listImages).mockResolvedValue(imagePageMany(["a.png"]));

    const { container, baseElement } = renderDual();
    await screen.findAllByText("a.png");
    const card = container.querySelector(".ue-dual-card") as HTMLElement;

    fireEvent.contextMenu(card, { clientX: 120, clientY: 140 });

    const menu = baseElement.querySelector(".ue-dual-context-menu") as HTMLElement;
    expect(menu).toHaveStyle({ left: "120px", top: "140px" });
  });

  it("flips the dual context menu away from viewport edges", async () => {
    vi.mocked(galleryApi.listImages).mockResolvedValue(imagePageMany(["a.png"]));
    const originalInnerWidth = window.innerWidth;
    const originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 500 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 400 });

    const { container, baseElement } = renderDual();
    await screen.findAllByText("a.png");
    const card = container.querySelector(".ue-dual-card") as HTMLElement;

    fireEvent.contextMenu(card, { clientX: 480, clientY: 390 });

    const menu = baseElement.querySelector(".ue-dual-context-menu") as HTMLElement;
    expect(menu).toHaveStyle({ left: "188px", top: "12px" });
    Object.defineProperty(window, "innerWidth", { configurable: true, value: originalInnerWidth });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: originalInnerHeight });
  });

  it("supports dual-pane keyboard shortcuts and ignores input focus", async () => {
    const onMoveImages = vi.fn().mockResolvedValue({ ok: true, moved: ["a.png", "b.png"], missing: [], categories: [], subfolders: [] });
    const onOpenDetail = vi.fn();
    vi.mocked(galleryApi.listImages)
      .mockResolvedValueOnce(imagePageMany(["a.png", "b.png"]))
      .mockResolvedValueOnce(imagePageMany(["right.png"]))
      .mockResolvedValue(imagePageMany(["refreshed.png"]));

    const { container } = renderDual({ onMoveImages, onOpenDetail });
    await screen.findByText("a.png");
    const triggers = container.querySelectorAll(".ue-folder-combobox-trigger");
    fireEvent.click(triggers[1]);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "right" } });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "a", ctrlKey: true });
    expect(container.querySelectorAll(".ue-dual-pane")[0]).not.toHaveTextContent("已选 2 张");
    fireEvent.click(screen.getByRole("option", { name: /right/i }));

    fireEvent.click(container.querySelectorAll(".ue-dual-card")[0]);
    fireEvent.keyDown(window, { key: "a", ctrlKey: true });
    expect(container.querySelectorAll(".ue-dual-pane")[0]).toHaveTextContent("已选 2 张");

    fireEvent.keyDown(window, { key: "Enter" });
    expect(onOpenDetail).toHaveBeenCalledWith(expect.objectContaining({ filename: "a.png" }));

    fireEvent.keyDown(window, { key: "m", ctrlKey: true });
    await waitFor(() => {
      expect(onMoveImages).toHaveBeenCalledWith(["a.png", "b.png"], "right", "default_output");
    });
  });

  it("deletes selected images through the Delete shortcut after confirmation", async () => {
    const onDeleteImages = vi.fn().mockResolvedValue(undefined);
    vi.mocked(galleryApi.listImages).mockResolvedValue(imagePageMany(["a.png", "b.png"]));

    const { container } = renderDual({ onDeleteImages });
    await screen.findAllByText("a.png");
    fireEvent.click(container.querySelectorAll(".ue-dual-card")[0]);
    fireEvent.keyDown(window, { key: "Delete" });

    await screen.findByText("删除所选图片");
    fireEvent.click(screen.getByText("删除"));

    await waitFor(() => {
      expect(onDeleteImages).toHaveBeenCalledWith(["a.png"]);
    });
  });

  it("does not move into a read-only target source", async () => {
    const readonlyContext: GalleryContext = {
      ...context,
      subfolders: ["default_output::left", "default_input::clips"],
      sources: [
        ...context.sources,
        {
          id: "default_input",
          name: "ComfyUI Input",
          kind: "input",
          path: "D:/ComfyUI/input",
          enabled: true,
          writable: false,
          recursive: true,
          import_target: false,
          exists: true,
        },
      ],
    };
    const onMoveImages = vi.fn().mockResolvedValue({ ok: true, moved: [], missing: [], categories: [], subfolders: [] });
    vi.mocked(galleryApi.listImages).mockResolvedValue(imagePage("left.png"));

    const { container } = renderDual({ context: readonlyContext, onMoveImages });

    await screen.findAllByText("left.png");
    const triggers = container.querySelectorAll(".ue-folder-combobox-trigger");
    fireEvent.click(triggers[1]);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "clips" } });
    fireEvent.click(screen.getByRole("option", { name: /clips/i }));

    const dragStore = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: "",
      types: [] as string[],
      setData: vi.fn((type: string, value: string) => {
        dragStore.set(type, value);
        if (!dataTransfer.types.includes(type)) {
          dataTransfer.types.push(type);
        }
      }),
      getData: vi.fn((type: string) => dragStore.get(type) ?? ""),
    };
    fireEvent.dragStart(container.querySelectorAll(".ue-dual-card")[0], { dataTransfer });
    fireEvent.drop(container.querySelectorAll(".ue-dual-pane")[1], { dataTransfer });

    await waitFor(() => {
      expect(onMoveImages).not.toHaveBeenCalled();
    });
  });
});
