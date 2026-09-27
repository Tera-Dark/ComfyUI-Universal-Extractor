import { useCallback, useEffect, useRef, useState } from "react";

import { useI18n } from "../i18n/I18nProvider";
import { ApiRequestError, galleryApi } from "../services/galleryApi";
import type {
  LibraryEntry,
  LibraryImportMode,
  LibraryInfo,
  LibraryPagedEntry,
  LibraryValidationIssue,
} from "../types/universal-gallery";

const emptyIssues: LibraryValidationIssue[] = [];

const getValidationIssues = (error: unknown) => {
  if (
    error instanceof ApiRequestError &&
    typeof error.details === "object" &&
    error.details !== null &&
    "validation_errors" in error.details &&
    Array.isArray((error.details as { validation_errors?: unknown }).validation_errors)
  ) {
    return (error.details as { validation_errors: LibraryValidationIssue[] }).validation_errors;
  }

  return emptyIssues;
};

export const useLibraryData = (enabled: boolean) => {
  const { t } = useI18n();
  const [libraries, setLibraries] = useState<LibraryInfo[]>([]);
  const [activeLibraryName, setActiveLibraryName] = useState<string | null>(null);
  const [entries, setEntries] = useState<LibraryPagedEntry[]>([]);
  const [generatorEntries, setGeneratorEntries] = useState<LibraryEntry[]>([]);
  const [editorValue, setEditorValue] = useState("");
  const [savedSnapshot, setSavedSnapshot] = useState("[]");
  const [draftName, setDraftName] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [entryPage, setEntryPage] = useState(1);
  const [entryTotal, setEntryTotal] = useState(0);
  const [entryLimit] = useState(120);
  const [isEditing, setIsEditing] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [validationIssues, setValidationIssues] = useState<LibraryValidationIssue[]>([]);
  const hasLoadedLibrariesRef = useRef(false);
  const entryRequestRef = useRef(0);
  const generatorRequestRef = useRef(0);
  const editorRequestRef = useRef(0);
  const [loadedEntryScope, setLoadedEntryScope] = useState("");
  const loadedEntryScopeRef = useRef("");
  const lastSearchRef = useRef(searchTerm);
  const entryScope = JSON.stringify([activeLibraryName, searchTerm, entryPage]);

  const loadLibraries = useCallback(async () => {
    if (hasLoadedLibrariesRef.current) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
    }
    setError(null);

    try {
      const nextLibraries = await galleryApi.listLibraries();
      setLibraries(nextLibraries);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : t("errorOpenLibrary"));
    } finally {
      hasLoadedLibrariesRef.current = true;
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [t]);

  const loadEntryPage = useCallback(async (name: string, nextSearch: string, nextPage: number) => {
    const requestId = ++entryRequestRef.current;
    const scope = JSON.stringify([name, nextSearch, nextPage]);
    if (loadedEntryScopeRef.current === scope) {
      setIsRefreshing(true);
    } else {
      setIsLoading(true);
      setIsRefreshing(false);
    }
    setError(null);

    try {
      const response = await galleryApi.getLibraryEntries(name, nextSearch, nextPage, entryLimit);
      if (entryRequestRef.current !== requestId) return;
      setEntries(response.data ?? []);
      setEntryTotal(response.total ?? 0);
      setEntryPage(response.page ?? nextPage);
      loadedEntryScopeRef.current = JSON.stringify([name, nextSearch, response.page ?? nextPage]);
      setLoadedEntryScope(loadedEntryScopeRef.current);
    } catch (fetchError) {
      if (entryRequestRef.current !== requestId) return;
      setError(fetchError instanceof Error ? fetchError.message : t("errorOpenLibrary"));
      setEntries([]);
      setEntryTotal(0);
      loadedEntryScopeRef.current = scope;
      setLoadedEntryScope(scope);
      throw fetchError;
    } finally {
      if (entryRequestRef.current === requestId) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
  }, [entryLimit, t]);

  const refreshActiveLibrary = async () => {
    if (!activeLibraryName) {
      return;
    }
    await loadEntryPage(activeLibraryName, searchTerm, entryPage);
  };

  const openLibrary = async (name: string | null) => {
    // Selecting the already-open row is navigation to the same scope, not a
    // reload. Clearing records here would not retrigger the scope-keyed effect.
    if (name === activeLibraryName) return;
    ++entryRequestRef.current;
    ++generatorRequestRef.current;
    ++editorRequestRef.current;
    setEntries([]);
    setEntryTotal(0);
    setIsRefreshing(false);
    setActiveLibraryName(name);
    setError(null);
    setStatusMessage("");
    setValidationIssues([]);
    setGeneratorEntries([]);
    setEntryPage(1);
    setIsEditing(false);
    setEditorValue("");
  };

  const ensureGeneratorEntries = async (name?: string | null) => {
    const targetName = name || activeLibraryName;
    if (!targetName) {
      return [];
    }

    if (generatorEntries.length > 0 && targetName === activeLibraryName) {
      return generatorEntries;
    }

    const requestId = ++generatorRequestRef.current;
    const data = await galleryApi.getLibrary(targetName);
    if (generatorRequestRef.current === requestId) setGeneratorEntries(data);
    return data;
  };

  const startEditing = async () => {
    if (!activeLibraryName) {
      return;
    }

    const requestId = ++editorRequestRef.current;
    setIsRefreshing(true);
    setValidationIssues([]);
    setStatusMessage("");

    try {
      const response = await galleryApi.getLibraryRaw(activeLibraryName);
      if (editorRequestRef.current !== requestId) return;
      setEditorValue(response.text);
      setSavedSnapshot(response.text);
      setIsEditing(true);
    } catch (fetchError) {
      if (editorRequestRef.current === requestId) {
        setError(fetchError instanceof Error ? fetchError.message : t("errorOpenLibrary"));
      }
    } finally {
      if (editorRequestRef.current === requestId) setIsRefreshing(false);
    }
  };

  const cancelEditing = () => {
    setEditorValue("");
    setValidationIssues([]);
    setIsEditing(false);
  };

  const formatEditor = () => {
    try {
      const parsed = JSON.parse(editorValue) as LibraryEntry[];
      setEditorValue(JSON.stringify(parsed, null, 2));
      setValidationIssues([]);
      return { ok: true, message: "" };
    } catch (formatError) {
      const message = formatError instanceof Error ? formatError.message : t("errorJsonInvalid");
      setError(message);
      return { ok: false, message };
    }
  };

  const saveLibrary = async () => {
    if (!activeLibraryName) {
      return { ok: false, message: t("errorNoLibrarySelected") };
    }

    setError(null);
    setStatusMessage("");
    setValidationIssues([]);

    let parsed: LibraryEntry[];
    try {
      parsed = JSON.parse(editorValue) as LibraryEntry[];
    } catch {
      return { ok: false, message: t("errorJsonInvalid") };
    }

    setIsSubmitting(true);
    try {
      const result = await galleryApi.saveLibrary(activeLibraryName, parsed);
      await loadLibraries();
      setSavedSnapshot(JSON.stringify(parsed, null, 2));
      setGeneratorEntries(parsed);
      await loadEntryPage(result.name, searchTerm, 1);
      setActiveLibraryName(result.name);
      setStatusMessage(t("librarySaveSuccess", { count: result.count }));
      return { ok: true, message: "" };
    } catch (saveError) {
      const issues = getValidationIssues(saveError);
      if (issues.length) {
        setValidationIssues(issues);
      }
      return {
        ok: false,
        message: saveError instanceof Error ? saveError.message : t("errorSaveLibrary"),
      };
    } finally {
      setIsSubmitting(false);
    }
  };

  const createLibrary = async () => {
    const trimmed = draftName.trim();
    if (!trimmed) {
      return { ok: false, message: t("errorLibraryNameRequired") };
    }

    setError(null);
    setStatusMessage("");
    setValidationIssues([]);
    setIsSubmitting(true);

    try {
      const nextName = trimmed.endsWith(".json") ? trimmed : `${trimmed}.json`;
      const result = await galleryApi.saveLibrary(nextName, []);
      setDraftName("");
      await loadLibraries();
      setGeneratorEntries([]);
      setActiveLibraryName(result.name);
      await loadEntryPage(result.name, "", 1);
      setStatusMessage(t("libraryCreateSuccess"));
      return { ok: true, message: "" };
    } catch (createError) {
      return {
        ok: false,
        message: createError instanceof Error ? createError.message : t("errorCreateLibrary"),
      };
    } finally {
      setIsSubmitting(false);
    }
  };

  const importLibrary = async (
    file: File,
    mode: LibraryImportMode,
    targetName = "",
    newName = "",
  ) => {
    setError(null);
    setStatusMessage("");
    setValidationIssues([]);
    setIsSubmitting(true);

    try {
      const result = await galleryApi.importLibrary(file, mode, targetName, newName);
      await loadLibraries();
      setGeneratorEntries([]);
      setActiveLibraryName(result.name);
      await loadEntryPage(result.name, "", 1);
      setStatusMessage(t("libraryImportSuccess", { count: result.count, name: result.name }));
      return { ok: true, message: "" };
    } catch (importError) {
      const issues = getValidationIssues(importError);
      if (issues.length) {
        setValidationIssues(issues);
      }
      return {
        ok: false,
        message: importError instanceof Error ? importError.message : t("errorImportLibrary"),
      };
    } finally {
      setIsSubmitting(false);
    }
  };

  const deleteLibrary = async (name: string) => {
    setIsSubmitting(true);
    setError(null);
    setStatusMessage("");
    setValidationIssues([]);

    try {
      await galleryApi.deleteLibrary(name);
      await loadLibraries();
      if (activeLibraryName === name) {
        setActiveLibraryName(null);
        setEntries([]);
        setGeneratorEntries([]);
        setEntryTotal(0);
        setSavedSnapshot("[]");
        setIsEditing(false);
        setEditorValue("");
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const saveEntry = async (sourceIndex: number | undefined, entry: LibraryEntry) => {
    if (!activeLibraryName) {
      return { ok: false, message: t("errorNoLibrarySelected") };
    }

    setIsSubmitting(true);
    setError(null);
    setValidationIssues([]);

    try {
      const result = await galleryApi.saveLibraryEntry(activeLibraryName, entry, sourceIndex);
      await loadEntryPage(activeLibraryName, searchTerm, entryPage);
      setGeneratorEntries([]);
      setStatusMessage(t("librarySaveSuccess", { count: result.count }));
      return { ok: true, message: "" };
    } catch (saveError) {
      const issues = getValidationIssues(saveError);
      if (issues.length) {
        setValidationIssues(issues);
      }
      return {
        ok: false,
        message: saveError instanceof Error ? saveError.message : t("errorSaveLibrary"),
      };
    } finally {
      setIsSubmitting(false);
    }
  };

  const removeEntry = async (sourceIndex: number) => {
    if (!activeLibraryName) {
      return { ok: false, message: t("errorNoLibrarySelected") };
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const result = await galleryApi.deleteLibraryEntry(activeLibraryName, sourceIndex);
      const nextPage = Math.min(entryPage, Math.max(1, Math.ceil(result.count / entryLimit)));
      await loadEntryPage(activeLibraryName, searchTerm, nextPage);
      setGeneratorEntries([]);
      return { ok: true, message: "" };
    } catch (deleteError) {
      return {
        ok: false,
        message: deleteError instanceof Error ? deleteError.message : t("errorDeleteLibrary"),
      };
    } finally {
      setIsSubmitting(false);
    }
  };

  useEffect(() => {
    if (!enabled) {
      return;
    }

    void loadLibraries();
  }, [enabled, loadLibraries]);

  useEffect(() => {
    // Invalidate the previous request before scheduling a new query. A short
    // debounce only applies to typing; library and page switches stay immediate.
    ++entryRequestRef.current;
    const searchChanged = lastSearchRef.current !== searchTerm;
    lastSearchRef.current = searchTerm;
    if (!activeLibraryName || isEditing) return;
    const timer = window.setTimeout(() => {
      void loadEntryPage(activeLibraryName, searchTerm, entryPage).catch(() => undefined);
    }, searchChanged ? 250 : 0);
    const requests = entryRequestRef;
    return () => {
      window.clearTimeout(timer);
      ++requests.current;
    };
  }, [activeLibraryName, searchTerm, entryPage, isEditing, loadEntryPage]);

  const entriesReady = loadedEntryScope === entryScope;
  return {
    libraries,
    activeLibraryName,
    entries: entriesReady ? entries : [],
    generatorEntries,
    editorValue,
    setEditorValue,
    draftName,
    setDraftName,
    searchTerm,
    setSearchTerm,
    entryPage,
    setEntryPage,
    entryTotal: entriesReady ? entryTotal : 0,
    entryLimit,
    isEditing,
    isDirty: isEditing && editorValue !== savedSnapshot,
    isLoading: isLoading || (Boolean(activeLibraryName) && !entriesReady && !isEditing),
    isRefreshing,
    isSubmitting,
    error,
    statusMessage,
    setStatusMessage,
    validationIssues,
    openLibrary,
    refreshActiveLibrary,
    ensureGeneratorEntries,
    startEditing,
    cancelEditing,
    formatEditor,
    saveLibrary,
    createLibrary,
    importLibrary,
    deleteLibrary,
    saveEntry,
    removeEntry,
    refreshLibraries: loadLibraries,
  };
};
