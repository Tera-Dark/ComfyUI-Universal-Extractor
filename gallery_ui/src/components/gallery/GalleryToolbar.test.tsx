import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n/I18nProvider";
import { GalleryToolbar } from "./GalleryToolbar";

const renderToolbar = (overrides: Partial<Parameters<typeof GalleryToolbar>[0]> = {}) => {
  const props: Parameters<typeof GalleryToolbar>[0] = {
    isTrashView: false,
    selectedBoard: null,
    selectedSubfolder: "default_output::",
    total: 12,
    trashCount: 0,
    favoritesOnly: false,
    isRefreshing: false,
    hasPendingLiveRefresh: false,
    activeFilterControlCount: 0,
    showFiltersMenu: false,
    showColumnsMenu: false,
    galleryViewMode: "grid",
    gridColumns: 4,
    dualFolderMode: false,
    selectionMode: false,
    writableSources: [{ id: "default_output", name: "Output", kind: "output", path: "D:/out", enabled: true, writable: true, recursive: true, import_target: true, exists: true }],
    activeImportSourceId: "default_output",
    categories: ["portrait", "landscape"],
    selectedCategory: "",
    dateFrom: "",
    dateTo: "",
    selectedColorFamily: "",
    colorIndexStatus: null,
    sortBy: "created_at",
    sortOrder: "desc",
    onApplyPendingLiveRefresh: vi.fn(),
    onToggleFiltersMenu: vi.fn(),
    onCloseFiltersMenu: vi.fn(),
    onToggleColumnsMenu: vi.fn(),
    onCloseColumnsMenu: vi.fn(),
    onOpenCategoryPicker: vi.fn(),
    onGalleryViewModeChange: vi.fn(),
    onGridColumnsChange: vi.fn(),
    onDualFolderModeChange: vi.fn(),
    onSelectionModeChange: vi.fn(),
    onImportTargetSourceIdChange: vi.fn(),
    onShareBoard: vi.fn(),
    onDeleteBoard: vi.fn(),
    onClearSelection: vi.fn(),
    onCategoryChange: vi.fn(),
    onDateFromChange: vi.fn(),
    onDateToChange: vi.fn(),
    onFavoritesOnlyChange: vi.fn(),
    onColorFamilyChange: vi.fn(),
    onSortByChange: vi.fn(),
    onSortOrderChange: vi.fn(),
    onPageChange: vi.fn(),
    ...overrides,
  };

  return {
    props,
    ...render(
      <I18nProvider>
        <GalleryToolbar {...props} />
      </I18nProvider>,
    ),
  };
};

describe("GalleryToolbar", () => {
  it("opens filters and changes view options through callbacks", async () => {
    const user = userEvent.setup();
    const { props } = renderToolbar({ activeFilterControlCount: 2, showColumnsMenu: true });

    await user.click(screen.getByRole("button", { name: "筛选" }));
    expect(props.onToggleFiltersMenu).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "列表" }));
    expect(props.onGalleryViewModeChange).toHaveBeenCalledWith("list");

    await user.click(screen.getByRole("button", { name: "6" }));
    expect(props.onGridColumnsChange).toHaveBeenCalledWith(6);
    expect(props.onCloseColumnsMenu).toHaveBeenCalled();
  });

  it("toggles organizer and selection modes while clearing selection", async () => {
    const user = userEvent.setup();
    const { props } = renderToolbar();

    await user.click(screen.getByRole("button", { name: "开启双栏目录整理" }));
    expect(props.onDualFolderModeChange).toHaveBeenCalledWith(true);
    expect(props.onClearSelection).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "选择模式" }));
    expect(props.onSelectionModeChange).toHaveBeenCalledWith(true);
    expect(props.onClearSelection).toHaveBeenCalledTimes(2);
  });
});
