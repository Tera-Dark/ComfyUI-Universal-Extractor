import { createRef } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n/I18nProvider";
import type { TrashItem } from "../../types/universal-gallery";
import { TrashWorkspaceView } from "./TrashWorkspaceView";

const trashItems: TrashItem[] = [
  {
    id: "trash-1",
    kind: "image",
    name: "sample.png",
    original_path: "old/folder/sample.png",
    storage_path: "D:/trash/sample.png",
    deleted_at: 1_777_777_777,
    thumb_url: "/thumb.png",
    image_count: 0,
  },
];

const renderTrash = (overrides: Partial<Parameters<typeof TrashWorkspaceView>[0]> = {}) => {
  const props: Parameters<typeof TrashWorkspaceView>[0] = {
    trashItems,
    selectedCount: 0,
    selectedTrashCount: 0,
    hasSelection: false,
    pageSelectedPaths: [],
    galleryViewMode: "grid",
    selectionEnabled: true,
    selectionBox: null,
    isDraggingSelectionRef: { current: false },
    cardRefs: { current: {} },
    gridRef: createRef<HTMLDivElement>(),
    onSelectAllVisible: vi.fn(),
    onClearSelection: vi.fn(),
    onRestoreSelectedTrash: vi.fn(),
    onPurgeSelectedTrash: vi.fn(),
    onRestoreTrashItem: vi.fn(),
    onPurgeTrashItem: vi.fn(),
    onTrashContextMenu: vi.fn(),
    onImageSelectionClick: vi.fn(),
    onSelectionPointerDown: vi.fn(),
    onSelectionPointerMove: vi.fn(),
    onSelectionPointerEnd: vi.fn(),
    ...overrides,
  };

  return {
    props,
    ...render(
      <I18nProvider>
        <TrashWorkspaceView {...props} />
      </I18nProvider>,
    ),
  };
};

describe("TrashWorkspaceView", () => {
  it("renders empty trash state", () => {
    renderTrash({ trashItems: [] });
    expect(screen.getByText("垃圾箱为空")).toBeInTheDocument();
  });

  it("routes toolbar and item actions through callbacks", async () => {
    const user = userEvent.setup();
    const { props } = renderTrash({ selectedCount: 1, selectedTrashCount: 1, hasSelection: true, pageSelectedPaths: ["trash-1"] });

    await user.click(screen.getByRole("button", { name: "全选" }));
    expect(props.onSelectAllVisible).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "恢复所选" }));
    expect(props.onRestoreSelectedTrash).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "恢复" }));
    expect(props.onRestoreTrashItem).toHaveBeenCalledWith("trash-1");

    await user.click(screen.getByRole("button", { name: "彻底删除" }));
    expect(props.onPurgeTrashItem).toHaveBeenCalledWith("trash-1");
  });
});
