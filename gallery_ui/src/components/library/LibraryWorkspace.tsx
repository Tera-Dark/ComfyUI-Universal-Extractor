import { useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Boxes,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileJson,
  FilePlus2,
  FileUp,
  PencilLine,
  RefreshCw,
  Save,
  Search,
  Sparkles,
  Tags,
  Trash2,
  WandSparkles,
  X,
} from "lucide-react";

import { useI18n } from "../../i18n/I18nProvider";
import type {
  LibraryImportMode,
  LibraryEntry,
  LibraryInfo,
  LibraryPagedEntry,
  LibraryValidationIssue,
} from "../../types/universal-gallery";
import { LibraryEntryEditorModal } from "./LibraryEntryEditorModal";
import { LibraryImportModal } from "./LibraryImportModal";
import { useConfirm } from "../shared/ConfirmDialog";
import { useToast } from "../shared/ToastViewport";

interface LibraryWorkspaceProps {
  libraries: LibraryInfo[];
  activeLibraryName: string | null;
  entries: LibraryPagedEntry[];
  page: number;
  totalPages: number;
  totalEntries: number;
  editorValue: string;
  isEditing: boolean;
  isDirty: boolean;
  isLoading: boolean;
  isRefreshing: boolean;
  isSubmitting: boolean;
  error: string | null;
  statusMessage: string;
  validationIssues: LibraryValidationIssue[];
  canUseRawEditor: boolean;
  searchTerm: string;
  onSearchClear: () => void;
  onEditorValueChange: (value: string) => void;
  onPageChange: (page: number) => void;
  onStartEditing: () => void;
  onCancelEditing: () => void;
  onFormatEditor: () => void;
  onSaveLibrary: () => void;
  onRefresh: () => void;
  onExportLibrary: () => void;
  onImportLibrary: (file: File, mode: LibraryImportMode, targetName: string, newName: string) => Promise<boolean>;
  onSaveEntry: (index: number | undefined, entry: LibraryEntry) => Promise<boolean>;
  onDeleteEntry: (index: number) => Promise<boolean>;
}

interface EntryTemplate {
  id: string;
  label: string;
  description: string;
  entry: LibraryEntry;
}

const joinLabelArray = (value: string[] | string | undefined) => {
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }
  if (typeof value === "string" && value.trim()) {
    return value
      .split(/[,/]/)
      .map((part) => part.trim())
      .filter(Boolean);
  }
  return [];
};

export const LibraryWorkspace = ({
  libraries,
  activeLibraryName,
  entries,
  page,
  totalPages,
  totalEntries,
  editorValue,
  isEditing,
  isDirty,
  isLoading,
  isRefreshing,
  isSubmitting,
  error,
  statusMessage,
  validationIssues,
  canUseRawEditor,
  searchTerm,
  onSearchClear,
  onEditorValueChange,
  onPageChange,
  onStartEditing,
  onCancelEditing,
  onFormatEditor,
  onSaveLibrary,
  onRefresh,
  onExportLibrary,
  onImportLibrary,
  onSaveEntry,
  onDeleteEntry,
}: LibraryWorkspaceProps) => {
  const { t } = useI18n();
  const { confirm } = useConfirm();
  const { pushToast } = useToast();
  const [showImportModal, setShowImportModal] = useState(false);
  const [pendingImportFile, setPendingImportFile] = useState<File | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [editingEntryIndex, setEditingEntryIndex] = useState<number | null>(null);
  const [editingEntry, setEditingEntry] = useState<LibraryEntry | null>(null);
  const lineNumberRef = useRef<HTMLPreElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const dragDepthRef = useRef(0);

  const lineNumbers = useMemo(() => {
    const count = Math.max(editorValue.split("\n").length, 1);
    return Array.from({ length: count }, (_, index) => index + 1).join("\n");
  }, [editorValue]);

  const entryTemplates = useMemo<EntryTemplate[]>(
    () => [
      {
        id: "artist",
        label: t("libraryTemplateArtist"),
        description: t("libraryTemplateArtistHint"),
        entry: {
          name: "tapioka_(coconuts)",
          title: "Tapioka",
          prompt: "tapioka_(coconuts)",
          other_names: ["tapioka"],
          post_count: 3200,
          tags: ["artist", "soft-light", "anime"],
          model: "Pony / SDXL",
          description: t("libraryTemplateArtistDescription"),
        },
      },
      {
        id: "style",
        label: t("libraryTemplateStyle"),
        description: t("libraryTemplateStyleHint"),
        entry: {
          title: "Dreamy pastel portrait",
          prompt: "pastel lighting, soft bloom, clean lineart, airy composition",
          tags: ["style", "portrait", "pastel"],
          model: "SDXL",
          description: t("libraryTemplateStyleDescription"),
        },
      },
      {
        id: "character",
        label: t("libraryTemplateCharacter"),
        description: t("libraryTemplateCharacterHint"),
        entry: {
          title: "Original sleepy hoodie girl",
          prompt: "sleepy girl, oversized monster hoodie, cross necklace, wink",
          other_names: ["hoodie girl"],
          tags: ["character", "original", "hoodie"],
          description: t("libraryTemplateCharacterDescription"),
        },
      },
    ],
    [t],
  );

  const fieldGuide = useMemo(
    () => [
      { label: "name", value: t("libraryFieldNameHint") },
      { label: "prompt", value: t("libraryFieldPromptHint") },
      { label: "other_names", value: t("libraryFieldAliasHint") },
      { label: "tags", value: t("libraryFieldTagsHint") },
      { label: "model", value: t("libraryFieldModelHint") },
      { label: "description", value: t("libraryFieldDescriptionHint") },
    ],
    [t],
  );

  const quickStartSteps = useMemo(
    () => [
      t("libraryGuideStepOne"),
      t("libraryGuideStepTwo"),
      t("libraryGuideStepThree"),
      t("libraryGuideStepFour"),
    ],
    [t],
  );

  const librarySignals = useMemo(() => {
    const aliasEntries = entries.filter((entry) => joinLabelArray(entry.other_names).length > 0).length;
    const promptEntries = entries.filter((entry) => typeof entry.prompt === "string" && entry.prompt.trim()).length;
    const modelEntries = entries.filter((entry) => typeof entry.model === "string" && entry.model.trim()).length;
    const describedEntries = entries.filter((entry) => typeof entry.description === "string" && entry.description.trim()).length;

    const tagUsage = new Map<string, number>();
    const modelUsage = new Map<string, number>();
    entries.forEach((entry) => {
      joinLabelArray(entry.tags).forEach((tag) => {
        tagUsage.set(tag, (tagUsage.get(tag) ?? 0) + 1);
      });
      if (typeof entry.model === "string" && entry.model.trim()) {
        const normalizedModel = entry.model.trim();
        modelUsage.set(normalizedModel, (modelUsage.get(normalizedModel) ?? 0) + 1);
      }
    });

    const topTags = [...tagUsage.entries()].sort((left, right) => right[1] - left[1]).slice(0, 6);
    const topModels = [...modelUsage.entries()].sort((left, right) => right[1] - left[1]).slice(0, 4);

    return {
      aliasEntries,
      promptEntries,
      modelEntries,
      describedEntries,
      uniqueTags: tagUsage.size,
      topTags,
      topModels,
    };
  }, [entries]);

  const getPrimaryLabel = (entry: LibraryEntry, index: number) =>
    String(entry.title || entry.name || entry.prompt || `${t("libraryDetail")} ${index + 1}`);

  const getSecondaryLabel = (entry: LibraryEntry) => {
    if (typeof entry.prompt === "string" && entry.prompt.trim()) {
      return entry.prompt;
    }
    if (Array.isArray(entry.other_names) && entry.other_names.length) {
      return entry.other_names.slice(0, 4).join(" · ");
    }
    if (typeof entry.other_names === "string" && entry.other_names.trim()) {
      return entry.other_names;
    }
    if (typeof entry.description === "string" && entry.description.trim()) {
      return entry.description;
    }
    return "";
  };

  const copyText = async (value: string, successMessage: string) => {
    try {
      await navigator.clipboard.writeText(value);
      pushToast(successMessage, "success");
    } catch {
      pushToast(t("contextCopyError"), "error");
    }
  };

  const prepareImportFile = async (file: File | null) => {
    if (!file) {
      return;
    }
    const isJson = file.name.toLowerCase().endsWith(".json") || file.type.includes("json");
    if (!isJson) {
      pushToast(t("errorImportLibrary"), "error");
      return;
    }

    const approved = await confirm({
      title: t("libraryImport"),
      message: t("libraryImportConfirmAsk", { name: file.name }),
      tone: "info",
      confirmLabel: t("libraryImport"),
      cancelLabel: t("libraryCancel"),
    });
    if (!approved) {
      return;
    }

    setPendingImportFile(file);
    setShowImportModal(true);
  };

  const openEntryEditor = (entry: LibraryEntry | null, index: number | null = null) => {
    setEditingEntryIndex(index);
    setEditingEntry(entry);
  };

  const handleDeleteEntry = async (sourceIndex: number) => {
    const approved = await confirm({
      title: t("commonDelete"),
      message: t("libraryDeleteEntryConfirm"),
      tone: "warning",
      confirmLabel: t("commonDelete"),
      cancelLabel: t("libraryCancel"),
    });
    if (!approved) {
      return;
    }

    const ok = await onDeleteEntry(sourceIndex);
    if (ok) {
      pushToast(t("commonDelete"), "success");
    }
  };

  return (
    <>
      <section
        className={`ue-workspace ue-animate-in ${dragActive ? "is-dragging-library" : ""}`}
        onDragEnter={(event) => {
          event.preventDefault();
          dragDepthRef.current += 1;
          setDragActive(true);
        }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={(event) => {
          event.preventDefault();
          dragDepthRef.current -= 1;
          if (dragDepthRef.current <= 0) {
            dragDepthRef.current = 0;
            setDragActive(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          dragDepthRef.current = 0;
          setDragActive(false);
          const file = event.dataTransfer.files?.[0] ?? null;
          void prepareImportFile(file);
        }}
      >
        <div className="ue-pane-header">
          <div className="ue-pane-copy">
            <p className="ue-pane-kicker">{t("sidebarLibraries")}</p>
            <h2>{activeLibraryName || t("librarySelectTitle")}</h2>
            <p>
              {activeLibraryName
                ? t("libraryWorkspaceSubtitle", {
                    count: totalEntries,
                    name: activeLibraryName,
                  })
                : t("librarySelectText")}
            </p>
          </div>

          <div className="ue-library-actions">
            <input
              ref={fileInputRef}
              className="ue-hidden-input"
              type="file"
              accept=".json,application/json"
              onChange={(event) => void prepareImportFile(event.target.files?.[0] ?? null)}
            />
            <button
              className="ue-icon-action"
              onClick={() => fileInputRef.current?.click()}
              aria-label={t("libraryAddFile")}
              title={t("libraryAddFile")}
            >
              <FileUp size={14} />
            </button>
            <button
              className="ue-icon-action"
              onClick={() => {
                setPendingImportFile(null);
                setShowImportModal(true);
              }}
              aria-label={t("libraryImport")}
              title={t("libraryImport")}
            >
              <Download size={14} />
            </button>
            <button className="ue-icon-action" onClick={onRefresh} aria-label={t("navRefresh")} title={t("navRefresh")}>
              <RefreshCw size={14} />
            </button>
            <button
              className="ue-icon-action"
              onClick={onExportLibrary}
              disabled={!activeLibraryName}
              aria-label={t("libraryExport")}
              title={t("libraryExport")}
            >
              <Download size={14} />
            </button>
            <button
              className="ue-icon-action"
              onClick={() => openEntryEditor(entryTemplates[0].entry, null)}
              disabled={!activeLibraryName}
              aria-label={t("libraryStarterTemplate")}
              title={t("libraryStarterTemplate")}
            >
              <Sparkles size={14} />
            </button>
            <button
              className="ue-icon-action"
              onClick={() => openEntryEditor({}, null)}
              disabled={!activeLibraryName}
              aria-label={t("libraryAddEntry")}
              title={t("libraryAddEntry")}
            >
              <FilePlus2 size={14} />
            </button>

            {isEditing && canUseRawEditor ? (
              <>
                <button
                  className="ue-icon-action"
                  onClick={onFormatEditor}
                  aria-label={t("libraryFormat")}
                  title={t("libraryFormat")}
                >
                  <WandSparkles size={14} />
                </button>
                <button
                  className="ue-icon-action ue-icon-action--filled"
                  onClick={onSaveLibrary}
                  disabled={isSubmitting}
                  aria-label={t("librarySave")}
                  title={t("librarySave")}
                >
                  <Save size={14} />
                </button>
                <button
                  className="ue-icon-action"
                  onClick={onCancelEditing}
                  aria-label={t("libraryCancel")}
                  title={t("libraryCancel")}
                >
                  <X size={14} />
                </button>
              </>
            ) : canUseRawEditor ? (
              <button
                className="ue-icon-action"
                onClick={onStartEditing}
                disabled={!activeLibraryName}
                aria-label={t("libraryEdit")}
                title={t("libraryEdit")}
              >
                <PencilLine size={14} />
              </button>
            ) : (
              <span className="ue-editor-status">{t("libraryLargeEditHint")}</span>
            )}
          </div>
        </div>

        {isEditing ? (
          <div className="ue-editor-meta">
            <span className={`ue-editor-status ${isDirty ? "is-dirty" : ""}`}>
              {isDirty ? t("libraryUnsavedChanges") : t("librarySavedState")}
            </span>
            {isRefreshing ? <span className="ue-editor-status">{t("commonLoading")}</span> : null}
          </div>
        ) : null}

        {statusMessage ? <div className="ue-inline-success">{statusMessage}</div> : null}
        {error ? <div className="ue-inline-error">{error}</div> : null}

        {validationIssues.length > 0 ? (
          <div className="ue-validation-panel">
            <strong>{t("libraryValidationTitle")}</strong>
            <div className="ue-validation-list">
              {validationIssues.map((issue, index) => (
                <p key={`${issue.index}-${issue.field}-${index}`}>
                  {issue.index !== null ? `#${issue.index + 1}` : t("libraryValidationGlobal")} · {issue.message}
                </p>
              ))}
            </div>
          </div>
        ) : null}

        {!activeLibraryName ? (
          <div className="ue-gallery-state ue-gallery-state--empty">
            <FileJson size={38} strokeWidth={1.1} />
            <div>
              <h3>{t("librarySelectTitle")}</h3>
              <p>{t("librarySelectText")}</p>
            </div>
          </div>
        ) : (
          <>
            <div className="ue-library-overview-grid">
              <article className="ue-library-overview-card">
                <span>{t("libraryOverviewEntries")}</span>
                <strong>{totalEntries}</strong>
                <p>{t("libraryOverviewEntriesHint")}</p>
              </article>
              <article className="ue-library-overview-card">
                <span>{t("libraryOverviewAliases")}</span>
                <strong>{librarySignals.aliasEntries}</strong>
                <p>{t("libraryOverviewAliasesHint")}</p>
              </article>
              <article className="ue-library-overview-card">
                <span>{t("libraryOverviewTags")}</span>
                <strong>{librarySignals.uniqueTags}</strong>
                <p>{t("libraryOverviewTagsHint")}</p>
              </article>
              <article className="ue-library-overview-card">
                <span>{t("libraryOverviewModels")}</span>
                <strong>{librarySignals.modelEntries}</strong>
                <p>{t("libraryOverviewModelsHint")}</p>
              </article>
            </div>

            <div className="ue-library-guidance-grid">
              <article className="ue-library-guide-card">
                <div className="ue-library-guide-head">
                  <Sparkles size={16} />
                  <strong>{t("libraryGuideTitle")}</strong>
                </div>
                <div className="ue-library-guide-steps">
                  {quickStartSteps.map((step, index) => (
                    <div key={`${step}-${index}`} className="ue-library-guide-step">
                      <span>{index + 1}</span>
                      <p>{step}</p>
                    </div>
                  ))}
                </div>
              </article>

              <article className="ue-library-guide-card">
                <div className="ue-library-guide-head">
                  <Boxes size={16} />
                  <strong>{t("libraryFieldGuideTitle")}</strong>
                </div>
                <div className="ue-library-guide-fields">
                  {fieldGuide.map((item) => (
                    <div key={item.label} className="ue-library-guide-field">
                      <span>{item.label}</span>
                      <p>{item.value}</p>
                    </div>
                  ))}
                </div>
              </article>
            </div>

            <div className="ue-library-search-summary">
              <div className="ue-library-search-copy">
                <div className="ue-library-guide-head">
                  <Search size={15} />
                  <strong>
                    {searchTerm.trim()
                      ? t("librarySearchActive", { name: searchTerm })
                      : t("librarySearchReady")}
                  </strong>
                </div>
                <p>{t("librarySearchHint")}</p>
              </div>
              {searchTerm.trim() ? (
                <button
                  className="ue-icon-action"
                  onClick={onSearchClear}
                  aria-label={t("librarySearchClear")}
                  title={t("librarySearchClear")}
                >
                  <X size={14} />
                </button>
              ) : null}
            </div>

            {librarySignals.topTags.length || librarySignals.topModels.length ? (
              <div className="ue-library-signal-grid">
                <article className="ue-library-signal-card">
                  <div className="ue-library-guide-head">
                    <Tags size={15} />
                    <strong>{t("libraryTopTags")}</strong>
                  </div>
                  <div className="ue-library-token-list">
                    {librarySignals.topTags.length ? (
                      librarySignals.topTags.map(([tag, count]) => (
                        <span key={`${tag}-${count}`} className="ue-library-token">
                          {tag} · {count}
                        </span>
                      ))
                    ) : (
                      <span className="ue-library-token ue-library-token--muted">{t("libraryNoTagsYet")}</span>
                    )}
                  </div>
                </article>

                <article className="ue-library-signal-card">
                  <div className="ue-library-guide-head">
                    <BookOpen size={15} />
                    <strong>{t("libraryTopModels")}</strong>
                  </div>
                  <div className="ue-library-token-list">
                    {librarySignals.topModels.length ? (
                      librarySignals.topModels.map(([model, count]) => (
                        <span key={`${model}-${count}`} className="ue-library-token">
                          {model} · {count}
                        </span>
                      ))
                    ) : (
                      <span className="ue-library-token ue-library-token--muted">{t("libraryNoModelsYet")}</span>
                    )}
                  </div>
                </article>
              </div>
            ) : null}
          </>
        )}

        {!activeLibraryName ? null : isLoading && entries.length === 0 ? (
          <div className="ue-gallery-state">
            <div className="ue-loading-orb" />
            <p>{t("libraryLoading")}</p>
          </div>
        ) : isEditing ? (
          <div className="ue-json-shell">
            <pre className="ue-json-gutter" ref={lineNumberRef} aria-hidden="true">
              {lineNumbers}
            </pre>
            <textarea
              className="ue-json-editor"
              value={editorValue}
              onChange={(event) => onEditorValueChange(event.target.value)}
              onScroll={(event) => {
                if (lineNumberRef.current) {
                  lineNumberRef.current.scrollTop = event.currentTarget.scrollTop;
                }
              }}
            />
          </div>
        ) : activeLibraryName && entries.length === 0 ? (
          <div className="ue-gallery-state ue-gallery-state--empty">
            <BookOpen size={38} strokeWidth={1.1} />
            <div>
              <h3>{t("libraryEmptyTitle")}</h3>
              <p>{t("libraryEmptyText")}</p>
            </div>
          </div>
        ) : activeLibraryName ? (
          <div className="ue-library-listing">
            {entries.map((entry, index) => {
              const absoluteIndex = entry.source_index;
              const secondary = getSecondaryLabel(entry);
              const aliases = joinLabelArray(entry.other_names);
              const tags = joinLabelArray(entry.tags);
              const promptCopyValue = String(entry.prompt || entry.name || entry.title || "").trim();

              return (
                <article key={`${activeLibraryName}-${entry.source_index}-${index}`} className="ue-library-row">
                  <div className="ue-library-row-index">#{String(absoluteIndex + 1).padStart(2, "0")}</div>
                  <div className="ue-library-row-main">
                    <div className="ue-library-row-heading">
                      <h3>{getPrimaryLabel(entry, absoluteIndex)}</h3>
                      <div className="ue-library-inline-chips">
                        {entry.model ? <span className="ue-library-token">{entry.model}</span> : null}
                        {typeof entry.post_count === "number" ? (
                          <span className="ue-library-token">{entry.post_count} posts</span>
                        ) : null}
                        {promptCopyValue ? <span className="ue-library-token">{t("libraryReadyToCopy")}</span> : null}
                      </div>
                    </div>

                    {secondary ? <p className="ue-library-row-preview">{secondary}</p> : null}
                    {aliases.length ? (
                      <div className="ue-library-inline-chips">
                        {aliases.slice(0, 6).map((alias) => (
                          <span key={`${entry.source_index}-${alias}`} className="ue-library-token ue-library-token--soft">
                            {alias}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {tags.length ? (
                      <div className="ue-library-inline-chips">
                        {tags.slice(0, 8).map((tag) => (
                          <span key={`${entry.source_index}-${tag}`} className="ue-library-token ue-library-token--subtle">
                            #{tag}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {entry.description && secondary !== entry.description ? (
                      <p className="ue-library-row-description">{entry.description}</p>
                    ) : null}
                  </div>
                  <div className="ue-library-row-side">
                    <span>{t("libraryEntryStatus", { count: index + 1 })}</span>
                    <div className="ue-library-row-actions">
                      <button
                        className="ue-library-row-action"
                        onClick={() => openEntryEditor(entry, absoluteIndex)}
                        aria-label={t("libraryEdit")}
                        title={t("libraryEdit")}
                      >
                        <PencilLine size={13} />
                      </button>
                      <button
                        className="ue-library-row-action"
                        onClick={() => void copyText(JSON.stringify(entry, null, 2), t("libraryCopyJsonSuccess"))}
                        aria-label={t("libraryCopyJson")}
                        title={t("libraryCopyJson")}
                      >
                        <FileJson size={13} />
                      </button>
                      <button
                        className="ue-library-row-action"
                        onClick={() => void copyText(promptCopyValue || JSON.stringify(entry, null, 2), t("artistCopyResult"))}
                        aria-label={t("libraryCopyPrompt")}
                        title={t("libraryCopyPrompt")}
                      >
                        <Copy size={13} />
                      </button>
                      <button
                        className="ue-library-row-action ue-library-row-action--danger"
                        onClick={() => void handleDeleteEntry(absoluteIndex)}
                        aria-label={t("commonDelete")}
                        title={t("commonDelete")}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </article>
              );
            })}
            {totalPages > 1 ? (
              <div className="ue-pagination ue-pagination--library">
                <div className="ue-pagination-meta">
                  <span>{t("galleryPage", { page, totalPages })}</span>
                  <i aria-hidden="true">·</i>
                  <span>{t("commonEntries", { count: totalEntries })}</span>
                </div>
                <div className="ue-pagination-actions">
                  <button
                    disabled={page <= 1}
                    onClick={() => onPageChange(Math.max(1, page - 1))}
                    aria-label={t("galleryPrevious")}
                    title={t("galleryPrevious")}
                  >
                    <ChevronLeft size={14} />
                  </button>
                  <button
                    disabled={page >= totalPages}
                    onClick={() => onPageChange(Math.min(totalPages, page + 1))}
                    aria-label={t("galleryNext")}
                    title={t("galleryNext")}
                  >
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {dragActive ? (
          <div className="ue-drop-overlay ue-drop-overlay--inline">
            <div className="ue-drop-overlay-card">
              <h3>{t("libraryDropTitle")}</h3>
              <p>{t("libraryDropText")}</p>
            </div>
          </div>
        ) : null}
      </section>

      <LibraryImportModal
        open={showImportModal}
        libraries={libraries}
        activeLibraryName={activeLibraryName}
        initialFile={pendingImportFile}
        isSubmitting={isSubmitting}
        onClose={() => {
          setShowImportModal(false);
          setPendingImportFile(null);
        }}
        onImport={onImportLibrary}
      />

      <LibraryEntryEditorModal
        key={
          editingEntryIndex !== null
            ? `entry-${editingEntryIndex}`
            : `draft-${editingEntry ? JSON.stringify(editingEntry) : "empty"}`
        }
        open={editingEntry !== null}
        title={
          editingEntryIndex === null
            ? t("libraryAddEntry")
            : `${t("libraryDetail")} #${(editingEntryIndex ?? 0) + 1}`
        }
        initialEntry={editingEntry}
        templates={entryTemplates}
        isSubmitting={isSubmitting}
        onClose={() => {
          setEditingEntryIndex(null);
          setEditingEntry(null);
        }}
        onSave={async (entry) => onSaveEntry(editingEntryIndex ?? undefined, entry)}
        onDelete={
          editingEntryIndex !== null
            ? async () => {
                const approved = await confirm({
                  title: t("commonDelete"),
                  message: t("libraryDeleteEntryConfirm"),
                  tone: "warning",
                  confirmLabel: t("commonDelete"),
                  cancelLabel: t("libraryCancel"),
                });
                if (!approved) {
                  return false;
                }
                return onDeleteEntry(editingEntryIndex);
              }
            : undefined
        }
      />
    </>
  );
};
