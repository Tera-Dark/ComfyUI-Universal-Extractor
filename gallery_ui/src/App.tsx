import { Suspense, lazy, startTransition, useMemo, useState } from "react";

import { GalleryWorkspace } from "./components/gallery/GalleryWorkspace";
import { GalleryInspectorPanel } from "./components/gallery/GalleryInspectorPanel";
import { TopNavigation } from "./components/shared/TopNavigation";
import { WorkspaceSidebar } from "./components/shared/WorkspaceSidebar";
import { TextInputDialog } from "./components/shared/TextInputDialog";
import { OnboardingTour } from "./components/shared/OnboardingTour";
import { useGalleryData } from "./hooks/useGalleryData";
import { useI18n } from "./i18n/I18nProvider";
import { useLibraryData } from "./hooks/useLibraryData";
import { galleryApi } from "./services/galleryApi";
import { useConfirm } from "./components/shared/ConfirmDialog";
import { useToast } from "./components/shared/ToastViewport";
import { useOperationStatus } from "./components/shared/OperationStatusCenter";
import { getFolderBaseName } from "./components/shared/folderTree";
import { isOnboardingTourCompleted, markOnboardingTourCompleted } from "./components/shared/onboardingTourModel";
import type { ImageRecord, LibraryInfo, UiPreferences, WorkspaceTab } from "./types/universal-gallery";
import "./App.css";

const ImageDetailModal = lazy(() =>
  import("./components/gallery/ImageDetailModal").then((module) => ({ default: module.ImageDetailModal })),
);
const LibraryWorkspace = lazy(() =>
  import("./components/library/LibraryWorkspace").then((module) => ({ default: module.LibraryWorkspace })),
);
const SettingsWorkspace = lazy(() =>
  import("./components/settings/SettingsWorkspace").then((module) => ({ default: module.SettingsWorkspace })),
);
const WorkbenchWorkspace = lazy(() =>
  import("./components/workbench/WorkbenchWorkspace").then((module) => ({ default: module.WorkbenchWorkspace })),
);

const PENDING_WORKFLOW_KEY = "universal-extractor:pending-workflow";
const WORKFLOW_CHANNEL_NAME = "universal-extractor-workflow";
const WORKFLOW_MESSAGE_TYPE = "universal-extractor:workflow-message";
const WORKFLOW_PROBE_TYPE = "universal-extractor:workflow-probe";
const WORKFLOW_ACK_TYPE = "universal-extractor:workflow-ack";
const WORKFLOW_DELIVERED_TYPE = "universal-extractor:workflow-delivered";
const EXISTING_COMFY_PROBE_TIMEOUT_MS = 450;
const WORKFLOW_DELIVERY_TIMEOUT_MS = 900;
const UI_PREFERENCES_KEY = "universal-extractor:ui-preferences";
const DEFAULT_OUTPUT_SOURCE_ROOT = "default_output::";
const FOLDER_REF_SEPARATOR = "::";

const DEFAULT_UI_PREFERENCES: UiPreferences = {
  defaultSelectionMode: false,
  confirmWorkflowSend: true,
  collapseSidebarOnLaunch: false,
  enableImagePrefetch: true,
  enableLiveGalleryRefresh: true,
  defaultFolderTreeView: true,
};

const isSourceRootRef = (value: string) => value.includes(FOLDER_REF_SEPARATOR) && value.split(FOLDER_REF_SEPARATOR, 2)[1] === "";

const toFolderDialogValue = (value: string) =>
  value.startsWith(DEFAULT_OUTPUT_SOURCE_ROOT) ? value.slice(DEFAULT_OUTPUT_SOURCE_ROOT.length) : value;

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

type WorkflowPayload = {
  id: string;
  workflow: Record<string, unknown> | null;
  prompt: unknown;
  image: string;
  imageUrl: string | null;
  ts: number;
};

type WorkflowAck = {
  instanceId: string;
  visibilityState?: DocumentVisibilityState;
  focused?: boolean;
  ts?: number;
};

const trySendWorkflowToExistingComfyPage = (payload: WorkflowPayload) =>
  new Promise<boolean>((resolve) => {
    if (!("BroadcastChannel" in window)) {
      resolve(false);
      return;
    }

    let resolved = false;
    const probeId = `${payload.id}-probe`;
    const channel = new BroadcastChannel(WORKFLOW_CHANNEL_NAME);
    const candidates: WorkflowAck[] = [];
    let deliveryTimer = 0;
    let probeTimer = 0;

    const cleanup = () => {
      window.clearTimeout(deliveryTimer);
      window.clearTimeout(probeTimer);
      channel.close();
    };

    const finish = (value: boolean) => {
      if (resolved) {
        return;
      }
      resolved = true;
      cleanup();
      resolve(value);
    };

    channel.addEventListener("message", (event) => {
      const data = event.data;
      if (!data || typeof data !== "object") {
        return;
      }
      if (data.type === WORKFLOW_ACK_TYPE && data.probeId === probeId && typeof data.instanceId === "string") {
        candidates.push(data as WorkflowAck);
        return;
      }
      if (data.type === WORKFLOW_DELIVERED_TYPE && data.payloadId === payload.id) {
        finish(true);
      }
    });

    const selectTarget = () => {
      if (resolved) {
        return;
      }
      const target =
        candidates.find((candidate) => candidate.focused) ??
        candidates.find((candidate) => candidate.visibilityState === "visible") ??
        candidates[0];

      if (!target) {
        finish(false);
        return;
      }

      channel.postMessage({
        type: WORKFLOW_MESSAGE_TYPE,
        targetInstanceId: target.instanceId,
        payload,
      });
      deliveryTimer = window.setTimeout(() => finish(false), WORKFLOW_DELIVERY_TIMEOUT_MS);
    };

    channel.postMessage({ type: WORKFLOW_PROBE_TYPE, probeId, payloadId: payload.id });
    probeTimer = window.setTimeout(selectTarget, EXISTING_COMFY_PROBE_TIMEOUT_MS);
  });

const clearPendingWorkflowPayload = () => {
  try {
    window.localStorage.removeItem(PENDING_WORKFLOW_KEY);
  } catch {
    // Best effort cleanup; a stale pending payload must not force a new page.
  }
};

const storeUndeliveredWorkflowPayload = (payload: WorkflowPayload) => {
  try {
    window.localStorage.setItem(PENDING_WORKFLOW_KEY, JSON.stringify(payload));
  } catch {
    clearPendingWorkflowPayload();
  }
};

const getStoredUiPreferences = (): UiPreferences => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(UI_PREFERENCES_KEY) || "{}") as Partial<UiPreferences>;
    return {
      defaultSelectionMode: typeof parsed.defaultSelectionMode === "boolean" ? parsed.defaultSelectionMode : DEFAULT_UI_PREFERENCES.defaultSelectionMode,
      confirmWorkflowSend: typeof parsed.confirmWorkflowSend === "boolean" ? parsed.confirmWorkflowSend : DEFAULT_UI_PREFERENCES.confirmWorkflowSend,
      collapseSidebarOnLaunch: typeof parsed.collapseSidebarOnLaunch === "boolean" ? parsed.collapseSidebarOnLaunch : DEFAULT_UI_PREFERENCES.collapseSidebarOnLaunch,
      enableImagePrefetch: typeof parsed.enableImagePrefetch === "boolean" ? parsed.enableImagePrefetch : DEFAULT_UI_PREFERENCES.enableImagePrefetch,
      enableLiveGalleryRefresh: typeof parsed.enableLiveGalleryRefresh === "boolean" ? parsed.enableLiveGalleryRefresh : DEFAULT_UI_PREFERENCES.enableLiveGalleryRefresh,
      defaultFolderTreeView: typeof parsed.defaultFolderTreeView === "boolean" ? parsed.defaultFolderTreeView : DEFAULT_UI_PREFERENCES.defaultFolderTreeView,
    };
  } catch {
    return DEFAULT_UI_PREFERENCES;
  }
};

function App() {
  const { t } = useI18n();
  const { confirm } = useConfirm();
  const { pushToast } = useToast();
  const { runOperation } = useOperationStatus();
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("gallery");
  const [librarySearchTerm, setLibrarySearchTerm] = useState("");
  const [uiPreferences, setUiPreferences] = useState<UiPreferences>(() => getStoredUiPreferences());
  const [folderViewMode, setFolderViewMode] = useState<"tree" | "list">(() => getStoredUiPreferences().defaultFolderTreeView ? "tree" : "list");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    const preferences = getStoredUiPreferences();
    return typeof window !== "undefined" ? window.innerWidth <= 960 || preferences.collapseSidebarOnLaunch : preferences.collapseSidebarOnLaunch;
  });
  const [gallerySelectionModeActive, setGallerySelectionModeActive] = useState(false);
  const [folderDialog, setFolderDialog] = useState<FolderDialogState | null>(null);
  const [boardDialogOpen, setBoardDialogOpen] = useState(false);
  const [onboardingOpen, setOnboardingOpen] = useState(() => !isOnboardingTourCompleted());

  const gallery = useGalleryData({
    isActive: activeTab === "gallery",
    liveRefreshEnabled: uiPreferences.enableLiveGalleryRefresh,
  });
  const libraryDataEnabled = activeTab === "library" || activeTab === "workbench";
  const library = useLibraryData(libraryDataEnabled);

  const filteredLibraries = useMemo(
    () => library.libraries.filter((item) => matchesLibrarySearch(item, librarySearchTerm)),
    [library.libraries, librarySearchTerm],
  );

  const canUseRawLibraryEditor = library.entryTotal <= 5000;

  const updateUiPreferences = (updates: Partial<UiPreferences>) => {
    setUiPreferences((current) => {
      const next = { ...current, ...updates };
      window.localStorage.setItem(UI_PREFERENCES_KEY, JSON.stringify(next));
      if (updates.defaultFolderTreeView !== undefined) {
        setFolderViewMode(updates.defaultFolderTreeView ? "tree" : "list");
      }
      if (updates.collapseSidebarOnLaunch !== undefined && window.innerWidth > 960) {
        setSidebarCollapsed(updates.collapseSidebarOnLaunch);
      }
      return next;
    });
  };

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
    await runOperation(async () => {
      const result = await library.createLibrary();
      if (!result.ok && result.message) {
        throw new Error(result.message);
      }
      gallery.refresh();
      return result;
    }, {
      pending: t("operationCreateLibrary"),
      success: t("libraryCreateSuccess"),
      error: (error) => (error instanceof Error ? error.message : t("errorCreateLibrary")),
    }).catch(() => undefined);
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
    await runOperation(() => library.deleteLibrary(name), {
      pending: t("operationDeleteLibrary"),
      success: t("commonDelete"),
      error: (error) => (error instanceof Error ? error.message : t("errorDeleteLibrary")),
    }).catch(() => undefined);
  };

  const handleSaveLibrary = async () => {
    const approved = await confirm({
      title: t("librarySaveConfirmTitle"),
      message: t("librarySaveConfirm", { name: library.activeLibraryName ?? "" }),
      tone: "warning",
      confirmLabel: t("librarySave"),
      cancelLabel: t("libraryCancel"),
    });
    if (!approved) {
      return;
    }

    await runOperation(async () => {
      const result = await library.saveLibrary();
      if (!result.ok && result.message) {
        throw new Error(result.message);
      }
      return result;
    }, {
      pending: t("operationSaveLibrary"),
      success: t("librarySaveSuccess", { count: library.entryTotal }),
      error: (error) => (error instanceof Error ? error.message : t("errorSaveLibrary")),
    }).catch(() => undefined);
  };

  const handleRefresh = async () => {
    if (activeTab === "library" && !(await confirmDiscardLibraryEdits())) {
      return;
    }
    if (activeTab === "gallery") {
      await runOperation(async () => gallery.refresh(), {
        pending: t("operationRefresh"),
      });
      return;
    }
    if (activeTab === "settings") {
      await runOperation(async () => gallery.refresh(), {
        pending: t("operationRefresh"),
      });
      return;
    }
    await runOperation(async () => {
      await library.refreshLibraries();
      if (library.activeLibraryName) {
        await library.refreshActiveLibrary();
      }
    }, {
      pending: t("operationRefresh"),
    });
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
    const basePath =
      !gallery.selectedSubfolder || gallery.selectedSubfolder === DEFAULT_OUTPUT_SOURCE_ROOT
        ? ""
        : isSourceRootRef(gallery.selectedSubfolder)
          ? gallery.selectedSubfolder
          : `${toFolderDialogValue(gallery.selectedSubfolder)}/`;
    setFolderDialog({ mode: "create", initialValue: basePath });
  };

  const closeOnboardingTour = () => {
    markOnboardingTourCompleted();
    setOnboardingOpen(false);
  };

  const handleSubmitBoardDialog = async (name: string) => {
    const approved = await confirm({
      title: t("boardCreateTitle"),
      message: t("boardCreateConfirm", { name }),
      tone: "warning",
      confirmLabel: t("commonCreate"),
      cancelLabel: t("libraryCancel"),
    });
    if (!approved) {
      return;
    }

    const result = await runOperation(() => gallery.createBoard(name), {
      pending: t("operationCreateBoard"),
      success: t("boardCreateSuccess"),
      error: (error) => (error instanceof Error ? error.message : t("boardCreateError")),
    });
    if (result.board?.id) {
      gallery.setSelectedBoardId(result.board.id);
      gallery.setSelectedSubfolder("");
      gallery.setFavoritesOnly(false);
      gallery.setPage(1);
    }
  };

  const handleSubmitFolderDialog = async (path: string) => {
    if (!folderDialog) {
      return;
    }

    if (folderDialog.mode === "create") {
      await runOperation(() => gallery.createFolder(path), {
        pending: t("operationCreateFolder"),
        success: t("folderCreateSuccess"),
        error: (error) => (error instanceof Error ? error.message : t("folderCreateError")),
      });
      gallery.refresh();
    } else if (folderDialog.mode === "merge") {
      const approved = await confirm({
        title: t("folderMergeTitle"),
        message: t("folderMergeConfirm", {
          name: toFolderDialogValue(folderDialog.sourcePath ?? gallery.selectedSubfolder),
          target: path,
        }),
        tone: "warning",
        confirmLabel: t("sidebarMergeFolder"),
        cancelLabel: t("libraryCancel"),
      });
      if (!approved) {
        return;
      }

      await runOperation(() => gallery.mergeFolder(folderDialog.sourcePath ?? gallery.selectedSubfolder, path), {
        pending: t("operationMergeFolder"),
        success: t("folderMergeSuccess"),
        error: (error) => (error instanceof Error ? error.message : t("folderMergeError")),
      });
    } else if (folderDialog.sourcePath) {
      const sourcePath = folderDialog.sourcePath;
      const approved = await confirm({
        title: t("folderRenameTitle"),
        message: t("folderRenameConfirm", {
          name: toFolderDialogValue(sourcePath),
          target: path,
        }),
        tone: "warning",
        confirmLabel: t("folderRename"),
        cancelLabel: t("libraryCancel"),
      });
      if (!approved) {
        return;
      }

      await runOperation(() => gallery.renameFolder(sourcePath, path), {
        pending: t("operationRenameFolder"),
        success: t("folderRenameSuccess"),
        error: (error) => (error instanceof Error ? error.message : t("folderRenameError")),
      });
    }
  };

  const handleDeleteFolder = async (path = gallery.selectedSubfolder) => {
    if (!path) {
      return;
    }
    const approved = await confirm({
      title: t("commonDelete"),
      message: t("folderDeleteConfirm", { name: toFolderDialogValue(path) }),
      tone: path.includes("/") ? "warning" : "danger",
      confirmLabel: t("commonDelete"),
      cancelLabel: t("libraryCancel"),
    });
    if (!approved) {
      return;
    }

    await runOperation(() => gallery.deleteFolder(path), {
      pending: t("operationDeleteFolder"),
      success: t("folderDeleteSuccess"),
      error: (error) => (error instanceof Error ? error.message : t("folderDeleteError")),
    }).catch(() => undefined);
  };

  const handleMergeFolder = (path = gallery.selectedSubfolder) => {
    if (!path) {
      return;
    }
    setFolderDialog({ mode: "merge", initialValue: "", sourcePath: path });
  };

  const handleRenameFolder = (path: string) => {
    if (!path) {
      return;
    }
    setFolderDialog({ mode: "rename", initialValue: toFolderDialogValue(path), sourcePath: path });
  };

  const handleMoveFolder = async (sourcePath: string, targetPath: string) => {
    if (!sourcePath || !targetPath) {
      return;
    }
    const sourceName = getFolderBaseName(sourcePath) || toFolderDialogValue(sourcePath);
    const approved = await confirm({
      title: t("folderMoveTitle"),
      message: t("folderMoveConfirm", {
        name: sourceName,
        target: toFolderDialogValue(targetPath),
      }),
      tone: "warning",
      confirmLabel: t("folderMove"),
      cancelLabel: t("libraryCancel"),
    });
    if (!approved) {
      return;
    }

    await runOperation(() => gallery.renameFolder(sourcePath, targetPath), {
      pending: t("operationMoveFolder"),
      success: t("folderMoveSuccess"),
      error: (error) => (error instanceof Error ? error.message : t("folderMoveError")),
    }).catch(() => undefined);
  };

  const handleWorkbenchLibrarySelect = async (name: string) => {
    try {
      await library.openLibrary(name);
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t("errorOpenLibrary"), "error");
    }
  };

  const handleImportFiles = async (files: File[], targetSourceId = "") => {
    if (!files.length) {
      return;
    }
    const targetSource = gallery.context?.sources.find((source) => source.id === targetSourceId);
    const approved = await confirm({
      title: t("galleryImportConfirmTitle"),
      message: t("galleryImportConfirm", {
        count: files.length,
        target: targetSource?.name || targetSourceId || t("galleryOutputFolder"),
      }),
      tone: "info",
      confirmLabel: t("libraryImport"),
      cancelLabel: t("libraryCancel"),
    });
    if (!approved) {
      return;
    }

    const response = await runOperation(() => gallery.importFiles(files, targetSourceId), {
      pending: t("operationImportFiles"),
      success: (result) => t("galleryImportSuccess", { count: result.imported_images.length + result.imported_libraries.length }),
      error: (error) => (error instanceof Error ? error.message : t("errorImportLibrary")),
    });
    await library.refreshLibraries();
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
    await runOperation(() => gallery.renameImage(relativePath, newFilename), {
      pending: t("operationRenameImage"),
      success: t("modalRenameFile"),
      error: (error) => (error instanceof Error ? error.message : t("imageRenameError")),
    }).catch(() => undefined);
  };

  const handleDeleteSingleImage = async (relativePath: string) => {
    await runOperation(() => gallery.deleteImages([relativePath]), {
      pending: t("operationDeleteImage"),
      success: t("imageDelete"),
      error: (error) => (error instanceof Error ? error.message : t("imageDeleteError")),
    }).catch(() => undefined);
  };

  const handleOpenImageWorkflow = async (image: { relative_path: string; original_url?: string; url?: string }) => {
    const approved = await confirm({
      title: t("modalOpenWorkflow"),
      message: t("workflowSendConfirm", { name: image.relative_path }),
      tone: "warning",
      confirmLabel: t("commonSend"),
      cancelLabel: t("libraryCancel"),
    });
    if (!approved) {
      return;
    }

    await runOperation(async () => {
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
        throw new Error(t("modalNoMetadata"));
      }

      clearPendingWorkflowPayload();
      const sentToExistingPage = await trySendWorkflowToExistingComfyPage(payload);

      if (!sentToExistingPage) {
        storeUndeliveredWorkflowPayload(payload);
        throw new Error(t("workflowNoComfyPage"));
      }
      clearPendingWorkflowPayload();

    }, {
      pending: t("operationSendWorkflow"),
      success: t("workflowSendSuccess"),
      error: (error) => (error instanceof Error ? error.message : t("modalNoMetadata")),
    }).catch(() => undefined);
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
    gallerySelectionModeActive &&
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
          onMoveFolder={handleMoveFolder}
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
              hasPendingLiveRefresh={gallery.hasPendingLiveRefresh}
              error={gallery.error}
              boards={gallery.boards}
              defaultSelectionMode={uiPreferences.defaultSelectionMode}
              enableImagePrefetch={uiPreferences.enableImagePrefetch}
              onSelectionModeActiveChange={setGallerySelectionModeActive}
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
              onMoveImages={gallery.moveImages}
              onImportFiles={handleImportFiles}
              onApplyPendingLiveRefresh={gallery.refresh}
              onRestoreTrashItem={async (id) => {
                const approved = await confirm({
                  title: t("trashRestore"),
                  message: t("trashRestoreConfirm"),
                  tone: "warning",
                  confirmLabel: t("trashRestore"),
                  cancelLabel: t("libraryCancel"),
                });
                if (!approved) return;
                await runOperation(() => gallery.restoreTrashItem(id), {
                  pending: t("operationRestoreTrash"),
                  success: t("trashRestore"),
                });
              }}
              onRestoreTrashItems={async (ids) => {
                await runOperation(async () => {
                  for (const id of ids) {
                    await gallery.restoreTrashItem(id);
                  }
                }, {
                  pending: t("operationRestoreTrash"),
                  success: t("trashRestoreSelectedSuccess", { count: ids.length }),
                });
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
                await runOperation(() => gallery.purgeTrashItem(id), {
                  pending: t("operationPurgeTrash"),
                  success: t("trashDeleteForever"),
                });
              }}
              onPurgeTrashItems={async (ids) => {
                await runOperation(async () => {
                  for (const id of ids) {
                    await gallery.purgeTrashItem(id);
                  }
                }, {
                  pending: t("operationPurgeTrash"),
                  success: t("trashDeleteSelectedSuccess", { count: ids.length }),
                });
              }}
            />
          ) : activeTab === "library" ? (
            <Suspense fallback={<div className="ue-gallery-state"><div className="ue-loading-orb" /><p>{t("galleryLoading")}</p></div>}>
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
                  const approved = await confirm({
                    title: t("libraryImportConfirmTitle"),
                    message:
                      mode === "create"
                        ? t("libraryImportCreateConfirm", { name: newName || file.name })
                        : mode === "replace"
                          ? t("libraryImportReplaceConfirm", { name: targetName })
                          : t("libraryImportMergeConfirm", { name: targetName }),
                    tone: mode === "replace" ? "danger" : "warning",
                    confirmLabel: t("libraryImportConfirm"),
                    cancelLabel: t("libraryCancel"),
                  });
                  if (!approved) {
                    return false;
                  }

                  const result = await runOperation(async () => {
                    const value = await library.importLibrary(file, mode, targetName, newName);
                    if (!value.ok && value.message) {
                      throw new Error(value.message);
                    }
                    return value;
                  }, {
                    pending: t("operationImportLibrary"),
                    success: t("libraryImportSuccess", { count: library.entryTotal, name: targetName || newName || file.name }),
                    error: (error) => (error instanceof Error ? error.message : t("errorImportLibrary")),
                  }).catch(() => ({ ok: false, message: "" }));
                  return result.ok;
                }}
                onSaveEntry={async (index, entry) => {
                  const approved = await confirm({
                    title: t("librarySaveEntryConfirmTitle"),
                    message: t("librarySaveEntryConfirm"),
                    tone: "warning",
                    confirmLabel: t("librarySave"),
                    cancelLabel: t("libraryCancel"),
                  });
                  if (!approved) {
                    return false;
                  }

                  const result = await runOperation(async () => {
                    const value = await library.saveEntry(index, entry);
                    if (!value.ok && value.message) {
                      throw new Error(value.message);
                    }
                    return value;
                  }, {
                    pending: t("operationSaveLibrary"),
                    success: t("librarySaveSuccess", { count: library.entryTotal }),
                    error: (error) => (error instanceof Error ? error.message : t("errorSaveLibrary")),
                  }).catch(() => ({ ok: false, message: "" }));
                  return result.ok;
                }}
                onDeleteEntry={async (index) => {
                  const result = await runOperation(async () => {
                    const value = await library.removeEntry(index);
                    if (!value.ok && value.message) {
                      throw new Error(value.message);
                    }
                    return value;
                  }, {
                    pending: t("operationDeleteLibrary"),
                    success: t("commonDelete"),
                    error: (error) => (error instanceof Error ? error.message : t("errorDeleteLibrary")),
                  }).catch(() => ({ ok: false, message: "" }));
                  return result.ok;
                }}
              />
            </Suspense>
          ) : activeTab === "workbench" ? (
            <Suspense fallback={<div className="ue-gallery-state"><div className="ue-loading-orb" /><p>{t("galleryLoading")}</p></div>}>
              <WorkbenchWorkspace
                libraries={library.libraries}
                activeLibraryName={library.activeLibraryName}
                onLibrarySelect={handleWorkbenchLibrarySelect}
              />
            </Suspense>
          ) : (
            <Suspense fallback={<div className="ue-gallery-state"><div className="ue-loading-orb" /><p>{t("galleryLoading")}</p></div>}>
              <SettingsWorkspace
                sources={gallery.context?.sources ?? []}
                preferences={uiPreferences}
                onPreferencesChange={updateUiPreferences}
                onSourcesChange={() => gallery.refresh()}
                onRestartOnboarding={() => setOnboardingOpen(true)}
              />
            </Suspense>
          )}
        </main>

        {galleryInspectorOpen ? (
          <div className="ue-gallery-inspector-layer">
            <GalleryInspectorPanel
              selectedPaths={selectedGalleryImages.map((image) => image.relative_path)}
              selectedSubfolder={gallery.selectedSubfolder}
              selectedBoard={selectedGalleryBoard}
              boards={gallery.boards}
              page={gallery.page}
              targetFolderOptions={gallery.targetFolderOptions}
              onClose={() => gallery.setSelectedImagePaths([])}
              onBatchUpdateImages={gallery.batchUpdateImages}
              onCreateBoard={gallery.createBoard}
              onUpdateBoardPins={gallery.updateBoardPins}
              onMoveImages={gallery.moveImages}
              onBatchRenameImages={async (relativePaths, template, startNumber, padding, currentPage) => {
                return runOperation(() => gallery.batchRenameImages(relativePaths, template, startNumber, padding, currentPage), {
                  pending: t("operationRenameImages"),
                  success: (result) => t("bulkRenameSuccess", { count: result.renamed.length }),
                  error: (error) => (error instanceof Error ? error.message : t("bulkRenameError")),
                });
              }}
              onDeleteImages={gallery.deleteImages}
            />
          </div>
        ) : null}
      </div>

      {gallery.selectedImage ? (
        <Suspense fallback={null}>
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
        </Suspense>
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
      <OnboardingTour
        open={onboardingOpen}
        onRequestTabChange={(tab) => {
          void handleTabChange(tab);
        }}
        onRequestSidebarOpen={() => setSidebarCollapsed(false)}
        onSkip={closeOnboardingTour}
        onComplete={closeOnboardingTour}
      />
    </div>
  );
}

export default App;
