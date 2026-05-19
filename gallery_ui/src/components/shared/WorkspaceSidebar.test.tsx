import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n/I18nProvider";
import type { GalleryContext, GallerySource } from "../../types/universal-gallery";
import { buildFolderTree } from "./folderTree";
import { WorkspaceSidebar } from "./WorkspaceSidebar";

const sources: GallerySource[] = [
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
];

const baseContext = (subfolders: string[]): GalleryContext => ({
  base_dir: "D:/ComfyUI",
  output_dir_absolute: "D:/ComfyUI/output",
  output_dir_relative: "./output",
  import_image_subfolder: "universal_gallery_imports",
  import_image_target_relative: "./output/universal_gallery_imports",
  categories: [],
  subfolders,
  move_targets: [],
  sources,
  active_source_count: 2,
  pinned_count: 0,
  boards: [],
});

const renderSidebar = (overrides: Partial<Parameters<typeof WorkspaceSidebar>[0]> = {}) => {
  const props: Parameters<typeof WorkspaceSidebar>[0] = {
    collapsed: false,
    onToggle: vi.fn(),
    activeTab: "gallery",
    galleryContext: baseContext(["default_output::outputs", "default_input::clips"]),
    folderViewMode: "tree",
    onFolderViewModeChange: vi.fn(),
    selectedCategory: "",
    selectedSubfolder: "default_output::",
    selectedBoardId: "",
    pinnedOnly: false,
    onCategorySelect: vi.fn(),
    onSubfolderSelect: vi.fn(),
    onBoardSelect: vi.fn(),
    onPinnedOnlySelect: vi.fn(),
    onCreateBoard: vi.fn(),
    onCreateFolder: vi.fn(),
    onDeleteFolder: vi.fn(),
    onMergeFolder: vi.fn(),
    onRenameFolder: vi.fn(),
    onMoveFolder: vi.fn(),
    libraries: [],
    activeLibraryName: null,
    onLibrarySelect: vi.fn(),
    onLibraryDelete: vi.fn(),
    draftName: "",
    onDraftNameChange: vi.fn(),
    onCreateLibrary: vi.fn(),
    ...overrides,
  };

  return render(
    <I18nProvider>
      <WorkspaceSidebar {...props} />
    </I18nProvider>,
  );
};

describe("WorkspaceSidebar folder tree", () => {
  it("groups input source folders under a source root instead of rendering source refs as names", () => {
    const tree = buildFolderTree(
      ["default_input::clips", "default_input::clips/poses", "output-set"],
      new Set(),
      "name",
      sources,
      (source) => source?.kind === "input" ? "Input gallery" : "Output gallery",
    );

    const inputRoot = tree.find((node) => node.path === "default_input::");
    const outputFolder = tree.find((node) => node.path === "default_output::output-set");

    expect(inputRoot?.name).toBe("Input gallery");
    expect(inputRoot?.children[0]).toMatchObject({ path: "default_input::clips", name: "clips" });
    expect(inputRoot?.children[0]?.children[0]).toMatchObject({ path: "default_input::clips/poses", name: "poses" });
    expect(outputFolder?.name).toBe("output-set");
    expect(tree.some((node) => node.name.startsWith("default_input::"))).toBe(false);
  });

  it("scopes the tree to the active source without adding an extra source root", () => {
    const tree = buildFolderTree(
      ["default_output::outputs", "default_input::clips", "default_input::clips/poses"],
      new Set(),
      "name",
      sources,
      (source) => source?.name ?? "",
      "default_input",
    );

    expect(tree).toHaveLength(1);
    expect(tree[0]).toMatchObject({ path: "default_input::clips", name: "clips" });
    expect(tree[0].children[0]).toMatchObject({ path: "default_input::clips/poses", name: "poses" });
  });

  it("keeps nested output folders canonical while scoped to output", () => {
    const tree = buildFolderTree(
      ["default_output::Noob杂项合集（按月分）/2025.06"],
      new Set(),
      "name",
      sources,
      (source) => source?.name ?? "",
      "default_output",
    );

    expect(tree[0]).toMatchObject({ path: "default_output::Noob杂项合集（按月分）", name: "Noob杂项合集（按月分）" });
    expect(tree[0].children[0]).toMatchObject({ path: "default_output::Noob杂项合集（按月分）/2025.06", name: "2025.06" });
    expect(tree[0].children[0].path).not.toContain("default_output::default_output::");
  });

  it("shows only the selected source folders and disables writes for read-only input", () => {
    const onSubfolderSelect = vi.fn();
    renderSidebar({
      selectedSubfolder: "default_input::",
      onSubfolderSelect,
    });

    expect(screen.getByText("输入目录")).toBeInTheDocument();
    expect(screen.getByText("clips")).toBeInTheDocument();
    expect(screen.queryByText("outputs")).not.toBeInTheDocument();
    expect(screen.getByTitle("输入图库为只读")).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "输出图库" }));
    expect(onSubfolderSelect).toHaveBeenCalledWith("default_output::");
  });

  it("opens folder context menus at the pointer without changing the current folder", () => {
    const onRenameFolder = vi.fn();
    const onSubfolderSelect = vi.fn();
    const onMergeFolder = vi.fn();
    const { baseElement } = renderSidebar({
      galleryContext: baseContext(["default_output::current", "default_output::outputs"]),
      selectedSubfolder: "default_output::current",
      onSubfolderSelect,
      onMergeFolder,
      onRenameFolder,
    });

    fireEvent.contextMenu(screen.getByText("outputs"), { clientX: 72, clientY: 96 });

    const menu = baseElement.querySelector(".ue-sidebar-context-menu") as HTMLElement;
    expect(menu).toBeInTheDocument();
    expect(menu).toHaveStyle({ left: "72px", top: "96px" });
    expect(onSubfolderSelect).not.toHaveBeenCalled();

    const menuButtons = menu.querySelectorAll("button");
    fireEvent.click(menuButtons[2]);
    expect(onSubfolderSelect).not.toHaveBeenCalled();
    expect(onMergeFolder).toHaveBeenCalledWith("default_output::outputs");

    fireEvent.contextMenu(screen.getByText("outputs"), { clientX: 72, clientY: 96 });
    fireEvent.click(screen.getByText("重命名"));
    expect(onSubfolderSelect).not.toHaveBeenCalled();
    expect(onRenameFolder).toHaveBeenCalledWith("default_output::outputs");
  });

  it("sorts pinned folders first, then modified time by default", () => {
    const tree = buildFolderTree(
      ["default_output::older", "default_output::newer", "default_output::legacy-pin"],
      new Set(["legacy-pin"]),
      "modified",
      sources,
      (source) => source?.name ?? "",
      "default_output",
      new Map([
        ["default_output::older", 10],
        ["default_output::newer", 30],
        ["default_output::legacy-pin", 1],
      ]),
    );

    expect(tree.map((node) => node.path)).toEqual([
      "default_output::legacy-pin",
      "default_output::newer",
      "default_output::older",
    ]);
  });

  it("moves a writable folder under another folder with drag and drop", () => {
    const onMoveFolder = vi.fn();
    renderSidebar({
      galleryContext: baseContext(["default_output::source", "default_output::target"]),
      selectedSubfolder: "default_output::",
      onMoveFolder,
    });

    const source = screen.getByText("source").closest("button")!;
    const target = screen.getByText("target").closest("button")!;
    const data = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn((type: string, value: string) => data.set(type, value)),
      getData: vi.fn((type: string) => data.get(type) ?? ""),
    };

    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.dragOver(target, { dataTransfer });
    expect(target).toHaveClass("is-drop-target");
    fireEvent.drop(target, { dataTransfer });

    expect(onMoveFolder).toHaveBeenCalledWith("default_output::source", "default_output::target/source");
  });

  it("blocks folder drops into itself, descendants, existing targets, and read-only sources", () => {
    const onMoveFolder = vi.fn();
    renderSidebar({
      galleryContext: baseContext([
        "default_output::source",
        "default_output::source/child",
        "default_output::target",
        "default_output::target/source",
        "default_input::clips",
      ]),
      selectedSubfolder: "default_output::source/child",
      onMoveFolder,
    });

    const source = screen.getByText("source").closest("button")!;
    const child = screen.getByText("child").closest("button")!;
    const target = screen.getByText("target").closest("button")!;
    const data = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn((type: string, value: string) => data.set(type, value)),
      getData: vi.fn((type: string) => data.get(type) ?? ""),
    };

    fireEvent.dragStart(source, { dataTransfer });
    fireEvent.drop(source, { dataTransfer });
    fireEvent.drop(child, { dataTransfer });
    fireEvent.drop(target, { dataTransfer });

    expect(onMoveFolder).not.toHaveBeenCalled();
  });

  it("does not start folder drags from read-only sources", () => {
    const onMoveFolder = vi.fn();
    renderSidebar({
      galleryContext: baseContext(["default_output::target", "default_input::clips"]),
      selectedSubfolder: "default_input::",
      onMoveFolder,
    });

    const input = screen.getByText("clips").closest("button")!;
    const outputRoot = screen.getByTitle("D:/ComfyUI/output");
    const dataTransfer = {
      effectAllowed: "",
      dropEffect: "",
      setData: vi.fn(),
      getData: vi.fn(() => ""),
    };

    fireEvent.dragStart(input, { dataTransfer });
    fireEvent.drop(outputRoot, { dataTransfer });

    expect(input).toHaveAttribute("draggable", "false");
    expect(dataTransfer.setData).not.toHaveBeenCalled();
    expect(onMoveFolder).not.toHaveBeenCalled();
  });
});
