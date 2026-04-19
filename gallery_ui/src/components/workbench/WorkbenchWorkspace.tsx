import { useEffect, useMemo, useState } from "react";
import { Copy, Plus, Sparkles, Wand2, X } from "lucide-react";

import { useToast } from "../shared/ToastViewport";
import { useI18n } from "../../i18n/I18nProvider";
import { galleryApi } from "../../services/galleryApi";
import type { LibraryInfo } from "../../types/universal-gallery";

interface WorkbenchWorkspaceProps {
  libraries: LibraryInfo[];
  activeLibraryName: string | null;
  onLibrarySelect: (name: string) => Promise<void>;
}

type GeneratorMode = "pure" | "standard" | "creative" | "nai";
type FilterMode = "none" | "gt" | "lt";
type BracketStyle = "paren" | "curly" | "square";
type FormatToolMode = "anima" | "custom";

const LS_KEY = "ue-artist-generator-v2";

interface ArtistCandidate {
  name: string;
  other_names?: string[] | string;
  post_count?: number;
}

const stripOuterWrappers = (value: string) => {
  const pairs: Record<string, string> = {
    "[": "]",
    "(": ")",
    "{": "}",
  };

  let current = value.trim();
  while (current.length > 1) {
    const opening = current[0];
    const closing = current[current.length - 1];
    if (pairs[opening] !== closing) {
      break;
    }
    current = current.slice(1, -1).trim();
  }
  return current;
};

const cleanArtistTag = (tag: string) =>
  stripOuterWrappers(tag)
    .replace(/^\d+(\.\d+)?::/, "")
    .replace(/::$/, "")
    .replace(/:\d+(\.\d+)?$/, "")
    .replace(/^artist:/i, "")
    .replace(/^by\s+/i, "")
    .trim();

const normalizeArtistWords = (value: string) => value.replace(/_/g, " ").replace(/\s+/g, " ").trim();

const normalizeAnimaTag = (tag: string) => {
  const trimmed = cleanArtistTag(tag).replace(/^@+/, "");
  const bracketMatch = trimmed.match(/^(.+?)_\((.+)\)$/) ?? trimmed.match(/^(.+?)\((.+)\)$/);
  if (bracketMatch) {
    const outer = normalizeArtistWords(bracketMatch[1].replace(/_+$/g, "").trim());
    const inner = normalizeArtistWords(bracketMatch[2].trim());
    return `@${outer} \\(${inner}\\)`;
  }

  return `@${normalizeArtistWords(trimmed)}`;
};

export const WorkbenchWorkspace = ({
  libraries,
  activeLibraryName,
  onLibrarySelect,
}: WorkbenchWorkspaceProps) => {
  const { t } = useI18n();
  const { pushToast } = useToast();

  const [selectedLibrary, setSelectedLibrary] = useState<string>("");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<GeneratorMode>("standard");
  const [artistCount, setArtistCount] = useState(3);
  const [finalResult, setFinalResult] = useState("");
  const [preselectedNames, setPreselectedNames] = useState<string[]>([]);

  const [postCountFilterMode, setPostCountFilterMode] = useState<FilterMode>("none");
  const [postCountThreshold, setPostCountThreshold] = useState(0);
  const [creativeBracketStyle, setCreativeBracketStyle] = useState<BracketStyle>("paren");
  const [creativeNestLevels, setCreativeNestLevels] = useState(0);
  const [standardWeightMin, setStandardWeightMin] = useState(0.5);
  const [standardWeightMax, setStandardWeightMax] = useState(1.5);
  const [naiWeightMin, setNaiWeightMin] = useState(0.5);
  const [naiWeightMax, setNaiWeightMax] = useState(1.5);
  const [enableCustomFormat, setEnableCustomFormat] = useState(false);
  const [customFormatString, setCustomFormatString] = useState("artist:{name}");
  const [formatToolMode, setFormatToolMode] = useState<FormatToolMode>("anima");
  const [customFormatToolString, setCustomFormatToolString] = useState("@{tag},");
  const [formattedOutput, setFormattedOutput] = useState("");
  const [previewCandidates, setPreviewCandidates] = useState<ArtistCandidate[]>([]);
  const [previewTotal, setPreviewTotal] = useState(0);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  const preferredLibrary = useMemo(() => {
    return (
      libraries.find((library) => library.filename.toLowerCase().includes("artists"))?.filename ??
      libraries[0]?.filename ??
      ""
    );
  }, [libraries]);

  useEffect(() => {
    if (!selectedLibrary && preferredLibrary) {
      setSelectedLibrary(preferredLibrary);
    }
  }, [preferredLibrary, selectedLibrary]);

  useEffect(() => {
    if (selectedLibrary && selectedLibrary !== activeLibraryName) {
      void onLibrarySelect(selectedLibrary);
    }
  }, [selectedLibrary, activeLibraryName, onLibrarySelect]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(LS_KEY);
      if (!raw) return;
      const stored = JSON.parse(raw) as Record<string, unknown>;
      if (typeof stored.mode === "string") setMode(stored.mode as GeneratorMode);
      if (typeof stored.artistCount === "number") setArtistCount(stored.artistCount);
      if (typeof stored.postCountFilterMode === "string") setPostCountFilterMode(stored.postCountFilterMode as FilterMode);
      if (typeof stored.postCountThreshold === "number") setPostCountThreshold(stored.postCountThreshold);
      if (typeof stored.creativeBracketStyle === "string") setCreativeBracketStyle(stored.creativeBracketStyle as BracketStyle);
      if (typeof stored.creativeNestLevels === "number") setCreativeNestLevels(stored.creativeNestLevels);
      if (typeof stored.standardWeightMin === "number") setStandardWeightMin(stored.standardWeightMin);
      if (typeof stored.standardWeightMax === "number") setStandardWeightMax(stored.standardWeightMax);
      if (typeof stored.naiWeightMin === "number") setNaiWeightMin(stored.naiWeightMin);
      if (typeof stored.naiWeightMax === "number") setNaiWeightMax(stored.naiWeightMax);
      if (typeof stored.enableCustomFormat === "boolean") setEnableCustomFormat(stored.enableCustomFormat);
      if (typeof stored.customFormatString === "string") setCustomFormatString(stored.customFormatString);
      if (typeof stored.formatToolMode === "string") setFormatToolMode(stored.formatToolMode as FormatToolMode);
      if (typeof stored.customFormatToolString === "string") setCustomFormatToolString(stored.customFormatToolString);
      if (Array.isArray(stored.preselectedNames)) {
        setPreselectedNames(stored.preselectedNames.filter((item): item is string => typeof item === "string"));
      }
      if (typeof stored.finalResult === "string") setFinalResult(stored.finalResult);
      if (typeof stored.formattedOutput === "string") setFormattedOutput(stored.formattedOutput);
    } catch {
      // ignore invalid persisted state
    }
  }, []);

  useEffect(() => {
    const payload = {
      mode,
      artistCount,
      postCountFilterMode,
      postCountThreshold,
      creativeBracketStyle,
      creativeNestLevels,
      standardWeightMin,
      standardWeightMax,
      naiWeightMin,
      naiWeightMax,
      enableCustomFormat,
      customFormatString,
      formatToolMode,
      customFormatToolString,
      preselectedNames,
      finalResult,
      formattedOutput,
    };
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify(payload));
    } catch {
      // ignore persistence issues
    }
  }, [
    mode,
    artistCount,
    postCountFilterMode,
    postCountThreshold,
    creativeBracketStyle,
    creativeNestLevels,
    standardWeightMin,
    standardWeightMax,
    naiWeightMin,
    naiWeightMax,
    enableCustomFormat,
    customFormatString,
    formatToolMode,
    customFormatToolString,
    preselectedNames,
    finalResult,
    formattedOutput,
  ]);

  const applyFormatTool = () => {
    if (!finalResult.trim()) {
      pushToast(t("artistNoLibraries"), "error");
      return;
    }

    const parts = finalResult
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);

    if (formatToolMode === "anima") {
      const result = parts.map((tag) => normalizeAnimaTag(tag)).join(", ");
      setFormattedOutput(result);
      pushToast(t("workbenchFormatApplied"), "success");
      return;
    }

    const template = customFormatToolString || "{tag}";
    const result = parts
      .map((tag) => template.replace(/{tag}/g, cleanArtistTag(tag)).replace(/{anima}/g, normalizeAnimaTag(tag)))
      .join(", ");
    setFormattedOutput(result);
    pushToast(t("workbenchFormatApplied"), "success");
  };

  useEffect(() => {
    if (!selectedLibrary) {
      setPreviewCandidates([]);
      setPreviewTotal(0);
      return;
    }

    let cancelled = false;
    setIsLoadingPreview(true);

    void galleryApi
      .searchLibraryArtists(selectedLibrary, query, postCountFilterMode, postCountThreshold, 12)
      .then((response) => {
        if (cancelled) return;
        setPreviewCandidates((response.data ?? []) as ArtistCandidate[]);
        setPreviewTotal(response.total ?? 0);
      })
      .catch(() => {
        if (cancelled) return;
        setPreviewCandidates([]);
        setPreviewTotal(0);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingPreview(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedLibrary, query, postCountFilterMode, postCountThreshold]);

  const handleGenerate = async () => {
    if (!selectedLibrary) {
      pushToast(t("artistNoLibraries"), "error");
      return;
    }

    try {
      const response = await galleryApi.generateArtistString({
        name: selectedLibrary,
        query,
        count: artistCount,
        mode,
        preselected_names: preselectedNames,
        filter_mode: postCountFilterMode,
        post_threshold: postCountThreshold,
        creative_bracket_style: creativeBracketStyle,
        creative_nest_levels: creativeNestLevels,
        standard_weight_min: standardWeightMin,
        standard_weight_max: standardWeightMax,
        nai_weight_min: naiWeightMin,
        nai_weight_max: naiWeightMax,
        enable_custom_format: enableCustomFormat,
        custom_format_string: customFormatString,
      });

      setFinalResult(response.formatted);
      if (response.names.length < artistCount) {
        pushToast(`${t("artistGenerate")} ${response.names.length}/${artistCount}`, "info");
      } else {
        pushToast(t("workbenchGenerateSuccess"), "success");
      }
    } catch (error) {
      pushToast(error instanceof Error ? error.message : t("artistNoLibraries"), "error");
    }
  };

  const handleCopy = async () => {
    if (!finalResult) return;
    try {
      await navigator.clipboard.writeText(finalResult);
      pushToast(t("artistCopyResult"), "success");
    } catch {
      pushToast(t("workbenchCopyError"), "error");
    }
  };

  return (
    <section className="ue-workspace ue-animate-in">
      <div className="ue-pane-header ue-pane-header--compact">
        <div className="ue-pane-copy">
          <p className="ue-pane-kicker">{t("workbenchTitle")}</p>
          <h2>{t("toolArtistGenerator")}</h2>
          <p>{t("toolArtistGeneratorDesc")}</p>
        </div>
      </div>

      <div className="ue-workbench-grid ue-workbench-grid--expanded">
        <article className="ue-tool-panel ue-tool-panel--generator">
          <div className="ue-tool-panel-head">
            <div className="ue-section-kicker">
              <Sparkles size={14} />
              <span>{t("toolArtistGenerator")}</span>
            </div>
          </div>

          <div className="ue-tool-form">
            <div className="ue-tool-grid ue-tool-grid--wide">
              <label>
                <span>{t("artistLibrarySource")}</span>
                <select value={selectedLibrary} onChange={(event) => setSelectedLibrary(event.target.value)}>
                  {libraries.map((library) => (
                    <option key={library.filename} value={library.filename}>
                      {library.filename}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{t("artistCount")}</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={artistCount}
                  onChange={(event) => setArtistCount(Number(event.target.value) || 1)}
                />
              </label>
              <label>
                <span>{t("workbenchMode")}</span>
                <select value={mode} onChange={(event) => setMode(event.target.value as GeneratorMode)}>
                  <option value="pure">{t("workbenchModePure")}</option>
                  <option value="standard">{t("workbenchModeStandard")}</option>
                  <option value="creative">{t("workbenchModeCreative")}</option>
                  <option value="nai">{t("workbenchModeNai")}</option>
                </select>
              </label>
            </div>

            <div className="ue-tool-grid ue-tool-grid--wide">
              <label>
                <span>{t("workbenchPostFilter")}</span>
                <select value={postCountFilterMode} onChange={(event) => setPostCountFilterMode(event.target.value as FilterMode)}>
                  <option value="none">{t("workbenchFilterNone")}</option>
                  <option value="gt">{t("workbenchFilterGreater")}</option>
                  <option value="lt">{t("workbenchFilterLess")}</option>
                </select>
              </label>
              <label>
                <span>{t("workbenchPostThreshold")}</span>
                <input
                  type="number"
                  min={0}
                  value={postCountThreshold}
                  onChange={(event) => setPostCountThreshold(Number(event.target.value) || 0)}
                />
              </label>
              <label className="ue-toggle-field">
                <span>{t("workbenchCustomFormat")}</span>
                <button
                  className={`ue-chip-toggle ${enableCustomFormat ? "active" : ""}`}
                  onClick={() => setEnableCustomFormat((current) => !current)}
                  type="button"
                >
                  {enableCustomFormat ? t("commonEnabled") : t("commonDisabled")}
                </button>
              </label>
            </div>

            {mode === "standard" ? (
              <div className="ue-tool-grid ue-tool-grid--wide">
                <label>
                  <span>{t("workbenchWeightMin")}</span>
                  <input type="number" min={0} max={2} step={0.1} value={standardWeightMin} onChange={(event) => setStandardWeightMin(Number(event.target.value) || 0)} />
                </label>
                <label>
                  <span>{t("workbenchWeightMax")}</span>
                  <input type="number" min={0} max={2} step={0.1} value={standardWeightMax} onChange={(event) => setStandardWeightMax(Number(event.target.value) || 0)} />
                </label>
              </div>
            ) : null}

            {mode === "nai" ? (
              <div className="ue-tool-grid ue-tool-grid--wide">
                <label>
                  <span>{t("workbenchWeightMin")}</span>
                  <input type="number" min={0} max={2} step={0.1} value={naiWeightMin} onChange={(event) => setNaiWeightMin(Number(event.target.value) || 0)} />
                </label>
                <label>
                  <span>{t("workbenchWeightMax")}</span>
                  <input type="number" min={0} max={2} step={0.1} value={naiWeightMax} onChange={(event) => setNaiWeightMax(Number(event.target.value) || 0)} />
                </label>
              </div>
            ) : null}

            {mode === "creative" ? (
              <div className="ue-tool-grid ue-tool-grid--wide">
                <label>
                  <span>{t("workbenchBracketStyle")}</span>
                  <select value={creativeBracketStyle} onChange={(event) => setCreativeBracketStyle(event.target.value as BracketStyle)}>
                    <option value="paren">( )</option>
                    <option value="curly">{"{ }"}</option>
                    <option value="square">[ ]</option>
                  </select>
                </label>
                <label>
                  <span>{t("workbenchNestLevels")}</span>
                  <input type="number" min={0} max={5} value={creativeNestLevels} onChange={(event) => setCreativeNestLevels(Number(event.target.value) || 0)} />
                </label>
              </div>
            ) : null}

            {enableCustomFormat ? (
              <label>
                <span>{t("workbenchFormatString")}</span>
                <input value={customFormatString} onChange={(event) => setCustomFormatString(event.target.value)} />
              </label>
            ) : null}

            <div className="ue-tool-actions">
              <button className="ue-primary-btn" onClick={() => void handleGenerate()}>
                <Wand2 size={15} />
                <span>{t("artistGenerate")}</span>
              </button>
              <button className="ue-secondary-btn" onClick={() => void handleCopy()} disabled={!finalResult}>
                <Copy size={15} />
                <span>{t("artistCopyResult")}</span>
              </button>
            </div>

            <label>
              <span>{t("artistResult")}</span>
              <textarea
                className="ue-tool-result"
                value={finalResult}
                onChange={(event) => setFinalResult(event.target.value)}
              />
            </label>

            <div className="ue-tool-divider" />

            <div className="ue-tool-grid ue-tool-grid--wide">
              <label>
                <span>{t("workbenchFormatTool")}</span>
                <select value={formatToolMode} onChange={(event) => setFormatToolMode(event.target.value as FormatToolMode)}>
                  <option value="anima">{t("workbenchFormatToolAnima")}</option>
                  <option value="custom">{t("workbenchFormatToolCustom")}</option>
                </select>
              </label>
              {formatToolMode === "custom" ? (
                <label>
                  <span>{t("workbenchFormatToolTemplate")}</span>
                  <input value={customFormatToolString} onChange={(event) => setCustomFormatToolString(event.target.value)} />
                </label>
              ) : (
                <div className="ue-tool-helper ue-tool-helper--inline">{t("workbenchFormatToolAnimaHint")}</div>
              )}
            </div>

            <div className="ue-tool-actions">
              <button className="ue-secondary-btn" onClick={applyFormatTool} disabled={!finalResult}>
                <Sparkles size={14} />
                <span>{t("workbenchFormatToolApply")}</span>
              </button>
              <button className="ue-secondary-btn" onClick={async () => {
                if (!formattedOutput) return;
                try {
                  await navigator.clipboard.writeText(formattedOutput);
                  pushToast(t("artistCopyResult"), "success");
                } catch {
                  pushToast(t("workbenchCopyError"), "error");
                }
              }} disabled={!formattedOutput}>
                <Copy size={14} />
                <span>{t("artistCopyResult")}</span>
              </button>
            </div>

            <label>
              <span>{t("workbenchFormatToolResult")}</span>
              <textarea className="ue-tool-result" value={formattedOutput} readOnly />
            </label>
          </div>
        </article>

        <div className="ue-workbench-stack">
          <article className="ue-tool-panel ue-tool-panel--summary">
            <div className="ue-tool-panel-head">
              <div className="ue-section-kicker">
                <Sparkles size={14} />
                <span>{t("workbenchPreselected")}</span>
              </div>
              <div className="ue-generated-list">
                {preselectedNames.length ? (
                  preselectedNames.map((name, index) => (
                    <div key={`${name}-${index}`} className="ue-generated-chip">
                      <span>{name}</span>
                      <button className="ue-chip-remove" onClick={() => setPreselectedNames((current) => current.filter((_, currentIndex) => currentIndex !== index))}>
                        <X size={12} />
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="ue-tool-helper">{t("workbenchPreselectedEmpty")}</p>
                )}
              </div>
            </div>
          </article>

          <article className="ue-tool-panel ue-tool-panel--placeholder">
            <div className="ue-tool-panel-head">
              <div className="ue-section-kicker">
                <Sparkles size={14} />
                <span>{t("workbenchArtistPool")}</span>
              </div>
              <p>{t("workbenchArtistPoolHint")}</p>
            </div>

            <label>
              <span>{t("navSearchLibraryPlaceholder")}</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>

            <div className="ue-tool-helper">
              {isLoadingPreview ? t("commonLoading") : `${previewTotal} ${t("commonEntries", { count: previewTotal })}`}
            </div>

            <div className="ue-preview-list">
              {previewCandidates.map((candidate) => (
                <article key={candidate.name} className="ue-preview-row">
                  <div className="ue-preview-row-main">
                    <strong>{candidate.name}</strong>
                    {Array.isArray(candidate.other_names) && candidate.other_names.length ? (
                      <span>{candidate.other_names.slice(0, 4).join(" · ")}</span>
                    ) : typeof candidate.other_names === "string" && candidate.other_names.trim() ? (
                      <span>{candidate.other_names}</span>
                    ) : null}
                  </div>
                  <div className="ue-preview-row-side">
                    <span>{candidate.post_count ?? 0}</span>
                    <button
                      className="ue-secondary-btn ue-secondary-btn--tiny"
                      onClick={() => {
                        if (!preselectedNames.includes(candidate.name)) {
                          setPreselectedNames((current) => [...current, candidate.name].slice(0, 20));
                        }
                      }}
                    >
                      <Plus size={13} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          </article>
        </div>
      </div>
    </section>
  );
};
