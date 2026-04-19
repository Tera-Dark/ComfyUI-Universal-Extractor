import { useEffect, useMemo, useState } from "react";
import { FileUp, GitMerge, RefreshCcw, X } from "lucide-react";

import { useI18n } from "../../i18n/I18nProvider";
import type { LibraryImportMode, LibraryInfo } from "../../types/universal-gallery";

interface LibraryImportModalProps {
  open: boolean;
  libraries: LibraryInfo[];
  activeLibraryName: string | null;
  initialFile?: File | null;
  isSubmitting: boolean;
  onClose: () => void;
  onImport: (file: File, mode: LibraryImportMode, targetName: string, newName: string) => Promise<boolean>;
}

const modeOptions: Array<{
  mode: LibraryImportMode;
  icon: typeof FileUp;
}> = [
  { mode: "create", icon: FileUp },
  { mode: "replace", icon: RefreshCcw },
  { mode: "merge", icon: GitMerge },
];

export const LibraryImportModal = ({
  open,
  libraries,
  activeLibraryName,
  initialFile = null,
  isSubmitting,
  onClose,
  onImport,
}: LibraryImportModalProps) => {
  const { t } = useI18n();
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<LibraryImportMode>("create");
  const [targetName, setTargetName] = useState("");
  const [newName, setNewName] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }

    setMode("create");
    setFile(initialFile);
    setTargetName(activeLibraryName || libraries[0]?.filename || "");
    setNewName("");
  }, [activeLibraryName, initialFile, libraries, open]);

  const requiresTarget = mode === "replace" || mode === "merge";
  const canSubmit = useMemo(() => {
    if (!file) {
      return false;
    }
    if (requiresTarget && !targetName.trim()) {
      return false;
    }
    return true;
  }, [file, requiresTarget, targetName]);

  if (!open) {
    return null;
  }

  return (
    <div className="ue-modal-backdrop" onClick={onClose}>
      <div className="ue-library-modal" onClick={(event) => event.stopPropagation()}>
        <button className="ue-modal-close ue-modal-close--light" onClick={onClose} aria-label={t("modalClose")}>
          <X size={18} />
        </button>

        <div className="ue-pane-copy">
          <p className="ue-pane-kicker">{t("libraryImport")}</p>
          <h2>{t("libraryImportTitle")}</h2>
          <p>{t("libraryImportText")}</p>
        </div>

        <div className="ue-import-mode-grid">
          {modeOptions.map(({ mode: value, icon: Icon }) => (
            <button
              key={value}
              className={`ue-import-mode-card ${mode === value ? "active" : ""}`}
              onClick={() => setMode(value)}
            >
              <Icon size={15} />
              <strong>{t(`libraryImportMode${value[0].toUpperCase()}${value.slice(1)}`)}</strong>
            </button>
          ))}
        </div>

        <label className="ue-import-file-field">
          <span>{t("libraryImportFile")}</span>
          <input
            type="file"
            accept=".json,application/json"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
          <em>{file?.name || t("libraryImportFileEmpty")}</em>
        </label>

        {mode === "create" ? (
          <label className="ue-import-text-field">
            <span>{t("libraryImportNewName")}</span>
            <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="artists-new.json" />
          </label>
        ) : (
          <label className="ue-import-text-field">
            <span>{t("libraryImportTarget")}</span>
            <select value={targetName} onChange={(event) => setTargetName(event.target.value)}>
              <option value="">{t("libraryImportChooseTarget")}</option>
              {libraries.map((library) => (
                <option key={library.filename} value={library.filename}>
                  {library.filename}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="ue-library-modal-actions">
          <button className="ue-secondary-btn" onClick={onClose}>
            <span>{t("libraryCancel")}</span>
          </button>
          <button
            className="ue-primary-btn"
            disabled={!canSubmit || isSubmitting}
            onClick={async () => {
              if (!file) {
                return;
              }
              const ok = await onImport(file, mode, targetName, newName);
              if (ok) {
                onClose();
              }
            }}
          >
            <FileUp size={14} />
            <span>{t("libraryImportConfirm")}</span>
          </button>
        </div>
      </div>
    </div>
  );
};
