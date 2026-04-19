import { useEffect, useMemo, useState } from "react";
import {
  ArrowRightLeft,
  BookOpen,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderTree,
  HardDrive,
  ListTree,
  Minimize2,
  Tag,
  Trash,
  Trash2,
} from "lucide-react";

import { useI18n } from "../../i18n/I18nProvider";
import type { GalleryContext, LibraryInfo, WorkspaceTab } from "../../types/universal-gallery";

interface TreeNode {
  path: string;
  name: string;
  children: TreeNode[];
}

interface WorkspaceSidebarProps {
  collapsed: boolean;
  activeTab: WorkspaceTab;
  galleryContext: GalleryContext | null;
  folderViewMode: "tree" | "list";
  onFolderViewModeChange: (mode: "tree" | "list") => void;
  selectedCategory: string;
  selectedSubfolder: string;
  onCategorySelect: (value: string) => void;
  onSubfolderSelect: (value: string) => void;
  onCreateFolder: () => void;
  onDeleteFolder: () => void;
  onMergeFolder: () => void;
  libraries: LibraryInfo[];
  activeLibraryName: string | null;
  onLibrarySelect: (name: string) => void;
  onLibraryDelete: (name: string) => void;
  draftName: string;
  onDraftNameChange: (value: string) => void;
  onCreateLibrary: () => void;
}

const splitFolderPath = (subfolder: string) => subfolder.split(/[\\/]+/).filter(Boolean);

const sortTreeNodes = (nodes: TreeNode[]): TreeNode[] =>
  [...nodes]
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" }))
    .map((node) => ({ ...node, children: sortTreeNodes(node.children) }));

const buildFolderTree = (subfolders: string[]) => {
  const root: TreeNode[] = [];
  const nodeMap = new Map<string, TreeNode>();

  subfolders.forEach((subfolder) => {
    const segments = splitFolderPath(subfolder);
    let currentPath = "";
    let currentLevel = root;

    segments.forEach((segment) => {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      let node = nodeMap.get(currentPath);

      if (!node) {
        node = { path: currentPath, name: segment, children: [] };
        nodeMap.set(currentPath, node);
        currentLevel.push(node);
      }

      currentLevel = node.children;
    });
  });

  return sortTreeNodes(root);
};

const getAncestorPaths = (path: string) => {
  const segments = splitFolderPath(path);
  return segments
    .slice(0, -1)
    .map((_, index) => segments.slice(0, index + 1).join("/"));
};

const TreeBranch = ({
  node,
  depth,
  expandedPaths,
  selectedSubfolder,
  onToggle,
  onSelect,
}: {
  node: TreeNode;
  depth: number;
  expandedPaths: Set<string>;
  selectedSubfolder: string;
  onToggle: (path: string) => void;
  onSelect: (value: string) => void;
}) => {
  const hasChildren = node.children.length > 0;
  const expanded = expandedPaths.has(node.path);

  return (
    <div className="ue-tree-branch">
      <div
        className={`ue-tree-row ${selectedSubfolder === node.path ? "active" : ""}`}
        style={{ paddingLeft: `${depth * 16}px` }}
      >
        {hasChildren ? (
          <button
            className={`ue-tree-toggle ${expanded ? "is-expanded" : ""}`}
            onClick={() => onToggle(node.path)}
            aria-label={expanded ? "Collapse folder" : "Expand folder"}
          >
            <ChevronRight size={12} />
          </button>
        ) : (
          <span className="ue-tree-spacer" aria-hidden="true" />
        )}

        <button className="ue-tree-label" onClick={() => onSelect(node.path)} title={node.path}>
          <Folder size={14} />
          <span>{node.name}</span>
        </button>
      </div>

      {hasChildren && expanded ? (
        <div className="ue-tree-children">
          {node.children.map((child) => (
            <TreeBranch
              key={child.path}
              node={child}
              depth={depth + 1}
              expandedPaths={expandedPaths}
              selectedSubfolder={selectedSubfolder}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
};

export const WorkspaceSidebar = ({
  collapsed,
  activeTab,
  galleryContext,
  folderViewMode,
  onFolderViewModeChange,
  selectedCategory,
  selectedSubfolder,
  onCategorySelect,
  onSubfolderSelect,
  onCreateFolder,
  onDeleteFolder,
  onMergeFolder,
  libraries,
  activeLibraryName,
  onLibrarySelect,
  onLibraryDelete,
  draftName,
  onDraftNameChange,
  onCreateLibrary,
}: WorkspaceSidebarProps) => {
  const { locale, t } = useI18n();
  const folderTree = useMemo(
    () => buildFolderTree(galleryContext?.subfolders ?? []),
    [galleryContext?.subfolders],
  );
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  useEffect(() => {
    setExpandedPaths(new Set());
  }, [galleryContext?.output_dir_absolute]);

  useEffect(() => {
    if (!selectedSubfolder) {
      return;
    }

    setExpandedPaths((current) => {
      const next = new Set(current);
      getAncestorPaths(selectedSubfolder).forEach((path) => next.add(path));
      return next;
    });
  }, [selectedSubfolder]);

  const toggleExpanded = (path: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const collapseAllFolders = () => {
    setExpandedPaths(new Set());
  };

  const collapseAllLabel = locale === "zh-CN" ? "全部收起" : "Collapse all";

  return (
    <aside className={`ue-sidebar ${collapsed ? "is-collapsed" : ""}`}>
      {activeTab === "gallery" ? (
        <div className="ue-sidebar-section ue-sidebar-section--grow">
          <div className="ue-sidebar-heading">
            <span>{t("sidebarResources")}</span>
            <div className="ue-sidebar-viewmodes">
              <button
                className={folderViewMode === "list" ? "active" : ""}
                onClick={() => onFolderViewModeChange("list")}
                title="List"
              >
                <ListTree size={14} />
              </button>
              <button
                className={folderViewMode === "tree" ? "active" : ""}
                onClick={() => onFolderViewModeChange("tree")}
                title="Tree"
              >
                <FolderTree size={14} />
              </button>
            </div>
          </div>

          <button
            className={`ue-tree-item ue-tree-item--root ${selectedSubfolder === "" ? "active" : ""}`}
            onClick={() => onSubfolderSelect("")}
          >
            <HardDrive size={14} />
            <span>{galleryContext?.output_dir_relative || "./output"}</span>
          </button>
          <button
            className={`ue-tree-item ue-tree-item--root ${selectedSubfolder === "__trash__" ? "active" : ""}`}
            onClick={() => onSubfolderSelect("__trash__")}
          >
            <Trash size={14} />
            <span>{locale === "zh-CN" ? "垃圾箱" : "Trash"}</span>
          </button>

          <div className="ue-sidebar-subsection">
            <div className="ue-sidebar-subheading">
              <div className="ue-sidebar-subheading-main">
                <FolderOpen size={14} />
                <span>{t("galleryOutputFolder")}</span>
              </div>
              {folderViewMode === "tree" ? (
                <div className="ue-sidebar-subactions">
                  <button
                    className="ue-sidebar-subaction"
                    onClick={onCreateFolder}
                    title={locale === "zh-CN" ? "新建目录" : "Create folder"}
                    aria-label={locale === "zh-CN" ? "新建目录" : "Create folder"}
                  >
                    <FolderPlus size={12} />
                  </button>
                  <button
                    className="ue-sidebar-subaction"
                    onClick={onMergeFolder}
                    disabled={!selectedSubfolder}
                    title={locale === "zh-CN" ? "合并目录" : "Merge folder"}
                    aria-label={locale === "zh-CN" ? "合并目录" : "Merge folder"}
                  >
                    <ArrowRightLeft size={12} />
                  </button>
                  <button
                    className="ue-sidebar-subaction"
                    onClick={onDeleteFolder}
                    disabled={!selectedSubfolder}
                    title={locale === "zh-CN" ? "删除目录" : "Delete folder"}
                    aria-label={locale === "zh-CN" ? "删除目录" : "Delete folder"}
                  >
                    <Trash2 size={12} />
                  </button>
                  <button
                    className="ue-sidebar-subaction"
                    onClick={collapseAllFolders}
                    title={collapseAllLabel}
                    aria-label={collapseAllLabel}
                  >
                    <Minimize2 size={12} />
                  </button>
                </div>
              ) : null}
            </div>

            {folderViewMode === "tree" ? (
              <div className="ue-tree-panel">
                {folderTree.map((node) => (
                  <TreeBranch
                    key={node.path}
                    node={node}
                    depth={0}
                    expandedPaths={expandedPaths}
                    selectedSubfolder={selectedSubfolder}
                    onToggle={toggleExpanded}
                    onSelect={onSubfolderSelect}
                  />
                ))}
              </div>
            ) : (
              <div className="ue-tree-list ue-tree-list--flat">
                <button
                  className={`ue-tree-item ue-tree-item--compact ${selectedSubfolder === "" ? "active" : ""}`}
                  onClick={() => onSubfolderSelect("")}
                >
                  <Folder size={14} />
                  <span>./</span>
                </button>
                {(galleryContext?.subfolders ?? []).map((subfolder) => (
                  <button
                    key={subfolder}
                    className={`ue-tree-item ue-tree-item--compact ${selectedSubfolder === subfolder ? "active" : ""}`}
                    onClick={() => onSubfolderSelect(subfolder)}
                  >
                    <Folder size={14} />
                    <span>{subfolder}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="ue-sidebar-subsection">
            <div className="ue-sidebar-subheading">
              <div className="ue-sidebar-subheading-main">
                <Tag size={14} />
                <span>{t("galleryAllCategories")}</span>
              </div>
            </div>
            <div className="ue-tree-list ue-tree-list--compact">
              <button
                className={`ue-tree-item ue-tree-item--compact ${selectedCategory === "" ? "active" : ""}`}
                onClick={() => onCategorySelect("")}
              >
                <Tag size={14} />
                <span>{t("galleryAllCategories")}</span>
              </button>
              {(galleryContext?.categories ?? []).map((category) => (
                <button
                  key={category}
                  className={`ue-tree-item ue-tree-item--compact ${selectedCategory === category ? "active" : ""}`}
                  onClick={() => onCategorySelect(category)}
                >
                  <Tag size={14} />
                  <span>{category}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="ue-sidebar-section ue-sidebar-section--grow">
          <div className="ue-sidebar-heading">
            <span>{t("sidebarLibraries")}</span>
            <span>{libraries.length}</span>
          </div>

          <div className="ue-library-list">
            {libraries.length === 0 ? <div className="ue-sidebar-empty">{t("sidebarNoLibraries")}</div> : null}

            {libraries.map((library) => (
              <div
                key={library.filename}
                className={`ue-library-list-item ${activeLibraryName === library.filename ? "active" : ""}`}
                onClick={() => onLibrarySelect(library.filename)}
              >
                <div className="ue-library-main">
                  <BookOpen size={14} />
                  <div>
                    <strong>{library.filename}</strong>
                    <p>{t("commonEntries", { count: library.count })}</p>
                  </div>
                </div>
                <button
                  className="ue-library-delete"
                  onClick={(event) => {
                    event.stopPropagation();
                    onLibraryDelete(library.filename);
                  }}
                  aria-label={`${t("commonDelete")} ${library.filename}`}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>

          <div className="ue-sidebar-create">
            <label htmlFor="ue-library-name">{t("sidebarCreateLibrary")}</label>
            <div className="ue-sidebar-create-row">
              <input
                id="ue-library-name"
                value={draftName}
                placeholder={t("sidebarCreateLibraryPlaceholder")}
                onChange={(event) => onDraftNameChange(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    onCreateLibrary();
                  }
                }}
              />
              <button onClick={onCreateLibrary} aria-label={t("commonCreate")}>
                <FolderPlus size={15} />
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};
