import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n/I18nProvider";
import type { GalleryContext, TrashItem } from "../../types/universal-gallery";
import { ConfirmProvider } from "../shared/ConfirmDialog";
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
      <ToastProvider>
        <ConfirmProvider>
          <GalleryWorkspace {...props} />
        </ConfirmProvider>
      </ToastProvider>
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
        <ToastProvider>
          <ConfirmProvider>
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
          </ConfirmProvider>
        </ToastProvider>
      </I18nProvider>,
    );

    fireEvent.keyDown(window, { key: "Enter" });

    expect(onOpenDetail).toHaveBeenCalledWith(expect.objectContaining({ filename: "sample.png" }));
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
