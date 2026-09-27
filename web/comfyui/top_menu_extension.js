import { app } from "../../scripts/app.js";

const BUTTON_LABEL = "Launch Universal Gallery";
const BUTTON_HINT = "Shift+Click opens in new window";
const BUTTON_TOOLTIP = `${BUTTON_LABEL} (${BUTTON_HINT})`;
const GALLERY_PATH = "/gallery/";
const NEW_WINDOW_FEATURES = "width=1280,height=860,resizable=yes,scrollbars=yes,status=yes";
const MAX_ATTACH_ATTEMPTS = 120;
const BUTTON_GROUP_CLASS = "universal-extractor-top-menu-group";
const BUTTON_ATTR = "data-universal-extractor-top-menu";
const PENDING_WORKFLOW_KEY = "universal-extractor:pending-workflow";
const WORKFLOW_CHANNEL_NAME = "universal-extractor-workflow";
const COMFY_WINDOW_NAME = "comfyui-main";
const WORKFLOW_MESSAGE_TYPE = "universal-extractor:workflow-message";
const LORA_STACK_MESSAGE_TYPE = "universal-extractor:lora-stack-message";
const WORKFLOW_PROBE_TYPE = "universal-extractor:workflow-probe";
const WORKFLOW_ACK_TYPE = "universal-extractor:workflow-ack";
const WORKFLOW_DELIVERED_TYPE = "universal-extractor:workflow-delivered";
const LORA_STACK_DELIVERED_TYPE = "universal-extractor:lora-stack-delivered";
// A v1.3 ComfyUI tab ignores payload.mode and replaces the stack even when
// the v1.4+ gallery requests append. The gallery MUST verify this capability
// during its probe before sending any LoRA mutation to an already-open tab.
const LORA_STACK_PROTOCOL_VERSION = 2;

const MIN_VERSION_FOR_ACTION_BAR = [1, 33, 9];

const openGallery = (event) => {
    const url = `${window.location.origin}${GALLERY_PATH}`;
    if (event.shiftKey) {
        window.open(url, "_blank", NEW_WINDOW_FEATURES);
        return;
    }
    window.open(url, "_blank");
};

const getComfyUIFrontendVersion = async () => {
    try {
        if (window["__COMFYUI_FRONTEND_VERSION__"]) {
            return window["__COMFYUI_FRONTEND_VERSION__"];
        }
    } catch (error) {
        console.warn("Universal Extractor: unable to read __COMFYUI_FRONTEND_VERSION__:", error);
    }

    try {
        const response = await fetch("/system_stats");
        const data = await response.json();
        if (data?.system?.comfyui_frontend_version) {
            return data.system.comfyui_frontend_version;
        }
        if (data?.system?.required_frontend_version) {
            return data.system.required_frontend_version;
        }
    } catch (error) {
        console.warn("Universal Extractor: unable to fetch system_stats:", error);
    }

    return "0.0.0";
};

const parseVersion = (versionStr) => {
    if (!versionStr || typeof versionStr !== "string") {
        return [0, 0, 0];
    }

    const cleanVersion = versionStr.replace(/^[vV]/, "").split("-")[0];
    const parts = cleanVersion.split(".").map((part) => parseInt(part, 10) || 0);
    while (parts.length < 3) {
        parts.push(0);
    }
    return parts;
};

const compareVersions = (version1, version2) => {
    const v1 = typeof version1 === "string" ? parseVersion(version1) : version1;
    const v2 = typeof version2 === "string" ? parseVersion(version2) : version2;

    for (let i = 0; i < 3; i++) {
        if (v1[i] > v2[i]) return 1;
        if (v1[i] < v2[i]) return -1;
    }

    return 0;
};

const supportsActionBarButtons = async () => {
    const version = await getComfyUIFrontendVersion();
    return compareVersions(version, MIN_VERSION_FOR_ACTION_BAR) >= 0;
};

const getUEIcon = () => {
    return `
        <svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <defs>
                <linearGradient id="ue-bg" x1="10" y1="8" x2="54" y2="56" gradientUnits="userSpaceOnUse">
                    <stop stop-color="#101728"/>
                    <stop offset="1" stop-color="#211433"/>
                </linearGradient>
                <radialGradient id="ue-glow" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(20 14) rotate(47.49) scale(33.5313 34.7175)">
                    <stop stop-color="#24365E" stop-opacity="0.95"/>
                    <stop offset="1" stop-color="#24365E" stop-opacity="0"/>
                </radialGradient>
                <linearGradient id="ue-u" x1="18" y1="16" x2="50" y2="50" gradientUnits="userSpaceOnUse">
                    <stop stop-color="#74F0FF"/>
                    <stop offset="0.55" stop-color="#63B4FF"/>
                    <stop offset="1" stop-color="#8A5CFF"/>
                </linearGradient>
                <linearGradient id="ue-spark" x1="44" y1="12" x2="54" y2="22" gradientUnits="userSpaceOnUse">
                    <stop stop-color="#FFF3A8"/>
                    <stop offset="1" stop-color="#FFB870"/>
                </linearGradient>
                <filter id="ue-shadow" x="8" y="8" width="48" height="50" color-interpolation-filters="sRGB" filterUnits="userSpaceOnUse">
                    <feFlood flood-opacity="0" result="BackgroundImageFix"/>
                    <feColorMatrix in="SourceAlpha" result="hardAlpha" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0"/>
                    <feOffset dy="4"/>
                    <feGaussianBlur stdDeviation="4"/>
                    <feComposite in2="hardAlpha" operator="out"/>
                    <feColorMatrix values="0 0 0 0 0.0823529 0 0 0 0 0.0470588 0 0 0 0 0.152941 0 0 0 0.42 0"/>
                    <feBlend in2="BackgroundImageFix" result="effect1_dropShadow_ue"/>
                    <feBlend in="SourceGraphic" in2="effect1_dropShadow_ue" result="shape"/>
                </filter>
            </defs>
            <rect width="64" height="64" rx="18" fill="url(#ue-bg)"/>
            <rect x="1" y="1" width="62" height="62" rx="17" fill="none" stroke="rgba(255,255,255,0.08)"/>
            <circle cx="19" cy="16" r="18" fill="url(#ue-glow)"/>
            <g filter="url(#ue-shadow)">
                <path d="M18 18V34.5C18 44.165 23.82 50 32 50C40.18 50 46 44.165 46 34.5V18" stroke="url(#ue-u)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
            </g>
            <path d="M49.5 11.5L50.766 15.234L54.5 16.5L50.766 17.766L49.5 21.5L48.234 17.766L44.5 16.5L48.234 15.234L49.5 11.5Z" fill="url(#ue-spark)"/>
        </svg>
    `;
};

const normalizeText = (value) => (value || "").replace(/\s+/g, " ").trim();

const isUniversalGalleryButton = (button) => {
    const ariaLabel = normalizeText(button.getAttribute("aria-label"));
    const title = normalizeText(button.getAttribute("title"));
    return ariaLabel.includes(BUTTON_LABEL) || title.includes(BUTTON_LABEL);
};

const applyCustomButtonAppearance = (button, replaceContents = false) => {
    if (!button || button.getAttribute(BUTTON_ATTR) === "true") {
        return;
    }

    button.setAttribute(BUTTON_ATTR, "true");
    button.classList.add("ue-top-menu-button");
    button.setAttribute("aria-label", BUTTON_TOOLTIP);
    button.title = BUTTON_TOOLTIP;

    if (replaceContents) {
        button.innerHTML = getUEIcon();
    }

    button.style.borderRadius = "4px";
    button.style.padding = "6px";
    button.style.backgroundColor = "var(--primary-bg)";

    const svg = button.querySelector("svg");
    if (svg) {
        svg.style.width = "20px";
        svg.style.height = "20px";
        svg.style.display = "block";
    }
};

const createTopMenuButton = async () => {
    const { ComfyButton } = await import("../../scripts/ui/components/button.js");

    const button = new ComfyButton({
        icon: "pi pi-images",
        tooltip: BUTTON_TOOLTIP,
        app,
        enabled: true,
        classList: "comfyui-button comfyui-menu-mobile-collapse primary",
    });

    if (button.iconElement) {
        button.iconElement.innerHTML = getUEIcon();
        button.iconElement.style.width = "1.2rem";
        button.iconElement.style.height = "1.2rem";
    }

    applyCustomButtonAppearance(button.element, false);
    button.element.addEventListener("click", openGallery);
    return button;
};

const attachTopMenuButton = async (attempt = 0) => {
    if (document.querySelector(`.${BUTTON_GROUP_CLASS}`)) {
        return;
    }

    const settingsGroup = app.menu?.settingsGroup;
    if (!settingsGroup?.element?.parentElement) {
        if (attempt >= MAX_ATTACH_ATTEMPTS) {
            console.warn("Universal Extractor: unable to locate the ComfyUI settings button group.");
            return;
        }

        requestAnimationFrame(() => attachTopMenuButton(attempt + 1));
        return;
    }

    const ueButton = await createTopMenuButton();
    const { ComfyButtonGroup } = await import("../../scripts/ui/components/buttonGroup.js");

    const buttonGroup = new ComfyButtonGroup(ueButton);
    buttonGroup.element.classList.add(BUTTON_GROUP_CLASS);
    settingsGroup.element.before(buttonGroup.element);
};

const observeActionBarButtons = () => {
    const applyToButtons = () => {
        Array.from(document.querySelectorAll("button"))
            .filter(isUniversalGalleryButton)
            .forEach((button) => applyCustomButtonAppearance(button, true));
    };

    applyToButtons();

    const observer = new MutationObserver(() => {
        applyToButtons();
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });
};

const normalizeNodeText = (value) => String(value || "").toLowerCase();

const isLoraManagerNode = (node) => {
    const text = [
        node?.type,
        node?.title,
        node?.name,
        node?.constructor?.title,
        node?.constructor?.name,
        node?.comfyClass,
    ].map(normalizeNodeText).join(" ");

    if (text.includes("loramanager") || text.includes("lora manager") || text.includes("lora堆")) {
        return true;
    }
    if (text.includes("lora stacker") || text.includes("lora stack combiner")) {
        return true;
    }

    return Array.isArray(node?.widgets) && node.widgets.some((widget) => {
        const name = normalizeNodeText(widget?.name);
        return name === "loras" || name === "lora_stack" || name === "lora_syntax";
    });
};

const getSelectedGraphNodes = () => {
    const selected = app.canvas?.selected_nodes;
    if (!selected) {
        return [];
    }
    if (Array.isArray(selected)) {
        return selected.filter(Boolean);
    }
    if (selected instanceof Set) {
        return Array.from(selected).filter(Boolean);
    }
    if (typeof selected === "object") {
        return Object.values(selected).filter(Boolean);
    }
    return [];
};

const getAllGraphNodes = () => {
    if (Array.isArray(app.graph?._nodes)) {
        return app.graph._nodes;
    }
    if (Array.isArray(app.graph?.nodes)) {
        return app.graph.nodes;
    }
    return [];
};

// LoRA Manager keeps the list in a `loras` widget and may mirror it to a
// `text` widget. The list is authoritative, but the text must be kept in sync
// without deleting non-LoRA content typed into the same field.
const LORA_SYNTAX_PATTERN = /<lora:([^:>]+):([^:>]+)(?::([^:>]+))?>/gi;
const loraItemName = (item) => String(item?.name ?? item?.lora_name ?? item?.lora ?? "").trim();
const isLoraEntryEnabled = (item) => !!item && item.enabled !== false && item.active !== false;

const dedupeLorasByLastName = (loras) => loras.reduce((acc, item) => {
    const name = loraItemName(item);
    // Append must not discard an existing, perhaps temporarily incomplete,
    // entry merely because it does not yet have a LoRA name.
    if (!name) return [...acc, item];
    return [...acc.filter((previous) => loraItemName(previous) !== name), { ...item, name }];
}, []);

const parseIncomingStrength = (value, fallback, name) => {
    if (value === null || value === undefined || value === "") return fallback;
    if (typeof value !== "number" && typeof value !== "string") {
        throw new Error(`Invalid LoRA strength for ${name}.`);
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) throw new Error(`Invalid LoRA strength for ${name}.`);
    return numeric;
};

const makeLorasWidgetValue = (loraManager) => dedupeLorasByLastName(
    loraManager.loras.filter(isLoraEntryEnabled).map((item) => {
        const name = loraItemName(item);
        if (!name || /[<>:\x00-\x1f]/.test(name)) {
            throw new Error("Invalid LoRA name in image metadata.");
        }
        const strength = parseIncomingStrength(item.strength_model, 1, name);
        return {
            name,
            strength,
            clipStrength: parseIncomingStrength(item.strength_clip, strength, name),
            active: true,
            enabled: true,
            // Upstream respects an explicit `expanded` flag even for differing
            // strengths. Keep the independent CLIP value, but start folded.
            expanded: false,
        };
    }),
);

const getLorasValue = (value) => {
    if (value == null || value === "") return [];
    const entries = Array.isArray(value) ? value : value?.__value__;
    if (Array.isArray(entries) && entries.every((item) => item && typeof item === "object" && !Array.isArray(item))) {
        return entries;
    }
    throw new Error("Unsupported LoRA Manager widget value; no stack was changed.");
};

const parseTextLoras = (text) => {
    const parsed = [];
    for (const match of String(text || "").matchAll(LORA_SYNTAX_PATTERN)) {
        const strength = Number(match[2]);
        const clipStrength = match[3] === undefined ? strength : Number(match[3]);
        if (!Number.isFinite(strength) || !Number.isFinite(clipStrength)) continue;
        parsed.push({
            name: match[1].trim(), strength, clipStrength,
            active: true, enabled: true, expanded: false,
        });
    }
    return dedupeLorasByLastName(parsed);
};

const mergeLoraEntries = (existing, incoming, mode) => {
    const current = dedupeLorasByLastName(existing);
    const oldNames = new Set(current.map(loraItemName));
    const newNames = new Set(incoming.map(loraItemName));
    const summary = {
        applied: incoming.length,
        added: incoming.filter((item) => !oldNames.has(item.name)).length,
        updated: incoming.filter((item) => oldNames.has(item.name)).length,
        removed: mode === "replace" ? current.filter((item) => !newNames.has(item.name)).length : 0,
    };
    if (mode === "replace") return { value: incoming.map((item) => ({ ...item, expanded: false })), summary };

    const value = current.map((item) => {
        const matched = incoming.find((entry) => entry.name === item.name);
        // A send folds EVERY CLIP child row on the target, including untouched
        // and disabled entries. Never normalize clipStrength to strength here:
        // the upstream widget respects expanded:false and retains both values.
        return { ...item, ...(matched || {}), expanded: false };
    });
    value.push(...incoming.filter((item) => !oldNames.has(item.name)).map((item) => ({ ...item, expanded: false })));
    return { value, summary };
};

const loraItemToSyntax = (item) => {
    const name = loraItemName(item);
    if (!name) return "";
    const strength = item.strength ?? item.strength_model ?? 1;
    const clip = item.clipStrength ?? item.strength_clip ?? strength;
    return Number(strength) === Number(clip)
        ? `<lora:${name}:${strength}>`
        : `<lora:${name}:${strength}:${clip}>`;
};

const updateLoraSyntaxText = (currentValue, loras, mode) => {
    const byName = new Map(loras.map((item) => [loraItemName(item), item]));
    const seen = new Set();
    const retained = String(currentValue ?? "").replace(LORA_SYNTAX_PATTERN, (match, rawName) => {
        if (mode === "replace") return "";
        const name = rawName.trim();
        if (seen.has(name)) return "";
        seen.add(name);
        return byName.has(name) ? loraItemToSyntax(byName.get(name)) : match;
    }).trim();
    const missing = loras
        .filter((item) => !seen.has(loraItemName(item)))
        .map(loraItemToSyntax)
        .filter(Boolean)
        .join(" ");
    return [retained, missing].filter(Boolean).join(" ");
};

const numberMatches = (left, right) => {
    if (left == null || right == null) return left === right;
    const a = Number(left), b = Number(right);
    return Number.isFinite(a) && Number.isFinite(b) ? a === b : String(left) === String(right);
};

const loraValuesMatch = (left, right) => {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => {
        const other = right[index];
        return loraItemName(item) === loraItemName(other) &&
            numberMatches(item?.strength, other?.strength) &&
            numberMatches(item?.clipStrength, other?.clipStrength) &&
            Boolean(item?.active) === Boolean(other?.active) &&
            Boolean(item?.enabled) === Boolean(other?.enabled) &&
            Boolean(item?.expanded) === Boolean(other?.expanded) &&
            Boolean(item?.locked) === Boolean(other?.locked) &&
            Boolean(item?.selected) === Boolean(other?.selected);
    });
};

const cloneLoraValue = (value) => value.map((item) => {
    const strength = item.strength ?? item.strength_model ?? 1;
    const clip = item.clipStrength ?? item.strength_clip ?? strength;
    return {
        ...item,
        // Upstream's widget setter uses `clipStrength || strength`. A numeric
        // zero with a nonzero model strength would be lost; "0" is truthy and
        // is accepted by its number inputs and text syntax formatter.
        clipStrength: Number(clip) === 0 && Number(strength) !== 0 ? "0" : clip,
    };
});
const setWidgetValue = (node, widget, value) => {
    widget.value = value;
    // LoRA Manager's text callback parses tags into the list; its list
    // callback schedules the reverse sync. Do not silently swallow errors.
    widget.callback?.(value, app.canvas, node, undefined, undefined);
};

const markNodeDirty = (node) => {
    node?.setDirtyCanvas?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
    app.canvas?.setDirty?.(true, true);
    app.canvas?.draw?.(true, true);
};

const nodeLabel = (node) => String(node?.title || node?.comfyClass || node?.type || "LoRA Manager").trim().slice(0, 120);

const applyLoraStackToNode = async (node, incoming, mode) => {
    const widgets = Array.isArray(node?.widgets) ? node.widgets : [];
    const loraWidgets = widgets.filter((widget) =>
        ["loras", "lora_stack_data", "active_loras"].includes(normalizeNodeText(widget?.name)));
    const textWidgets = widgets.filter((widget) =>
        ["text", "lora_stack", "lora_syntax", "lora_text"].includes(normalizeNodeText(widget?.name)));
    const properties = node?.properties && typeof node.properties === "object" ? node.properties : null;
    if (!loraWidgets.length && !textWidgets.length &&
        !(properties && ("loras" in properties || "lora_stack" in properties || "lora_syntax" in properties))) {
        return null;
    }

    const sourceText = textWidgets[0]?.value ?? properties?.lora_stack ?? properties?.lora_syntax ?? "";
    const current = loraWidgets.length
        ? getLorasValue(loraWidgets[0].value)
        : properties && "loras" in properties
            ? getLorasValue(properties.loras)
            : parseTextLoras(sourceText);
    // An unsaved tag in the text input must not disappear during append even
    // if LoRA Manager has not synchronized it to the structured list yet.
    const names = new Set(current.map(loraItemName));
    const combined = [...current, ...parseTextLoras(sourceText).filter((item) => !names.has(item.name))];
    const { value, summary } = mergeLoraEntries(combined, incoming, mode);
    const preparedValue = cloneLoraValue(value);
    const active = value.filter(isLoraEntryEnabled);
    const changes = new Set();
    // The text callback can mutate the list before we get to its own write.
    // Snapshot every involved widget *before* calling any callback.
    const originalWidgets = new Map([...new Set([...textWidgets, ...loraWidgets])].map((widget) => [
        widget,
        Array.isArray(widget.value) ? widget.value.map((item) => ({ ...item })) : widget.value,
    ]));
    const originalProperties = properties ? { ...properties } : null;

    try {
        // Write text before the list. Its callback may temporarily rebuild
        // LoRA Manager's list; the final structured write restores the exact
        // active/expanded state without disabling unrelated entries.
        for (const widget of textWidgets) {
            const next = updateLoraSyntaxText(widget.value, mode === "replace" ? incoming : active, mode);
            if (widget.value !== next) {
                changes.add(widget);
                setWidgetValue(node, widget, next);
            }
        }
        for (const widget of loraWidgets) {
            if (!loraValuesMatch(widget.value, preparedValue)) {
                changes.add(widget);
                setWidgetValue(node, widget, cloneLoraValue(preparedValue));
            }
        }
        if (!loraWidgets.length && properties && "loras" in properties) {
            properties.loras = cloneLoraValue(value);
        }
        if (!textWidgets.length && properties && ("lora_stack" in properties || "lora_syntax" in properties)) {
            const key = "lora_stack" in properties ? "lora_stack" : "lora_syntax";
            properties[key] = updateLoraSyntaxText(properties[key], mode === "replace" ? incoming : active, mode);
        }

        if (changes.size || properties && Object.keys(originalProperties).some((key) => properties[key] !== originalProperties[key])) {
            markNodeDirty(node);
        }

        if (loraWidgets.length || textWidgets.length) {
            // Upstream's list -> text callback is debounced (80ms). A receipt
            // cannot mean "applied" until both widgets have settled. A v1.3
            // bridge only checked incoming names and falsely reported success
            // after deleting every OLD entry on append.
            await new Promise((resolve) => window.setTimeout(resolve, 180));
            let repaired = false;
            for (const widget of loraWidgets) {
                if (!loraValuesMatch(widget.value, preparedValue)) {
                    setWidgetValue(node, widget, cloneLoraValue(preparedValue));
                    repaired = true;
                }
            }
            if (repaired) {
                markNodeDirty(node);
                // A repair triggers another upstream reverse-sync; check its
                // final result too, instead of acknowledging a transient state.
                await new Promise((resolve) => window.setTimeout(resolve, 120));
            }
            for (const widget of loraWidgets) {
                if (!loraValuesMatch(widget.value, preparedValue)) {
                    throw new Error("LoRA Manager rejected the stack or independent CLIP strength.");
                }
            }
            for (const widget of textWidgets) {
                const byName = new Map(parseTextLoras(widget.value).map((item) => [item.name, item]));
                const originalNames = mode === "append"
                    ? parseTextLoras(originalWidgets.get(widget)).map((item) => item.name)
                    : [];
                const requiredNames = new Set([...originalNames, ...active.map(loraItemName).filter(Boolean)]);
                if ([...requiredNames].some((name) => !byName.has(name)) ||
                    mode === "replace" && byName.size !== incoming.length ||
                    active.some((item) => {
                        const actual = byName.get(loraItemName(item));
                        const model = item.strength ?? item.strength_model ?? 1;
                        const clip = item.clipStrength ?? item.strength_clip ?? model;
                        return !actual || !numberMatches(actual.strength, model) ||
                            !numberMatches(actual.clipStrength, clip);
                    })) {
                    throw new Error("LoRA Manager did not retain all LoRAs and CLIP strengths in the text field.");
                }
            }
        }
        return { ...summary, target: nodeLabel(node) };
    } catch (error) {
        // A third-party widget callback can throw after a partial write.
        // Best-effort rollback is safer than acknowledging a broken stack.
        for (const [widget, previous] of originalWidgets) {
            try { widget.value = previous; } catch { /* Best effort */ }
        }
        if (properties && originalProperties) {
            for (const key of Object.keys(properties)) {
                if (!(key in originalProperties)) delete properties[key];
            }
            Object.assign(properties, originalProperties);
        }
        markNodeDirty(node);
        throw error;
    }
};

const applyLoraStackPayload = async (payload) => {
    if (payload?.mode !== "append" && payload?.mode !== "replace") {
        return { ok: false, error: "Select Append or Replace from a refreshed gallery page." };
    }
    const loraManager = payload?.loraManager;
    if (!loraManager?.detected || !Array.isArray(loraManager.loras)) {
        return { ok: false, error: "No LoRA Manager stack was provided." };
    }

    let incoming;
    try {
        incoming = makeLorasWidgetValue(loraManager);
    } catch (error) {
        return { ok: false, error: error?.message || "Invalid LoRA stack." };
    }
    if (!incoming.length) return { ok: false, error: "The source stack has no active LoRAs." };

    const candidates = [...getSelectedGraphNodes(), ...getAllGraphNodes()]
        .filter((node, index, list) => node && list.indexOf(node) === index)
        .filter(isLoraManagerNode);
    for (const node of candidates) {
        try {
            const summary = await applyLoraStackToNode(node, incoming, payload.mode);
            if (summary) return { ok: true, summary };
        } catch (error) {
            return { ok: false, error: error?.message || "Unable to apply the LoRA stack." };
        }
    }
    return { ok: false, error: "No writable LoRA Manager node in the current graph." };
};

const createExtensionObject = (useActionBar) => {
    const extensionObj = {
        name: "UniversalExtractor.TopMenu",
        async setup() {
            window.name = COMFY_WINDOW_NAME;
            let lastHandledWorkflowId = null;
            const recentLoraStackResults = new Map();
            let loraStackQueue = Promise.resolve();
            let workflowChannel = null;
            const instanceId = window.sessionStorage.getItem("universal-extractor:comfy-instance-id") ||
                `comfy-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
            window.sessionStorage.setItem("universal-extractor:comfy-instance-id", instanceId);

            const postWorkflowChannelMessage = (message) => {
                try {
                    workflowChannel?.postMessage(message);
                } catch (error) {
                    console.warn("Universal Extractor: failed to post workflow channel message:", error);
                }
            };

            const acknowledgeWorkflowProbe = (data = {}) => {
                postWorkflowChannelMessage({
                    type: WORKFLOW_ACK_TYPE,
                    instanceId,
                    probeId: data.probeId || null,
                    payloadId: data.payloadId || null,
                    visibilityState: document.visibilityState,
                    focused: document.hasFocus(),
                    href: window.location.href,
                    loraStackProtocol: LORA_STACK_PROTOCOL_VERSION,
                    ts: Date.now(),
                });
            };

            const notifyChannelDelivered = (payload, type = WORKFLOW_DELIVERED_TYPE, result = { ok: true }) => {
                postWorkflowChannelMessage({
                    type,
                    instanceId,
                    payloadId: payload?.id || null,
                    ok: result.ok !== false,
                    error: result.error || null,
                    summary: result.summary || null,
                    loraStackProtocol: type === LORA_STACK_DELIVERED_TYPE ? LORA_STACK_PROTOCOL_VERSION : undefined,
                    href: window.location.href,
                    ts: Date.now(),
                });
            };

            const notifyWorkflowDelivered = (payload) => {
                notifyChannelDelivered(payload, WORKFLOW_DELIVERED_TYPE, { ok: true });
            };

            const notifyLoraStackDelivered = (payload, result) => {
                notifyChannelDelivered(payload, LORA_STACK_DELIVERED_TYPE, result);
            };

            const applyWorkflowPayload = async (payload) => {
                try {
                    if (!payload) {
                        return;
                    }

                    if (payload.id && payload.id === lastHandledWorkflowId) {
                        notifyWorkflowDelivered(payload);
                        return;
                    }
                    lastHandledWorkflowId = payload.id || null;

                    if (payload.workflow && typeof app.loadGraphData === "function") {
                        await app.loadGraphData(payload.workflow, true, true, payload.image || null);
                        notifyWorkflowDelivered(payload);
                        return;
                    }

                    if (payload.prompt && typeof app.loadApiJson === "function") {
                        await app.loadApiJson(payload.prompt, payload.image || "gallery-image");
                        notifyWorkflowDelivered(payload);
                        return;
                    }

                    console.warn("Universal Extractor: no supported workflow payload was found.");
                    notifyChannelDelivered(payload, WORKFLOW_DELIVERED_TYPE, { ok: false, error: "No supported workflow payload." });
                } catch (error) {
                    console.warn("Universal Extractor: failed to load pending workflow:", error);
                    notifyChannelDelivered(payload, WORKFLOW_DELIVERED_TYPE, { ok: false, error: error?.message || "Failed to load workflow." });
                }
            };

            const applyLoraStackPayloadOnce = async (payload) => {
                if (!payload) return;
                const id = typeof payload.id === "string" && payload.id ? payload.id : null;
                let pending = id ? recentLoraStackResults.get(id) : null;
                if (!pending) {
                    // Serialize graph mutations. All deliveries for the same
                    // id await one result, including a retry after a later send.
                    pending = loraStackQueue.then(() => applyLoraStackPayload(payload)).catch((error) => {
                        console.warn("Universal Extractor: failed to apply LoRA stack:", error);
                        return { ok: false, error: error?.message || "Unable to apply LoRA stack." };
                    });
                    loraStackQueue = pending.then(() => undefined);
                    if (id) {
                        recentLoraStackResults.set(id, pending);
                        if (recentLoraStackResults.size > 32) {
                            recentLoraStackResults.delete(recentLoraStackResults.keys().next().value);
                        }
                    }
                }
                const result = await pending;
                notifyLoraStackDelivered(payload, result);
            };

            const tryLoadPendingWorkflow = async () => {
                const raw = window.localStorage.getItem(PENDING_WORKFLOW_KEY);
                if (!raw) {
                    return;
                }

                try {
                    const payload = JSON.parse(raw);
                    await applyWorkflowPayload(payload);
                    window.localStorage.removeItem(PENDING_WORKFLOW_KEY);
                } catch (error) {
                    console.warn("Universal Extractor: failed to read pending workflow:", error);
                }
            };

            if (!useActionBar) {
                console.log("Universal Extractor: using legacy button attachment (frontend < 1.33.9)");
                await attachTopMenuButton();
            } else {
                console.log("Universal Extractor: using actionBarButtons API (frontend >= 1.33.9)");
            }

            const injectStyles = () => {
                const styleId = "ue-top-menu-button-styles";
                if (document.getElementById(styleId)) return;

                const style = document.createElement("style");
                style.id = styleId;
                style.textContent = `
                    button.ue-top-menu-button[${BUTTON_ATTR}="true"] {
                        transition: all 0.2s ease;
                        border: 1px solid transparent;
                    }
                    button.ue-top-menu-button[${BUTTON_ATTR}="true"]:hover {
                        background-color: var(--primary-hover-bg) !important;
                    }
                `;
                document.head.appendChild(style);
            };

            injectStyles();

            if (useActionBar) {
                observeActionBarButtons();
            }

            const handleWorkflowMessage = (data) => {
                if (data?.type === WORKFLOW_PROBE_TYPE) {
                    acknowledgeWorkflowProbe(data);
                    return;
                }

                if (data?.type === WORKFLOW_MESSAGE_TYPE && data.payload) {
                    if (data.targetInstanceId && data.targetInstanceId !== instanceId) {
                        return;
                    }
                    void applyWorkflowPayload(data.payload);
                    return;
                }

                if (data?.type === LORA_STACK_MESSAGE_TYPE && data.payload) {
                    if (data.targetInstanceId && data.targetInstanceId !== instanceId) {
                        return;
                    }
                    applyLoraStackPayloadOnce(data.payload);
                    return;
                }

                void applyWorkflowPayload(data);
            };

            if ("BroadcastChannel" in window) {
                workflowChannel = new BroadcastChannel(WORKFLOW_CHANNEL_NAME);
                workflowChannel.onmessage = (event) => {
                    handleWorkflowMessage(event.data);
                };
            }

            window.addEventListener("message", (event) => {
                if (event.origin !== window.location.origin) {
                    return;
                }

                handleWorkflowMessage(event.data);
            });

            window.addEventListener("storage", (event) => {
                if (event.key === PENDING_WORKFLOW_KEY && event.newValue) {
                    void tryLoadPendingWorkflow();
                }
            });

            window.addEventListener("focus", () => {
                void tryLoadPendingWorkflow();
            });

            document.addEventListener("visibilitychange", () => {
                if (document.visibilityState === "visible") {
                    void tryLoadPendingWorkflow();
                }
            });

            setTimeout(() => {
                void tryLoadPendingWorkflow();
            }, 150);
        },
    };

    if (useActionBar) {
        extensionObj.actionBarButtons = [
            {
                icon: "pi pi-images",
                tooltip: BUTTON_TOOLTIP,
                onClick: openGallery,
            },
        ];
    }

    return extensionObj;
};

(async () => {
    const useActionBar = await supportsActionBarButtons();
    const extensionObj = createExtensionObject(useActionBar);
    app.registerExtension(extensionObj);
})();
