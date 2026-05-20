import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n/I18nProvider";
import { galleryApi } from "../../services/galleryApi";
import type { GalleryContext, TrashItem } from "../../types/universal-gallery";
import { ConfirmProvider } from "../shared/ConfirmDialog";
import { OperationStatusProvider } from "../shared/OperationStatusCenter";
import { ToastProvider } from "../shared/ToastViewport";
import { GalleryWorkspace } from "./GalleryWorkspace";

const context: GalleryContext = {
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
};

const trashItems: TrashItem[] = [
  {
    id: "trash-1",
    kind: "image",
    name: "12-03-43-913598301474305_通用放大_00001_with_a_very_long_filename_that_must_not_escape_the_card.png",
    original_path: "Aaalice工作流存档/2026-02-07/12-03-43-913598301474305_通用放大_00001_with_a_very_long_filename_that_must_not_escape_the_card.png",
    storage_path: "D:/ComfyUI/data/trash/storage/trash-1.png",
    deleted_at: 1_777_777_777,
    thumb_url: "/thumb.png",
    image_count: 0,
  },
];

const galleryImage = {
  filename: "sample.png",
  relative_path: "default_output::sample.png",
  subfolder: "",
  url: "/view?filename=sample.png&type=output",
  original_url: "/view?filename=sample.png&type=output",
  thumb_url: "/thumb.png",
  size: 1234,
  created_at: 1,
  favorite: false,
  pinned: false,
  boards: [],
  category: "",
  title: "",
  notes: "",
};

const secondGalleryImage = {
  ...galleryImage,
  filename: "sample-2.png",
  relative_path: "default_output::sample-2.png",
  url: "/view?filename=sample-2.png&type=output",
  original_url: "/view?filename=sample-2.png&type=output",
  thumb_url: "/thumb-2.png",
};

const makeGalleryImage = (index: number) => ({
  ...galleryImage,
  filename: `sample-${index}.png`,
  relative_path: `default_output::sample-${index}.png`,
  url: `/view?filename=sample-${index}.png&type=output`,
  original_url: `/view?filename=sample-${index}.png&type=output`,
  thumb_url: `/thumb-${index}.png`,
  created_at: index,
});

const renderWorkspace = (overrides: Partial<Parameters<typeof GalleryWorkspace>[0]> = {}) => {
  const noop = vi.fn();
  const props: Parameters<typeof GalleryWorkspace>[0] = {
    images: [],
    context,
    total: 0,
    page: 1,
    totalPages: 1,
    selectedCategory: "",
    selectedSubfolder: "__trash__",
    selectedBoardId: "",
    dateFrom: "",
    dateTo: "",
    favoritesOnly: false,
    selectedColorFamily: "",
    colorIndexStatus: null,
    sortBy: "created_at",
    sortOrder: "desc",
    gridColumns: 4,
    selectedImagePaths: [],
    trashItems,
    isTrashView: true,
    importMessage: "",
    isLoading: false,
    isRefreshing: false,
    hasPendingLiveRefresh: false,
    error: null,
    boards: [],
    defaultSelectionMode: false,
    enableImagePrefetch: false,
    onOpenDetail: noop,
    onPageChange: noop,
    onCategoryChange: noop,
    onBoardChange: noop,
    onDateFromChange: noop,
    onDateToChange: noop,
    onFavoritesOnlyChange: noop,
    onColorFamilyChange: noop,
    onSortByChange: noop,
    onSortOrderChange: noop,
    onGridColumnsChange: noop,
    onOpenWorkflow: vi.fn().mockResolvedValue(undefined),
    onSelectionChange: noop,
    onUpdateImageState: vi.fn().mockResolvedValue(undefined),
    onCreateBoard: vi.fn().mockResolvedValue({ ok: true, boards: [] }),
    onUpdateBoardPins: vi.fn().mockResolvedValue(undefined),
    onDeleteBoard: vi.fn().mockResolvedValue(undefined),
    onDeleteImages: vi.fn().mockResolvedValue(undefined),
    onMoveImages: vi.fn().mockResolvedValue({ ok: true, moved: [], missing: [], categories: [], subfolders: [] }),
    onImportFiles: vi.fn().mockResolvedValue(undefined),
    onApplyPendingLiveRefresh: noop,
    onRestoreTrashItem: vi.fn().mockResolvedValue(undefined),
    onRestoreTrashItems: vi.fn().mockResolvedValue(undefined),
    onPurgeTrashItem: vi.fn().mockResolvedValue(undefined),
    onPurgeTrashItems: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };

  return render(
    <I18nProvider>
      <ConfirmProvider>
        <OperationStatusProvider>
          <ToastProvider>
            <main className="ue-main-shell">
              <GalleryWorkspace {...props} />
            </main>
          </ToastProvider>
        </OperationStatusProvider>
      </ConfirmProvider>
    </I18nProvider>,
  );
};

describe("GalleryWorkspace smoke", () => {
  it("renders trash grid cards with long names kept inside the card copy area", () => {
    const { container } = renderWorkspace();

    expect(container.querySelector(".ue-trash-list--grid")).toBeInTheDocument();
    expect(container.querySelector(".ue-trash-card-copy h4")).toHaveTextContent("very_long_filename");
    expect(screen.getByTitle(trashItems[0].original_path)).toBeInTheDocument();
  });

  it("renders a pending live refresh control in the gallery view", () => {
    const { container } = renderWorkspace({
      isTrashView: false,
      selectedSubfolder: "default_output::",
      total: 1,
      images: [galleryImage],
      hasPendingLiveRefresh: true,
    });

    expect(container.querySelector(".ue-live-refresh-pill")).toBeInTheDocument();
  });

  it("opens the image context menu without selecting the image outside selection mode", () => {
    const onSelectionChange = vi.fn();
    const onOpenDetail = vi.fn();
    window.localStorage.setItem("universal-extractor:gallery-view-mode", "list");
    const { container, baseElement } = renderWorkspace({
      isTrashView: false,
      selectedSubfolder: "default_output::",
      total: 1,
      images: [galleryImage],
      onOpenDetail,
      onSelectionChange,
    });

    const card = container.querySelector(".ue-gallery-list-row");
    expect(card).toBeInTheDocument();
    onSelectionChange.mockClear();

    fireEvent.contextMenu(card!, { clientX: 42, clientY: 64 });

    const menu = baseElement.querySelector(".ue-context-menu--gallery") as HTMLElement;
    expect(menu).toBeInTheDocument();
    expect(menu).toHaveStyle({ left: "42px", top: "64px" });
    fireEvent.click(screen.getByText("查看详情"));
    expect(onOpenDetail).toHaveBeenCalledWith(expect.objectContaining({ filename: "sample.png" }));
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("opens image detail on normal list row click without selecting it", () => {
    const onSelectionChange = vi.fn();
    const onOpenDetail = vi.fn();
    window.localStorage.setItem("universal-extractor:gallery-view-mode", "list");
    const { container } = renderWorkspace({
      isTrashView: false,
      selectedSubfolder: "default_output::",
      total: 1,
      images: [galleryImage],
      onOpenDetail,
      onSelectionChange,
    });

    const card = container.querySelector(".ue-gallery-list-row");
    expect(card).toBeInTheDocument();
    onSelectionChange.mockClear();

    fireEvent.click(card!);

    expect(onOpenDetail).toHaveBeenCalledWith(expect.objectContaining({ filename: "sample.png" }));
    expect(onSelectionChange).not.toHaveBeenCalled();
  });

  it("selects instead of opening detail in selection mode, then Enter opens the selected image", () => {
    const onSelectionChange = vi.fn();
    const onOpenDetail = vi.fn();
    window.localStorage.setItem("universal-extractor:gallery-view-mode", "list");
    const { container, rerender } = renderWorkspace({
      isTrashView: false,
      selectedSubfolder: "default_output::",
      total: 1,
      images: [galleryImage],
      defaultSelectionMode: true,
      onOpenDetail,
      onSelectionChange,
    });

    const card = container.querySelector(".ue-gallery-list-row");
    expect(card).toBeInTheDocument();
    onSelectionChange.mockClear();

    fireEvent.click(card!);

    expect(onOpenDetail).not.toHaveBeenCalled();
    expect(onSelectionChange).toHaveBeenCalledWith([galleryImage.relative_path]);

    rerender(
      <I18nProvider>
        <ConfirmProvider>
          <OperationStatusProvider>
            <ToastProvider>
            <GalleryWorkspace
              {...({
                images: [galleryImage],
                context,
                total: 1,
                page: 1,
                totalPages: 1,
                selectedCategory: "",
                selectedSubfolder: "default_output::",
                selectedBoardId: "",
                dateFrom: "",
                dateTo: "",
                favoritesOnly: false,
                selectedColorFamily: "",
                colorIndexStatus: null,
                sortBy: "created_at",
                sortOrder: "desc",
                gridColumns: 4,
                selectedImagePaths: [galleryImage.relative_path],
                trashItems,
                isTrashView: false,
                importMessage: "",
                isLoading: false,
                isRefreshing: false,
                hasPendingLiveRefresh: false,
                error: null,
                boards: [],
                defaultSelectionMode: true,
                enableImagePrefetch: false,
                onOpenDetail,
                onPageChange: vi.fn(),
                onCategoryChange: vi.fn(),
                onBoardChange: vi.fn(),
                onDateFromChange: vi.fn(),
                onDateToChange: vi.fn(),
                onFavoritesOnlyChange: vi.fn(),
                onColorFamilyChange: vi.fn(),
                onSortByChange: vi.fn(),
                onSortOrderChange: vi.fn(),
                onGridColumnsChange: vi.fn(),
                onOpenWorkflow: vi.fn().mockResolvedValue(undefined),
                onSelectionChange,
                onUpdateImageState: vi.fn().mockResolvedValue(undefined),
                onCreateBoard: vi.fn().mockResolvedValue({ ok: true, boards: [] }),
                onUpdateBoardPins: vi.fn().mockResolvedValue(undefined),
                onDeleteBoard: vi.fn().mockResolvedValue(undefined),
                onDeleteImages: vi.fn().mockResolvedValue(undefined),
                onMoveImages: vi.fn().mockResolvedValue({ ok: true, moved: [], missing: [], categories: [], subfolders: [] }),
                onImportFiles: vi.fn().mockResolvedValue(undefined),
                onApplyPendingLiveRefresh: vi.fn(),
                onRestoreTrashItem: vi.fn().mockResolvedValue(undefined),
                onRestoreTrashItems: vi.fn().mockResolvedValue(undefined),
                onPurgeTrashItem: vi.fn().mockResolvedValue(undefined),
                onPurgeTrashItems: vi.fn().mockResolvedValue(undefined),
              } satisfies Parameters<typeof GalleryWorkspace>[0])}
            />
            </ToastProvider>
          </OperationStatusProvider>
        </ConfirmProvider>
      </I18nProvider>,
    );

    fireEvent.keyDown(window, { key: "Enter" });

    expect(onOpenDetail).toHaveBeenCalledWith(expect.objectContaining({ filename: "sample.png" }));
  });

  it("starts box selection in the normal gallery while keeping normal click-to-open detail", async () => {
    const onSelectionChange = vi.fn();
    const onOpenDetail = vi.fn();
    const onSelectionModeActiveChange = vi.fn();
    window.localStorage.setItem("universal-extractor:gallery-view-mode", "list");
    const { container } = renderWorkspace({
      isTrashView: false,
      selectedSubfolder: "default_output::",
      total: 2,
      images: [galleryImage, secondGalleryImage],
      onOpenDetail,
      onSelectionChange,
      onSelectionModeActiveChange,
    });

    const list = container.querySelector(".ue-gallery-list") as HTMLElement;
    const rows = Array.from(container.querySelectorAll(".ue-gallery-list-row")) as HTMLElement[];
    expect(list).toBeInTheDocument();
    expect(rows).toHaveLength(2);

    rows[0].getBoundingClientRect = () =>
      ({ left: 20, right: 220, top: 20, bottom: 90, width: 200, height: 70, x: 20, y: 20, toJSON: () => ({}) }) as DOMRect;
    rows[1].getBoundingClientRect = () =>
      ({ left: 20, right: 220, top: 104, bottom: 174, width: 200, height: 70, x: 20, y: 104, toJSON: () => ({}) }) as DOMRect;
    onSelectionChange.mockClear();
    onSelectionModeActiveChange.mockClear();

    fireEvent.pointerDown(list, { button: 0, pointerId: 1, pointerType: "mouse", clientX: 10, clientY: 10 });
    fireEvent.pointerMove(list, { pointerId: 1, pointerType: "mouse", clientX: 240, clientY: 98 });
    fireEvent.pointerUp(list, { pointerId: 1, pointerType: "mouse", clientX: 240, clientY: 98 });

    expect(onOpenDetail).not.toHaveBeenCalled();
    expect(onSelectionChange).toHaveBeenLastCalledWith([galleryImage.relative_path]);
    expect(onSelectionModeActiveChange).not.toHaveBeenCalledWith(true);

    await new Promise((resolve) => window.setTimeout(resolve, 180));
    fireEvent.click(rows[1]);

    expect(onOpenDetail).toHaveBeenCalledWith(expect.objectContaining({ filename: "sample-2.png" }));
  });

  it("keeps earlier box-selected images when scrolling during a drag", async () => {
    const onSelectionChange = vi.fn();
    window.localStorage.setItem("universal-extractor:gallery-view-mode", "list");
    const { container } = renderWorkspace({
      isTrashView: false,
      selectedSubfolder: "default_output::",
      total: 2,
      images: [galleryImage, secondGalleryImage],
      onSelectionChange,
    });

    const mainShell = container.querySelector(".ue-main-shell") as HTMLElement;
    const list = container.querySelector(".ue-gallery-list") as HTMLElement;
    const rows = Array.from(container.querySelectorAll(".ue-gallery-list-row")) as HTMLElement[];
    expect(mainShell).toBeInTheDocument();
    expect(rows).toHaveLength(2);

    rows[0].getBoundingClientRect = () =>
      ({ left: 20, right: 220, top: 20, bottom: 90, width: 200, height: 70, x: 20, y: 20, toJSON: () => ({}) }) as DOMRect;
    rows[1].getBoundingClientRect = () =>
      ({ left: 20, right: 220, top: 220, bottom: 290, width: 200, height: 70, x: 20, y: 220, toJSON: () => ({}) }) as DOMRect;

    fireEvent.pointerDown(list, { button: 0, pointerId: 1, pointerType: "mouse", clientX: 10, clientY: 10 });
    fireEvent.pointerMove(list, { pointerId: 1, pointerType: "mouse", clientX: 240, clientY: 98 });
    expect(onSelectionChange).toHaveBeenLastCalledWith([galleryImage.relative_path]);

    rows[0].getBoundingClientRect = () =>
      ({ left: 20, right: 220, top: -180, bottom: -110, width: 200, height: 70, x: 20, y: -180, toJSON: () => ({}) }) as DOMRect;
    rows[1].getBoundingClientRect = () =>
      ({ left: 20, right: 220, top: 20, bottom: 90, width: 200, height: 70, x: 20, y: 20, toJSON: () => ({}) }) as DOMRect;
    Object.defineProperty(mainShell, "scrollTop", { configurable: true, value: 200 });
    fireEvent.scroll(mainShell);

    await waitFor(() => {
      expect(onSelectionChange).toHaveBeenLastCalledWith([galleryImage.relative_path, secondGalleryImage.relative_path]);
    });
    fireEvent.pointerUp(list, { pointerId: 1, pointerType: "mouse", clientX: 240, clientY: 98 });
  });

  it("uses the drag-start card rect snapshot when box selection opens the inspector", () => {
    const onSelectionChange = vi.fn();
    window.localStorage.setItem("universal-extractor:gallery-view-mode", "list");
    const { container } = renderWorkspace({
      isTrashView: false,
      selectedSubfolder: "default_output::",
      total: 2,
      images: [galleryImage, secondGalleryImage],
      onSelectionChange,
    });

    const list = container.querySelector(".ue-gallery-list") as HTMLElement;
    const rows = Array.from(container.querySelectorAll(".ue-gallery-list-row")) as HTMLElement[];
    rows[0].getBoundingClientRect = () =>
      ({ left: 20, right: 220, top: 20, bottom: 90, width: 200, height: 70, x: 20, y: 20, toJSON: () => ({}) }) as DOMRect;
    rows[1].getBoundingClientRect = () =>
      ({ left: 20, right: 220, top: 104, bottom: 174, width: 200, height: 70, x: 20, y: 104, toJSON: () => ({}) }) as DOMRect;

    fireEvent.pointerDown(list, { button: 0, pointerId: 1, pointerType: "mouse", clientX: 10, clientY: 10 });
    fireEvent.pointerMove(list, { pointerId: 1, pointerType: "mouse", clientX: 240, clientY: 98 });
    expect(onSelectionChange).toHaveBeenLastCalledWith([galleryImage.relative_path]);

    rows[0].getBoundingClientRect = () =>
      ({ left: 20, right: 220, top: 160, bottom: 230, width: 200, height: 70, x: 20, y: 160, toJSON: () => ({}) }) as DOMRect;
    rows[1].getBoundingClientRect = () =>
      ({ left: 20, right: 220, top: 20, bottom: 90, width: 200, height: 70, x: 20, y: 20, toJSON: () => ({}) }) as DOMRect;
    fireEvent.pointerMove(list, { pointerId: 1, pointerType: "mouse", clientX: 240, clientY: 98 });

    expect(onSelectionChange).toHaveBeenLastCalledWith([galleryImage.relative_path]);
  });

  it("box-selects virtual grid images that were not mounted before scrolling", async () => {
    const onSelectionChange = vi.fn();
    const images = Array.from({ length: 16 }, (_, index) => makeGalleryImage(index + 1));
    window.localStorage.setItem("universal-extractor:gallery-view-mode", "grid");
    const { container } = renderWorkspace({
      isTrashView: false,
      selectedSubfolder: "default_output::",
      total: images.length,
      images,
      gridColumns: 4,
      onSelectionChange,
    });

    const mainShell = container.querySelector(".ue-main-shell") as HTMLElement;
    const grid = container.querySelector(".ue-gallery-grid--virtual") as HTMLElement;
    expect(mainShell).toBeInTheDocument();
    expect(grid).toBeInTheDocument();
    grid.getBoundingClientRect = () =>
      ({ left: 20, right: 1020, top: 20, bottom: 2020, width: 1000, height: 2000, x: 20, y: 20, toJSON: () => ({}) }) as DOMRect;
    onSelectionChange.mockClear();

    fireEvent.pointerDown(grid, { button: 0, pointerId: 1, pointerType: "mouse", clientX: 10, clientY: 10 });
    fireEvent.pointerMove(grid, { pointerId: 1, pointerType: "mouse", clientX: 1000, clientY: 220 });

    Object.defineProperty(mainShell, "scrollTop", { configurable: true, value: 1100 });
    fireEvent.scroll(mainShell);

    await waitFor(() => {
      expect(onSelectionChange.mock.calls.at(-1)?.[0]).toContain(images[12].relative_path);
    });
    fireEvent.pointerUp(grid, { pointerId: 1, pointerType: "mouse", clientX: 1000, clientY: 220 });
  });

  it("reattaches grid measurement after opening and closing dual-folder mode", async () => {
    const observedElements: Element[] = [];
    const originalResizeObserver = window.ResizeObserver;
    class MockResizeObserver {
      callback: ResizeObserverCallback;

      constructor(callback: ResizeObserverCallback) {
        this.callback = callback;
      }

      observe(element: Element) {
        observedElements.push(element);
        this.callback([], this as unknown as ResizeObserver);
      }

      unobserve() {}

      disconnect() {}
    }
    vi.stubGlobal("ResizeObserver", MockResizeObserver);
    const listImagesSpy = vi.spyOn(galleryApi, "listImages").mockResolvedValue({
      images: [],
      total: 0,
      page: 1,
      limit: 80,
    });

    try {
      const { container } = renderWorkspace({
        isTrashView: false,
        selectedSubfolder: "default_output::",
        total: 2,
        images: [galleryImage, secondGalleryImage],
        gridColumns: 4,
      });

      await waitFor(() =>
        expect(observedElements.some((element) => element.classList.contains("ue-gallery-grid--virtual"))).toBe(true),
      );
      const firstGrid = container.querySelector(".ue-gallery-grid--virtual");
      expect(observedElements).toContain(firstGrid);
      const initialGridObserveCount = observedElements.filter((element) =>
        element.classList.contains("ue-gallery-grid--virtual"),
      ).length;

      fireEvent.click(screen.getByRole("button", { name: "开启双栏目录整理" }));
      expect(container.querySelector(".ue-dual-workspace")).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "关闭双栏目录整理" }));
      await waitFor(() => expect(container.querySelector(".ue-gallery-grid--virtual")).toBeInTheDocument());
      await waitFor(() =>
        expect(observedElements.filter((element) => element.classList.contains("ue-gallery-grid--virtual")).length).toBeGreaterThan(initialGridObserveCount),
      );

      const gridObservations = observedElements.filter((element) => element.classList.contains("ue-gallery-grid--virtual"));
      expect(gridObservations.at(-1)).toBe(container.querySelector(".ue-gallery-grid--virtual"));
      expect(gridObservations.at(-1)).not.toBe(firstGrid);
      expect(listImagesSpy).toHaveBeenCalled();
    } finally {
      listImagesSpy.mockRestore();
      if (originalResizeObserver) {
        vi.stubGlobal("ResizeObserver", originalResizeObserver);
      } else {
        vi.unstubAllGlobals();
      }
    }
  });

  it("only treats real external file drops as imports", async () => {
    const onImportFiles = vi.fn().mockResolvedValue(undefined);
    const { container } = renderWorkspace({
      isTrashView: false,
      selectedSubfolder: "default_output::",
      onImportFiles,
    });
    const shell = container.querySelector(".ue-drop-shell");
    expect(shell).toBeInTheDocument();

    fireEvent.drop(shell!, {
      dataTransfer: {
        types: ["application/x-universal-gallery-image"],
        files: [],
      },
    });
    expect(onImportFiles).not.toHaveBeenCalled();

    const file = new File(["raw-image-bytes"], "sample.webp", { type: "image/webp" });
    fireEvent.drop(shell!, {
      dataTransfer: {
        types: ["Files"],
        files: [file],
      },
    });

    await waitFor(() => {
      expect(onImportFiles).toHaveBeenCalledWith([file], expect.any(String));
    });
    expect(onImportFiles.mock.calls[0][0][0]).toBe(file);
  });
});
