import { startTransition, useMemo, useState } from "react";

import { GalleryWorkspace } from "./components/gallery/GalleryWorkspace";
import { GalleryInspectorPanel } from "./components/gallery/GalleryInspectorPanel";
import { ImageDetailModal } from "./components/gallery/ImageDetailModal";
import { LibraryWorkspace } from "./components/library/LibraryWorkspace";
import { TopNavigation } from "./components/shared/TopNavigation";
import { WorkspaceSidebar } from "./components/shared/WorkspaceSidebar";
import { TextInputDialog } from "./components/shared/TextInputDialog";
import { SettingsWorkspace } from "./components/settings/SettingsWorkspace";
import { WorkbenchWorkspace } from "./components/workbench/WorkbenchWorkspace";
import { useGalleryData } from "./hooks/useGalleryData";
import { useI18n } from "./i18n/I18nProvider";
import { useLibraryData } from "./hooks/useLibraryData";
import { galleryApi } from "./services/galleryApi";
import { useConfirm } from "./components/shared/ConfirmDialog";
import { useToast } from "./components/shared/ToastViewport";
import type { ImageRecord, LibraryInfo, WorkspaceTab } from "./types/universal-gallery";
import "./App.css";

const PENDING_WORKFLOW_KEY = "universal-extractor:pending-workflow";
const WORKFLOW_CHANNEL_NAME = "universal-extractor-workflow";
const COMFY_WINDOW_NAME = "comfyui-main";
const WORKFLOW_MESSAGE_TYPE = "universal-extractor:workflow-message";
const MAX_STORAGE_WORKFLOW_BYTES = 1_500_000;

type FolderDialogMode = "create" | "merge" | "rename";

interface FolderDialogState {
  mode: FolderDialogMode;
  initialValue: string;
  sourcePath?: string;
}

const matchesLibrarySearch = (library: LibraryInfo, searchTerm: string) => {
  const query = searchTerm.trim().toLowerCase();
  if (!query) {
    return true;
  }
  return library.filename.toLowerCase().includes(query);
};

function App() {
  const { t } = useI18n();
  const { confirm } = useConfirm();
  const { pushToast } = useToast();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("gallery");
  const [librarySearchTerm, setLibrarySearchTerm] = useState("");
  const [folderViewMode, setFolderViewMode] = useState<"tree" | "list">("tree");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => typeof window !== "undefined" ? window.innerWidth <= 960 : false);
  const [folderDialog, setFolderDialog] = useState<FolderDialogState | null>(null);
  const [boardDialogOpen, setBoardDialogOpen] = useState(false);

  const gallery = useGalleryData();
  const library = useLibraryData(true);

  const filteredLibraries = useMemo(
    () => library.libraries.filter((item) => matchesLibrarySearch(item, librarySearchTerm)),
    [library.libraries, librarySearchTerm],
  );

  const canUseRawLibraryEditor = library.entryTotal <= 5000;

  const confirmDiscardLibraryEdits = async () => {
    if (!library.isDirty) {
      return true;
    }
    return confirm({
      title: t("libraryUnsavedTitle"),
      message: t("libraryUnsavedConfirm"),
      tone: "warning",
      confirmLabel: t("libraryDiscardChanges"),
      cancelLabel: t("libraryCancel"),
    });
  };

  const handleTabChange = async (tab: WorkspaceTab) => {
    if (activeTab === "library" && tab !== "library" && !(await confirmDiscardLibraryEdits())) {
      return;
    }
    startTransition(() => {
      setActiveTab(tab);
    });
  };

  const handleSearchChange = (value: string) => {
    if (activeTab === "gallery") {
      startTransition(() => {
        gallery.setSearchTerm(value);
        gallery.setPage(1);
      });
      return;
    }

    startTransition(() => {
      setLibrarySearchTerm(value);
      library.setSearchTerm(value);
      library.setEntryPage(1);
    });
  };

  const handleLibrarySelect = async (name: string) => {
    if (activeTab === "library" && library.activeLibraryName !== name && !(await confirmDiscardLibraryEdits())) {
      return;
    }
    startTransition(() => {
      setActiveTab("library");
    });
    try {
      await library.openLibrary(name);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t("errorOpenLibrary"), "error");
    }
  };

  const handleCreateLibrary = async () => {
    try {
      const result = await library.createLibrary();
      if (!result.ok && result.message) {
        pushToast(result.message, "error");
      } else {
        pushToast(t("libraryCreateSuccess"), "success");
      }
      gallery.refresh();
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t("errorCreateLibrary"), "error");
    }
  };

  const handleDeleteLibrary = async (name: string) => {
    if (library.activeLibraryName === name && !(await confirmDiscardLibraryEdits())) {
      return;
    }
    const approved = await confirm({
      title: t("commonDelete"),
      message: t("confirmDeleteLibrary", { name }),
      tone: "warning",
      confirmLabel: t("commonDelete"),
      cancelLabel: t("libraryCancel"),
    });
    if (!approved) {
      return;
    }
    try {
      await library.deleteLibrary(name);
      pushToast(t("commonDelete"), "success");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t("errorDeleteLibrary"), "error");
    }
  };

  const handleSaveLibrary = async () => {
    try {
      const result = await library.saveLibrary();
      if (!result.ok && result.message) {
        pushToast(result.message, "error");
      } else {
        pushToast(t("librarySaveSuccess", { count: library.entryTotal }), "success");
      }
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t("errorSaveLibrary"), "error");
    }
  };

  const handleRefresh = async () => {
    if (activeTab === "library" && !(await confirmDiscardLibraryEdits())) {
      return;
    }
    if (activeTab === "gallery") {
      gallery.refresh();
      return;
    }
    if (activeTab === "settings") {
      gallery.refresh();
      return;
    }
    await library.refreshLibraries();
    if (library.activeLibraryName) {
      await library.refreshActiveLibrary();
    }
  };

  const handleExportLibrary = () => {
    if (!library.activeLibraryName) {
      return;
    }

    void galleryApi.getLibraryRaw(library.activeLibraryName).then((response) => {
      const blob = new Blob([response.text], { type: "application/json;charset=utf-8" });
      const objectUrl = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = library.activeLibraryName!;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(objectUrl);
    }).catch((error) => {
      pushToast(error instanceof Error ? error.message : t("errorOpenLibrary"), "error");
    });
  };

  const handleCreateFolder = () => {
    const basePath = gallery.selectedSubfolder ? `${gallery.selectedSubfolder}/` : "";
    setFolderDialog({ mode: "create", initialValue: basePath });
  };

  const handleSubmitBoardDialog = async (name: string) => {
    try {
      const result = await gallery.createBoard(name);
      if (result.board?.id) {
        gallery.setSelectedBoardId(result.board.id);
        gallery.setSelectedSubfolder("");
        gallery.setFavoritesOnly(false);
        gallery.setPage(1);
      }
      pushToast(t("boardCreateSuccess"), "success");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t("boardCreateError"), "error");
      throw error;
    }
  };

  const handleSubmitFolderDialog = async (path: string) => {
    if (!folderDialog) {
      return;
    }

    try {
      if (folderDialog.mode === "create") {
        await gallery.createFolder(path);
        gallery.refresh();
        pushToast(t("folderCreateSuccess"), "success");
      } else if (folderDialog.mode === "merge") {
        await gallery.mergeFolder(gallery.selectedSubfolder, path);
        pushToast(t("folderMergeSuccess"), "success");
      } else if (folderDialog.sourcePath) {
        await gallery.renameFolder(folderDialog.sourcePath, path);
        pushToast(t("folderRenameSuccess"), "success");
      }
    } catch (error) {
      const fallback =
        folderDialog.mode === "create"
          ? t("folderCreateError")
          : folderDialog.mode === "merge"
            ? t("folderMergeError")
            : t("folderRenameError");
      pushToast(error instanceof Error ? error.message : fallback, "error");
      throw error;
    }
  };

  const handleDeleteFolder = async () => {
    if (!gallery.selectedSubfolder) {
      return;
    }
    const approved = await confirm({
      title: t("commonDelete"),
      message: t("folderDeleteConfirm", { name: gallery.selectedSubfolder }),
      tone: gallery.selectedSubfolder.includes("/") ? "warning" : "danger",
      confirmLabel: t("commonDelete"),
      cancelLabel: t("libraryCancel"),
    });
    if (!approved) {
      return;
    }

    try {
      await gallery.deleteFolder(gallery.selectedSubfolder);
      pushToast(t("folderDeleteSuccess"), "success");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t("folderDeleteError"), "error");
    }
  };

  const handleMergeFolder = () => {
    if (!gallery.selectedSubfolder) {
      return;
    }
    setFolderDialog({ mode: "merge", initialValue: "" });
  };

  const handleRenameFolder = (path: string) => {
    if (!path) {
      return;
    }
    setFolderDialog({ mode: "rename", initialValue: path, sourcePath: path });
  };

  const handleWorkbenchLibrarySelect = async (name: string) => {
    try {
      await library.openLibrary(name);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t("errorOpenLibrary"), "error");
    }
  };

  const handleImportFiles = async (files: File[], targetSourceId = "") => {
    const response = await gallery.importFiles(files, targetSourceId);
    await library.refreshLibraries();
    const importedCount = response.imported_images.length + response.imported_libraries.length;
    if (importedCount > 0) {
      pushToast(t("galleryImportSuccess", { count: importedCount }), "success");
    }
    if (response.skipped.length > 0) {
      pushToast(t("galleryImportSkipped", { count: response.skipped.length }), "info");
    }
  };

  const handleUpdateImageState = async (relativePath: string, updates: Record<string, unknown>) => {
    await gallery.updateImageState(relativePath, updates);
    if (gallery.searchTerm.trim()) {
      gallery.refresh();
    }
  };

  const handleRenameImage = async (relativePath: string, newFilename: string) => {
    try {
      await gallery.renameImage(relativePath, newFilename);
      pushToast(t("modalRenameFile"), "success");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t("imageRenameError"), "error");
    }
  };

  const handleDeleteSingleImage = async (relativePath: string) => {
    try {
      await gallery.deleteImages([relativePath]);
      pushToast(t("imageDelete"), "success");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t("imageDeleteError"), "error");
    }
  };

  const handleOpenImageWorkflow = async (image: { relative_path: string; original_url?: string; url?: string }) => {
    const approved = await confirm({
      title: t("modalOpenWorkflow"),
      message: t("workflowSendConfirm", { name: image.relative_path }),
      tone: "info",
      confirmLabel: t("commonCreate"),
      cancelLabel: t("libraryCancel"),
    });
    if (!approved) {
      return;
    }

    try {
      const metadata = await galleryApi.getImageMetadata(image.relative_path);
      const payload = {
        id: `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        workflow: metadata.workflow,
        prompt: metadata.metadata && typeof metadata.metadata === "object" ? (metadata.metadata as Record<string, unknown>).prompt ?? null : null,
        image: image.relative_path,
        imageUrl: image.original_url || image.url || null,
        ts: Date.now(),
      };

      if (!payload.workflow && !payload.prompt) {
        pushToast(t("modalNoMetadata"), "error");
        return;
      }

      const comfyWindow = window.open(`${window.location.origin}/`, COMFY_WINDOW_NAME);
      const message = {
        type: WORKFLOW_MESSAGE_TYPE,
        payload,
      };
      const dispatchPayload = () => {
        if (comfyWindow && !comfyWindow.closed) {
          comfyWindow.postMessage(message, window.location.origin);
        }

        if ("BroadcastChannel" in window) {
          const channel = new BroadcastChannel(WORKFLOW_CHANNEL_NAME);
          channel.postMessage(payload);
          channel.close();
        }
      };

      dispatchPayload();
      [180, 520, 1200, 2200].forEach((delay) => {
        window.setTimeout(dispatchPayload, delay);
      });

      try {
        const serializedPayload = JSON.stringify(payload);
        if (serializedPayload.length <= MAX_STORAGE_WORKFLOW_BYTES) {
          window.localStorage.setItem(PENDING_WORKFLOW_KEY, serializedPayload);
        } else {
          window.localStorage.removeItem(PENDING_WORKFLOW_KEY);
        }
      } catch {
        window.localStorage.removeItem(PENDING_WORKFLOW_KEY);
      }

      pushToast(t("workflowSendSuccess"), "success");
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t("modalNoMetadata"), "error");
    }
  };

  const selectedGalleryImages = useMemo(() => {
    const selectedPathSet = new Set(gallery.selectedImagePaths);
    return gallery.images.filter((image) => selectedPathSet.has(image.relative_path));
  }, [gallery.images, gallery.selectedImagePaths]);

  const selectedGalleryBoard = useMemo(
    () => gallery.boards.find((board) => board.id === gallery.selectedBoardId) ?? null,
    [gallery.boards, gallery.selectedBoardId],
  );

  const galleryInspectorOpen =
    activeTab === "gallery" &&
    !gallery.isTrashView &&
    selectedGalleryImages.length > 0;

  const handleOpenGalleryDetail = (image: ImageRecord) => {
    gallery.setSelectedImage(image);
    gallery.setDetailNavigation({
      items: gallery.images,
      currentIndex: gallery.images.findIndex((item) => item.relative_path === image.relative_path),
    });
  };

  return (
    <div className="ue-app-shell">
      <TopNavigation
        activeTab={activeTab}
        onTabChange={handleTabChange}
        searchValue={activeTab === "gallery" ? gallery.searchTerm : activeTab === "library" ? librarySearchTerm : ""}
        onSearchChange={handleSearchChange}
        onRefresh={handleRefresh}
        sidebarCollapsed={sidebarCollapsed}
        onSidebarToggle={() => setSidebarCollapsed((current) => !current)}
      />

      {/* Sidebar Overlay for Mobile */}
      {!sidebarCollapsed && (
        <div 
          className="ue-sidebar-overlay"
          onClick={() => setSidebarCollapsed(true)}
          aria-hidden="true"
        />
      )}
      
      <div className={`ue-body-shell ${sidebarCollapsed ? "is-sidebar-collapsed" : ""} ${galleryInspectorOpen ? "has-inspector" : ""}`}>
        <WorkspaceSidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((current) => !current)}
          activeTab={activeTab}
          galleryContext={gallery.context}
          folderViewMode={folderViewMode}
          onFolderViewModeChange={setFolderViewMode}
          selectedCategory={gallery.selectedCategory}
          selectedSubfolder={gallery.selectedSubfolder}
          selectedBoardId={gallery.selectedBoardId}
          pinnedOnly={gallery.favoritesOnly}
          onCategorySelect={(value) => {
            gallery.setSelectedCategory(value);
            gallery.setPage(1);
          }}
          onSubfolderSelect={(value) => {
            gallery.setSelectedBoardId("");
            gallery.setFavoritesOnly(false);
            gallery.setSelectedSubfolder(value);
            gallery.setPage(1);
          }}
          onBoardSelect={(value) => {
            gallery.setSelectedBoardId(value);
            gallery.setFavoritesOnly(false);
            gallery.setSelectedSubfolder("");
            gallery.setPage(1);
          }}
          onPinnedOnlySelect={() => {
            gallery.setSelectedBoardId("");
            gallery.setSelectedSubfolder("");
            gallery.setFavoritesOnly(true);
            gallery.setPage(1);
          }}
          onCreateBoard={() => setBoardDialogOpen(true)}
          onCreateFolder={handleCreateFolder}
          onDeleteFolder={handleDeleteFolder}
          onMergeFolder={handleMergeFolder}
          onRenameFolder={handleRenameFolder}
          libraries={filteredLibraries}
          activeLibraryName={library.activeLibraryName}
          onLibrarySelect={handleLibrarySelect}
          onLibraryDelete={handleDeleteLibrary}
          draftName={library.draftName}
          onDraftNameChange={library.setDraftName}
          onCreateLibrary={handleCreateLibrary}
        />

        <main className="ue-main-shell">
          {activeTab === "gallery" ? (
            <GalleryWorkspace
              images={gallery.images}
              context={gallery.context}
              total={gallery.total}
              page={gallery.page}
              totalPages={gallery.totalPages}
              selectedCategory={gallery.selectedCategory}
              selectedSubfolder={gallery.selectedSubfolder}
              selectedBoardId={gallery.selectedBoardId}
              dateFrom={gallery.dateFrom}
              dateTo={gallery.dateTo}
              favoritesOnly={gallery.favoritesOnly}
              selectedColorFamily={gallery.selectedColorFamily}
              colorIndexStatus={gallery.colorIndexStatus}
              sortBy={gallery.sortBy}
              sortOrder={gallery.sortOrder}
              gridColumns={gallery.gridColumns}
              selectedImagePaths={gallery.selectedImagePaths}
              trashItems={gallery.trashItems}
              isTrashView={gallery.isTrashView}
              importMessage={gallery.importMessage}
              isLoading={gallery.isLoading}
              isRefreshing={gallery.isRefreshing}
              error={gallery.error}
              boards={gallery.boards}
              onOpenDetail={handleOpenGalleryDetail}
              onPageChange={gallery.setPage}
              onCategoryChange={gallery.setSelectedCategory}
              onBoardChange={gallery.setSelectedBoardId}
              onDateFromChange={gallery.setDateFrom}
              onDateToChange={gallery.setDateTo}
              onFavoritesOnlyChange={gallery.setFavoritesOnly}
              onColorFamilyChange={gallery.setSelectedColorFamily}
              onSortByChange={gallery.setSortBy}
              onSortOrderChange={gallery.setSortOrder}
              onGridColumnsChange={gallery.setGridColumns}
              onOpenWorkflow={handleOpenImageWorkflow}
              onSelectionChange={gallery.setSelectedImagePaths}
              onUpdateImageState={handleUpdateImageState}
              onCreateBoard={gallery.createBoard}
              onUpdateBoardPins={gallery.updateBoardPins}
              onDeleteBoard={gallery.deleteBoard}
              onDeleteImages={gallery.deleteImages}
              onImportFiles={handleImportFiles}
              onRestoreTrashItem={async (id) => {
                await gallery.restoreTrashItem(id);
                pushToast(t("trashRestore"), "success");
              }}
              onRestoreTrashItems={async (ids) => {
                for (const id of ids) {
                  await gallery.restoreTrashItem(id);
                }
              }}
              onPurgeTrashItem={async (id) => {
                const approved = await confirm({
                  title: t("trashDeleteForever"),
                  message: t("trashEmptyText"),
                  tone: "danger",
                  confirmLabel: t("trashDeleteForever"),
                  cancelLabel: t("libraryCancel"),
                });
                if (!approved) return;
                await gallery.purgeTrashItem(id);
                pushToast(t("trashDeleteForever"), "success");
              }}
              onPurgeTrashItems={async (ids) => {
                for (const id of ids) {
                  await gallery.purgeTrashItem(id);
                }
              }}
            />
          ) : activeTab === "library" ? (
            <LibraryWorkspace
              libraries={library.libraries}
              activeLibraryName={library.activeLibraryName}
              entries={library.entries}
              searchTerm={librarySearchTerm}
              onSearchClear={() => {
                setLibrarySearchTerm("");
                library.setSearchTerm("");
                library.setEntryPage(1);
              }}
              editorValue={library.editorValue}
              isEditing={library.isEditing}
              isDirty={library.isDirty}
              isLoading={library.isLoading}
              isRefreshing={library.isRefreshing}
              isSubmitting={library.isSubmitting}
              error={library.error}
              statusMessage={library.statusMessage}
              validationIssues={library.validationIssues}
              canUseRawEditor={canUseRawLibraryEditor}
              page={library.entryPage}
              totalPages={Math.max(1, Math.ceil(library.entryTotal / library.entryLimit))}
              totalEntries={library.entryTotal}
              onEditorValueChange={library.setEditorValue}
              onStartEditing={library.startEditing}
              onPageChange={library.setEntryPage}
              onCancelEditing={async () => {
                if (!(await confirmDiscardLibraryEdits())) {
                  return;
                }
                library.cancelEditing();
              }}
              onFormatEditor={() => {
                const result = library.formatEditor();
                if (!result.ok && result.message) {
                  pushToast(result.message, "error");
                }
              }}
              onSaveLibrary={handleSaveLibrary}
              onRefresh={handleRefresh}
              onExportLibrary={handleExportLibrary}
              onImportLibrary={async (file, mode, targetName, newName) => {
                const result = await library.importLibrary(file, mode, targetName, newName);
                if (!result.ok && result.message) {
                  pushToast(result.message, "error");
                } else {
                  pushToast(t("libraryImportSuccess", { count: library.entryTotal, name: targetName || newName || file.name }), "success");
                }
                return result.ok;
              }}
              onSaveEntry={async (index, entry) => {
                const result = await library.saveEntry(index, entry);
                if (!result.ok && result.message) {
                  pushToast(result.message, "error");
                } else {
                  pushToast(t("librarySaveSuccess", { count: library.entryTotal }), "success");
                }
                return result.ok;
              }}
              onDeleteEntry={async (index) => {
                const result = await library.removeEntry(index);
                if (!result.ok && result.message) {
                  pushToast(result.message, "error");
                } else {
                  pushToast(t("commonDelete"), "success");
                }
                return result.ok;
              }}
            />
          ) : activeTab === "workbench" ? (
            <WorkbenchWorkspace
              libraries={library.libraries}
              activeLibraryName={library.activeLibraryName}
              onLibrarySelect={handleWorkbenchLibrarySelect}
            />
          ) : (
            <SettingsWorkspace
              sources={gallery.context?.sources ?? []}
              onSourcesChange={() => gallery.refresh()}
            />
          )}
        </main>

        {galleryInspectorOpen ? (
          <GalleryInspectorPanel
            selectedImages={selectedGalleryImages}
            selectedPaths={selectedGalleryImages.map((image) => image.relative_path)}
            selectedSubfolder={gallery.selectedSubfolder}
            selectedBoard={selectedGalleryBoard}
            boards={gallery.boards}
            page={gallery.page}
            targetFolderOptions={gallery.targetFolderOptions}
            onClose={() => gallery.setSelectedImagePaths([])}
            onOpenDetail={handleOpenGalleryDetail}
            onOpenWorkflow={handleOpenImageWorkflow}
            onUpdateImageState={handleUpdateImageState}
            onBatchUpdateImages={gallery.batchUpdateImages}
            onCreateBoard={gallery.createBoard}
            onUpdateBoardPins={gallery.updateBoardPins}
            onMoveImages={gallery.moveImages}
            onBatchRenameImages={async (relativePaths, template, startNumber, padding, currentPage) => {
              try {
                const result = await gallery.batchRenameImages(relativePaths, template, startNumber, padding, currentPage);
                pushToast(t("bulkRenameSuccess", { count: result.renamed.length }), "success");
                return result;
              } catch (error) {
                pushToast(error instanceof Error ? error.message : t("bulkRenameError"), "error");
                throw error;
              }
            }}
            onDeleteImages={gallery.deleteImages}
          />
        ) : null}
      </div>

      {gallery.selectedImage ? (
        <ImageDetailModal
          image={gallery.selectedImage}
          onClose={() => gallery.setSelectedImage(null)}
          onSaveState={handleUpdateImageState}
          onRenameFile={handleRenameImage}
          onDeleteFile={handleDeleteSingleImage}
          onOpenWorkflow={handleOpenImageWorkflow}
          navigation={gallery.detailNavigation}
          onNavigate={(nextIndex) => {
            const items = gallery.detailNavigation?.items ?? [];
            const nextImage = items[nextIndex];
            if (!nextImage) return;
            gallery.setSelectedImage(nextImage);
            gallery.setDetailNavigation({
              items,
              currentIndex: nextIndex,
            });
          }}
        />
      ) : null}

      <TextInputDialog
        open={folderDialog !== null}
        title={
          folderDialog?.mode === "merge"
            ? t("folderMergeTitle")
            : folderDialog?.mode === "rename"
              ? t("folderRenameTitle")
              : t("folderCreateTitle")
        }
        text={
          folderDialog?.mode === "merge"
            ? t("folderMergeText")
            : folderDialog?.mode === "rename"
              ? t("folderRenameText")
              : t("folderCreateText")
        }
        label={
          folderDialog?.mode === "merge"
            ? t("folderMergePrompt")
            : folderDialog?.mode === "rename"
              ? t("folderRenamePrompt")
              : t("folderCreatePrompt")
        }
        placeholder={t("folderPathPlaceholder")}
        initialValue={folderDialog?.initialValue ?? ""}
        confirmLabel={
          folderDialog?.mode === "merge"
            ? t("sidebarMergeFolder")
            : folderDialog?.mode === "rename"
              ? t("folderRename")
              : t("commonCreate")
        }
        onClose={() => setFolderDialog(null)}
        onSubmit={handleSubmitFolderDialog}
      />
      <TextInputDialog
        open={boardDialogOpen}
        title={t("boardCreateTitle")}
        text={t("boardCreateText")}
        label={t("boardNameLabel")}
        placeholder={t("boardNamePlaceholder")}
        initialValue=""
        confirmLabel={t("commonCreate")}
        onClose={() => setBoardDialogOpen(false)}
        onSubmit={handleSubmitBoardDialog}
      />
    </div>
  );
}

export default App;
