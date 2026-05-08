import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n/I18nProvider";
import type { GalleryContext, GallerySource } from "../../types/universal-gallery";
import { buildFolderTree, WorkspaceSidebar } from "./WorkspaceSidebar";

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

  it("shows only the selected source folders and disables writes for read-only input", () => {
    const onSubfolderSelect = vi.fn();
    const context: GalleryContext = {
      base_dir: "D:/ComfyUI",
      output_dir_absolute: "D:/ComfyUI/output",
      output_dir_relative: "./output",
      import_image_subfolder: "universal_gallery_imports",
      import_image_target_relative: "./output/universal_gallery_imports",
      categories: [],
      subfolders: ["default_output::outputs", "default_input::clips"],
      move_targets: [],
      sources,
      active_source_count: 2,
      pinned_count: 0,
      boards: [],
    };

    render(
      <I18nProvider>
        <WorkspaceSidebar
          collapsed={false}
          onToggle={vi.fn()}
          activeTab="gallery"
          galleryContext={context}
          folderViewMode="tree"
          onFolderViewModeChange={vi.fn()}
          selectedCategory=""
          selectedSubfolder="default_input::"
          selectedBoardId=""
          pinnedOnly={false}
          onCategorySelect={vi.fn()}
          onSubfolderSelect={onSubfolderSelect}
          onBoardSelect={vi.fn()}
          onPinnedOnlySelect={vi.fn()}
          onCreateBoard={vi.fn()}
          onCreateFolder={vi.fn()}
          onDeleteFolder={vi.fn()}
          onMergeFolder={vi.fn()}
          onRenameFolder={vi.fn()}
          libraries={[]}
          activeLibraryName={null}
          onLibrarySelect={vi.fn()}
          onLibraryDelete={vi.fn()}
          draftName=""
          onDraftNameChange={vi.fn()}
          onCreateLibrary={vi.fn()}
        />
      </I18nProvider>,
    );

    expect(screen.getByText("输入目录")).toBeInTheDocument();
    expect(screen.getByText("clips")).toBeInTheDocument();
    expect(screen.queryByText("outputs")).not.toBeInTheDocument();
    expect(screen.getByTitle("输入图库为只读")).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "输出图库" }));
    expect(onSubfolderSelect).toHaveBeenCalledWith("default_output::");
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
});
