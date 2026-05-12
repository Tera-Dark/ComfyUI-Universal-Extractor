import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import {
  ArrowRightLeft,
  BookOpen,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  FolderTree,
  HardDrive,
  Images,
  ListTree,
  MoreHorizontal,
  Minimize2,
  PencilLine,
  Pin,
  Search,
  Tag,
  Trash,
  Trash2,
  X,
} from "lucide-react";

import { useI18n } from "../../i18n/I18nProvider";
import type { BoardSummary, GalleryContext, GallerySource, LibraryInfo, WorkspaceTab } from "../../types/universal-gallery";
import { FloatingLayerPortal, placeMenuForEvent, useDismissableLayer } from "../../utils/interaction";
import {
  buildFolderTree,
  collectFolderSearchPaths,
  compareFolderKey,
  DEFAULT_OUTPUT_SOURCE_ID,
  filterSubfoldersBySource,
  FOLDER_SORT_STORAGE_KEY,
  formatFolderLabel,
  getAncestorPaths,
  getFolderPinAliases,
  getFolderSourceId,
  getStoredFolderSort,
  getStoredPinnedFolders,
  isFolderPinned,
  isSourceRootRef,
  makeSourceRootRef,
  PINNED_FOLDERS_STORAGE_KEY,
  TRASH_SUBFOLDER_KEY,
  type FolderSortMode,
  type TreeNode,
} from "./folderTree";

interface WorkspaceSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  activeTab: WorkspaceTab;
  galleryContext: GalleryContext | null;
  folderViewMode: "tree" | "list";
  onFolderViewModeChange: (mode: "tree" | "list") => void;
  selectedCategory: string;
  selectedSubfolder: string;
  selectedBoardId: string;
  pinnedOnly: boolean;
  onCategorySelect: (value: string) => void;
  onSubfolderSelect: (value: string) => void;
  onBoardSelect: (value: string) => void;
  onPinnedOnlySelect: () => void;
  onCreateBoard: () => void;
  onCreateFolder: () => void;
  onDeleteFolder: (path?: string) => void;
  onMergeFolder: (path?: string) => void;
  onRenameFolder: (path: string) => void;
  libraries: LibraryInfo[];
  activeLibraryName: string | null;
  onLibrarySelect: (name: string) => void;
  onLibraryDelete: (name: string) => void;
  draftName: string;
  onDraftNameChange: (value: string) => void;
  onCreateLibrary: () => void;
}

type SidebarGroupId = "folders" | "boards" | "categories";

const TreeBranch = ({
  node,
  depth,
  expandedPaths,
  selectedSubfolder,
  onToggle,
  onSelect,
  onContextMenu,
  pinnedFolders,
  searchActive,
}: {
  node: TreeNode;
  depth: number;
  expandedPaths: Set<string>;
  selectedSubfolder: string;
  onToggle: (path: string) => void;
  onSelect: (value: string) => void;
  onContextMenu: (event: MouseEvent, path: string) => void;
  pinnedFolders: Set<string>;
  searchActive: boolean;
}) => {
  const hasChildren = node.children.length > 0;
  const expanded = searchActive || expandedPaths.has(node.path);
  const pinned = isFolderPinned(node.path, pinnedFolders);

  return (
    <div className="ue-tree-branch">
      <div
        className={`ue-tree-row ${selectedSubfolder === node.path ? "active" : ""}`}
        style={{ paddingLeft: `${depth * 12}px` }}
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

        <button
          className={`ue-tree-label ${pinned ? "is-pinned" : ""}`}
          onClick={() => onSelect(node.path)}
          onContextMenu={(event) => onContextMenu(event, node.path)}
          title={node.path}
        >
          <Folder size={14} />
          <span>{node.name}</span>
          {pinned ? <Pin size={11} fill="currentColor" /> : null}
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
                onContextMenu={onContextMenu}
                pinnedFolders={pinnedFolders}
                searchActive={searchActive}
              />
          ))}
        </div>
      ) : null}
    </div>
  );
};

export const WorkspaceSidebar = ({
  collapsed,
  onToggle,
  activeTab,
  galleryContext,
  folderViewMode,
  onFolderViewModeChange,
  selectedCategory,
  selectedSubfolder,
  selectedBoardId,
  pinnedOnly,
  onCategorySelect,
  onSubfolderSelect,
  onBoardSelect,
  onPinnedOnlySelect,
  onCreateBoard,
  onCreateFolder,
  onDeleteFolder,
  onMergeFolder,
  onRenameFolder,
  libraries,
  activeLibraryName,
  onLibrarySelect,
  onLibraryDelete,
  draftName,
  onDraftNameChange,
  onCreateLibrary,
}: WorkspaceSidebarProps) => {
  const { t } = useI18n();
  const boards = galleryContext?.boards ?? [];
  const [pinnedFolderPaths, setPinnedFolderPaths] = useState<Set<string>>(() => getStoredPinnedFolders());
  const [folderSortMode, setFolderSortMode] = useState<FolderSortMode>(() => getStoredFolderSort());
  const [folderContextMenu, setFolderContextMenu] = useState<{ path: string; x: number; y: number } | null>(null);
  const [folderActionsMenu, setFolderActionsMenu] = useState<{ x: number; y: number } | null>(null);
  const [folderSearchQuery, setFolderSearchQuery] = useState("");
  const [expandedSidebarGroups, setExpandedSidebarGroups] = useState<Set<SidebarGroupId>>(
    () => new Set(["folders", "boards", "categories"]),
  );
  const currentSourceId = selectedSubfolder === TRASH_SUBFOLDER_KEY
    ? DEFAULT_OUTPUT_SOURCE_ID
    : getFolderSourceId(selectedSubfolder);
  const currentSource = useMemo(
    () => (galleryContext?.sources ?? []).find((source) => source.id === currentSourceId) ?? null,
    [currentSourceId, galleryContext?.sources],
  );
  const currentSourceWritable = Boolean(currentSource?.enabled && currentSource.exists && currentSource.writable);
  const selectedConcreteFolder = Boolean(selectedSubfolder && selectedSubfolder !== TRASH_SUBFOLDER_KEY && !isSourceRootRef(selectedSubfolder));
  const canMutateSelectedFolder = currentSourceWritable && selectedConcreteFolder && getFolderSourceId(selectedSubfolder) === currentSourceId;
  const scopedSubfolders = useMemo(
    () => filterSubfoldersBySource(galleryContext?.subfolders ?? [], currentSourceId),
    [currentSourceId, galleryContext?.subfolders],
  );
  const folderModifiedAt = useMemo(
    () =>
      new Map(
        (galleryContext?.subfolder_details ?? []).map((detail) => [
          detail.path,
          Number.isFinite(detail.modified_at) ? detail.modified_at : 0,
        ]),
      ),
    [galleryContext?.subfolder_details],
  );
  const visibleSubfolders = useMemo(
    () => collectFolderSearchPaths(scopedSubfolders, folderSearchQuery),
    [folderSearchQuery, scopedSubfolders],
  );
  const sortedSubfolders = useMemo(
    () => [...visibleSubfolders].sort((left, right) => compareFolderKey(left, right, pinnedFolderPaths, folderSortMode, folderModifiedAt)),
    [folderModifiedAt, folderSortMode, pinnedFolderPaths, visibleSubfolders],
  );
  const getSidebarSourceLabel = useCallback((source: GallerySource | undefined, fallbackId: string) => {
    if (source?.id === DEFAULT_OUTPUT_SOURCE_ID || source?.kind === "output") {
      return t("sidebarOutputSource");
    }
    if (source?.kind === "input") {
      return t("sidebarInputSource");
    }
    return source?.name || fallbackId;
  }, [t]);
  const quickAccessSources = useMemo(
    () => (galleryContext?.sources ?? []).filter((source) => source.enabled && source.exists),
    [galleryContext?.sources],
  );
  const folderPanelTitle = currentSource?.kind === "input"
    ? t("sidebarInputDirs")
    : currentSource?.kind === "custom"
      ? t("sidebarCustomDirs")
      : t("sidebarOutputDirs");
  const readOnlyFolderTitle = currentSource?.kind === "input" ? t("sidebarInputReadOnly") : t("sidebarSourceReadOnly");
  const folderTree = useMemo(
    () => buildFolderTree(
      visibleSubfolders,
      pinnedFolderPaths,
      folderSortMode,
      galleryContext?.sources ?? [],
      getSidebarSourceLabel,
      currentSourceId,
      folderModifiedAt,
    ),
    [currentSourceId, folderModifiedAt, folderSortMode, galleryContext?.sources, getSidebarSourceLabel, pinnedFolderPaths, visibleSubfolders],
  );
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());
  const folderSearchActive = folderSearchQuery.trim().length > 0;

  useEffect(() => {
    window.localStorage.setItem(PINNED_FOLDERS_STORAGE_KEY, JSON.stringify([...pinnedFolderPaths]));
  }, [pinnedFolderPaths]);

  useEffect(() => {
    window.localStorage.setItem(FOLDER_SORT_STORAGE_KEY, folderSortMode);
  }, [folderSortMode]);

  const closeFolderContextMenu = useCallback(() => setFolderContextMenu(null), []);
  useDismissableLayer(Boolean(folderContextMenu), closeFolderContextMenu, {
    closeOnContextMenu: true,
    closeOnScroll: true,
  });

  const closeFolderActionsMenu = useCallback(() => setFolderActionsMenu(null), []);
  useDismissableLayer(Boolean(folderActionsMenu), closeFolderActionsMenu, {
    closeOnContextMenu: true,
    closeOnScroll: true,
  });

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

  const handleFolderContextMenu = (event: MouseEvent, path: string) => {
    event.preventDefault();
    event.stopPropagation();
    const position = placeMenuForEvent(event, { width: 220, height: 220 }, "pointer");
    setFolderContextMenu({
      path,
      x: position.x,
      y: position.y,
    });
  };

  const handleFolderActionsMenu = (event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const position = placeMenuForEvent(event, { width: 220, height: folderViewMode === "tree" ? 240 : 204 });
    setFolderActionsMenu((current) => current ? null : position);
  };

  const runFolderAction = (action: () => void) => {
    action();
    closeFolderActionsMenu();
  };

  const togglePinnedFolder = (path: string) => {
    setPinnedFolderPaths((current) => {
      const next = new Set(current);
      const aliases = getFolderPinAliases(path);
      if (aliases.some((alias) => next.has(alias))) {
        aliases.forEach((alias) => next.delete(alias));
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const toggleFolderSortMode = () => {
    setFolderSortMode((current) => (current === "modified" ? "name" : "modified"));
  };

  const toggleSidebarGroup = (group: SidebarGroupId) => {
    setExpandedSidebarGroups((current) => {
      const next = new Set(current);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  };
  const currentSourceRootRef = makeSourceRootRef(currentSourceId);

  return (
    <aside className={`ue-sidebar ${collapsed ? "is-collapsed" : ""}`}>
      <button 
        className="ue-sidebar-toggle-edge"
        onClick={onToggle}
        aria-label={collapsed ? t("sidebarExpand") : t("sidebarCollapse")}
        title={collapsed ? t("sidebarExpand") : t("sidebarCollapse")}
      >
        <ChevronRight size={14} className="ue-sidebar-toggle-icon" />
      </button>

      {activeTab === "gallery" ? (
        <div className="ue-sidebar-section ue-sidebar-section--grow">
          <div className="ue-sidebar-heading">
            <span>{t("sidebarResources")}</span>
            <strong>{galleryContext?.active_source_count ?? 0}</strong>
          </div>

          <div className="ue-sidebar-quick">
            <div className="ue-sidebar-quick-label">{t("sidebarQuickAccess")}</div>
            {quickAccessSources.length > 0 ? (
              quickAccessSources.map((source) => {
                const value = makeSourceRootRef(source.id);
                const active = currentSourceId === source.id && selectedSubfolder !== TRASH_SUBFOLDER_KEY && selectedBoardId === "" && !pinnedOnly;
                const SourceIcon = source.kind === "input" ? Images : source.kind === "custom" ? Folder : HardDrive;
                return (
                  <button
                    key={source.id}
                    className={`ue-tree-item ue-tree-item--root ${active ? "active" : ""}`}
                    onClick={() => onSubfolderSelect(value)}
                    title={source.path}
                  >
                    <SourceIcon size={14} />
                    <span>{getSidebarSourceLabel(source, source.id)}</span>
                  </button>
                );
              })
            ) : (
              <button
                className={`ue-tree-item ue-tree-item--root ${selectedSubfolder === "" && selectedBoardId === "" && !pinnedOnly ? "active" : ""}`}
                onClick={() => onSubfolderSelect("")}
              >
                <HardDrive size={14} />
                <span>{galleryContext?.output_dir_relative || "./output"}</span>
              </button>
            )}
            <button
              className={`ue-tree-item ue-tree-item--root ${selectedSubfolder === "__trash__" && selectedBoardId === "" ? "active" : ""}`}
              onClick={() => onSubfolderSelect("__trash__")}
            >
              <Trash size={14} />
              <span>{t("sidebarTrash")}</span>
            </button>
          </div>

          <div className="ue-sidebar-scroll" data-has-query={folderSearchActive ? "true" : "false"}>
          <div className="ue-sidebar-group">
            <div className="ue-sidebar-group-header ue-sidebar-group-header--folders">
              <button
                className="ue-sidebar-group-title"
                onClick={() => toggleSidebarGroup("folders")}
                aria-expanded={expandedSidebarGroups.has("folders")}
              >
                <span className="ue-sidebar-group-chevron">
                  {expandedSidebarGroups.has("folders") ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </span>
                <span className="ue-sidebar-group-icon">
                  {currentSource?.kind === "input" ? <Images size={14} /> : currentSource?.kind === "custom" ? <FolderOpen size={14} /> : <HardDrive size={14} />}
                </span>
                <span className="ue-sidebar-group-copy">
                  <strong>{folderPanelTitle}</strong>
                  <em>{t("sidebarFolderCount", { count: scopedSubfolders.length })}</em>
                </span>
              </button>
              <div className="ue-sidebar-subactions">
                {currentSourceWritable ? (
                  <button
                    className="ue-sidebar-subaction"
                    onClick={onCreateFolder}
                    title={t("sidebarCreateFolder")}
                    aria-label={t("sidebarCreateFolder")}
                  >
                    <FolderPlus size={13} />
                  </button>
                ) : (
                  <button
                    className="ue-sidebar-subaction"
                    disabled
                    title={readOnlyFolderTitle}
                    aria-label={readOnlyFolderTitle}
                  >
                    <FolderPlus size={13} />
                  </button>
                )}
                <div className="ue-sidebar-viewmodes" role="group" aria-label={t("sidebarFolderViewMode")}>
                  <button
                    className={folderViewMode === "list" ? "active" : ""}
                    onClick={() => onFolderViewModeChange("list")}
                    title={t("sidebarListView")}
                    aria-label={t("sidebarListView")}
                  >
                    <ListTree size={14} />
                  </button>
                  <button
                    className={folderViewMode === "tree" ? "active" : ""}
                    onClick={() => onFolderViewModeChange("tree")}
                    title={t("sidebarTreeView")}
                    aria-label={t("sidebarTreeView")}
                  >
                    <FolderTree size={14} />
                  </button>
                </div>
                <div className="ue-sidebar-more">
                  <button
                    className={`ue-sidebar-subaction ${folderActionsMenu ? "active" : ""}`}
                    onClick={handleFolderActionsMenu}
                    title={t("sidebarMoreActions")}
                    aria-label={t("sidebarMoreActions")}
                  >
                    <MoreHorizontal size={13} />
                  </button>
                </div>
              </div>
            </div>
            {expandedSidebarGroups.has("folders") ? (
              <>
                <label className="ue-sidebar-search">
                  <Search size={13} />
                  <input
                    value={folderSearchQuery}
                    placeholder={t("sidebarFolderSearch")}
                    onChange={(event) => setFolderSearchQuery(event.target.value)}
                  />
                  {folderSearchActive ? (
                    <button
                      type="button"
                      onClick={() => setFolderSearchQuery("")}
                      title={t("sidebarClearFolderSearch")}
                      aria-label={t("sidebarClearFolderSearch")}
                    >
                      <X size={12} />
                    </button>
                  ) : null}
                </label>

                {folderSearchActive && visibleSubfolders.length === 0 ? (
                  <div className="ue-sidebar-empty">{t("sidebarNoFolderMatches")}</div>
                ) : folderViewMode === "tree" ? (
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
                        onContextMenu={handleFolderContextMenu}
                        pinnedFolders={pinnedFolderPaths}
                        searchActive={folderSearchActive}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="ue-tree-list ue-tree-list--flat">
                    {!folderSearchActive ? (
                      <button
                        className={`ue-tree-item ue-tree-item--compact ${selectedSubfolder === currentSourceRootRef && selectedBoardId === "" && !pinnedOnly ? "active" : ""}`}
                        onClick={() => onSubfolderSelect(currentSourceRootRef)}
                      >
                        <Folder size={14} />
                        <span>./</span>
                      </button>
                    ) : null}
                    {sortedSubfolders.map((subfolder) => (
                      <button
                        key={subfolder}
                        className={`ue-tree-item ue-tree-item--compact ${selectedSubfolder === subfolder ? "active" : ""} ${isFolderPinned(subfolder, pinnedFolderPaths) ? "is-pinned" : ""}`}
                        onClick={() => onSubfolderSelect(subfolder)}
                        onContextMenu={(event) => handleFolderContextMenu(event, subfolder)}
                        title={subfolder}
                      >
                        <Folder size={14} />
                        <span>{formatFolderLabel(subfolder, galleryContext?.sources ?? [], getSidebarSourceLabel, currentSourceId)}</span>
                        {isFolderPinned(subfolder, pinnedFolderPaths) ? <Pin size={11} fill="currentColor" /> : null}
                      </button>
                    ))}
                </div>
                )}
              </>
            ) : null}
          </div>

          <div className="ue-sidebar-group">
            <div className="ue-sidebar-group-header">
              <button
                className="ue-sidebar-group-toggle"
                onClick={() => toggleSidebarGroup("boards")}
                aria-expanded={expandedSidebarGroups.has("boards")}
              >
                {expandedSidebarGroups.has("boards") ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <Images size={14} />
                <span>{t("sidebarBoards")}</span>
                <em>{t("sidebarBoardCount", { count: boards.length })}</em>
              </button>
              <div className="ue-sidebar-subactions">
                <button
                  className="ue-sidebar-subaction"
                  onClick={onCreateBoard}
                  title={t("sidebarCreateBoard")}
                  aria-label={t("sidebarCreateBoard")}
                >
                  <FolderPlus size={12} />
                </button>
              </div>
            </div>

            {expandedSidebarGroups.has("boards") ? (
              <div className="ue-board-list">
                <button
                  className={`ue-board-list-item ${selectedBoardId === "" && pinnedOnly ? "active" : ""}`}
                  onClick={onPinnedOnlySelect}
                >
                  <span className="ue-board-cover ue-board-cover--empty">
                    <Pin size={14} />
                  </span>
                  <span>{t("sidebarAllPins")}</span>
                  <em>{galleryContext?.pinned_count ?? 0}</em>
                </button>
                {boards.map((board: BoardSummary) => (
                  <button
                    key={board.id}
                    className={`ue-board-list-item ${selectedBoardId === board.id ? "active" : ""}`}
                    onClick={() => onBoardSelect(board.id)}
                    title={board.name}
                  >
                    <span className="ue-board-cover">
                      {board.cover_image ? <img src={board.cover_image.thumb_url} alt="" loading="lazy" /> : <Images size={14} />}
                    </span>
                    <span>{board.name}</span>
                    <em>{board.count}</em>
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="ue-sidebar-group">
            <div className="ue-sidebar-group-header">
              <button
                className="ue-sidebar-group-toggle"
                onClick={() => toggleSidebarGroup("categories")}
                aria-expanded={expandedSidebarGroups.has("categories")}
              >
                {expandedSidebarGroups.has("categories") ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                <Tag size={14} />
                <span>{t("galleryAllCategories")}</span>
                <em>{t("sidebarCategoryCount", { count: galleryContext?.categories.length ?? 0 })}</em>
              </button>
            </div>

            {expandedSidebarGroups.has("categories") ? (
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
            ) : null}
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
      {folderActionsMenu ? (
        <FloatingLayerPortal>
          <div
            className="ue-sidebar-action-menu"
            style={{ top: folderActionsMenu.y, left: folderActionsMenu.x }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button onClick={() => runFolderAction(toggleFolderSortMode)}>
              <ListTree size={14} />
              <span>{folderSortMode === "modified" ? t("folderSortByName") : t("folderSortByModified")}</span>
            </button>
            <button onClick={() => runFolderAction(() => togglePinnedFolder(selectedSubfolder))} disabled={!selectedConcreteFolder}>
              <Pin size={14} fill={selectedSubfolder && isFolderPinned(selectedSubfolder, pinnedFolderPaths) ? "currentColor" : "none"} />
              <span>{selectedSubfolder && isFolderPinned(selectedSubfolder, pinnedFolderPaths) ? t("folderUnpin") : t("folderPin")}</span>
            </button>
            <button
              onClick={() => runFolderAction(() => onRenameFolder(selectedSubfolder))}
              disabled={!canMutateSelectedFolder}
              title={canMutateSelectedFolder ? undefined : readOnlyFolderTitle}
            >
              <PencilLine size={14} />
              <span>{t("folderRename")}</span>
            </button>
            <button
              onClick={() => runFolderAction(() => onMergeFolder(selectedSubfolder))}
              disabled={!canMutateSelectedFolder}
              title={canMutateSelectedFolder ? undefined : readOnlyFolderTitle}
            >
              <ArrowRightLeft size={14} />
              <span>{t("sidebarMergeFolder")}</span>
            </button>
            <button
              onClick={() => runFolderAction(() => onDeleteFolder(selectedSubfolder))}
              disabled={!canMutateSelectedFolder}
              className="is-danger"
              title={canMutateSelectedFolder ? undefined : readOnlyFolderTitle}
            >
              <Trash2 size={14} />
              <span>{t("sidebarDeleteFolder")}</span>
            </button>
            {folderViewMode === "tree" ? (
              <button onClick={() => runFolderAction(collapseAllFolders)}>
                <Minimize2 size={14} />
                <span>{t("sidebarCollapseAll")}</span>
              </button>
            ) : null}
          </div>
        </FloatingLayerPortal>
      ) : null}
      {folderContextMenu ? (
        <FloatingLayerPortal>
          <div
            className="ue-sidebar-context-menu"
            style={{ top: folderContextMenu.y, left: folderContextMenu.x }}
            onClick={(event) => event.stopPropagation()}
            onContextMenu={(event) => event.preventDefault()}
          >
            <button
              className="ue-sidebar-context-item"
              onClick={() => {
                onRenameFolder(folderContextMenu.path);
                setFolderContextMenu(null);
              }}
            >
              <PencilLine size={14} />
              <span>{t("folderRename")}</span>
            </button>
            <button
              className="ue-sidebar-context-item"
              onClick={() => {
                togglePinnedFolder(folderContextMenu.path);
                setFolderContextMenu(null);
              }}
            >
              <Pin size={14} fill={isFolderPinned(folderContextMenu.path, pinnedFolderPaths) ? "currentColor" : "none"} />
              <span>{isFolderPinned(folderContextMenu.path, pinnedFolderPaths) ? t("folderUnpin") : t("folderPin")}</span>
            </button>
            <button
              className="ue-sidebar-context-item"
              onClick={() => {
                onMergeFolder(folderContextMenu.path);
                setFolderContextMenu(null);
              }}
            >
              <ArrowRightLeft size={14} />
              <span>{t("sidebarMergeFolder")}</span>
            </button>
            <button
              className="ue-sidebar-context-item ue-sidebar-context-item--danger"
              onClick={() => {
                onDeleteFolder(folderContextMenu.path);
                setFolderContextMenu(null);
              }}
            >
              <Trash2 size={14} />
              <span>{t("sidebarDeleteFolder")}</span>
            </button>
          </div>
        </FloatingLayerPortal>
      ) : null}
    </aside>
  );
};
