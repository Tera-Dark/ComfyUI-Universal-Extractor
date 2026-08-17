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

const formatLoraNumber = (value, fallback = 1) => {
    if (value === null || value === undefined || value === "") {
        return fallback;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : value;
};

const isLoraEntryEnabled = (item) => item?.enabled !== false && item?.active !== false;

const makeLoraSyntax = (loraManager) => {
    const activeLoras = (loraManager?.loras || [])
        .filter((item) => isLoraEntryEnabled(item) && item?.name)
        .map((item) => {
            const model = formatLoraNumber(item.strength_model, 1);
            const clip = item.strength_clip === null || item.strength_clip === undefined ? model : formatLoraNumber(item.strength_clip, model);
            return String(clip) === String(model)
                ? `<lora:${item.name}:${model}>`
                : `<lora:${item.name}:${model}:${clip}>`;
        });
    if (activeLoras.length) {
        return activeLoras.join(" ");
    }
    if (typeof loraManager?.raw_stack === "string" && loraManager.raw_stack.trim()) {
        return loraManager.raw_stack.trim();
    }
    return "";
};

const makeLorasWidgetValue = (loraManager) => (loraManager?.loras || [])
    .filter((item) => isLoraEntryEnabled(item) && item?.name)
    .map((item) => {
        const model = formatLoraNumber(item.strength_model, 1);
        return {
            name: item.name,
            strength: model,
            clipStrength: item.strength_clip === null || item.strength_clip === undefined
                ? model
                : formatLoraNumber(item.strength_clip, model),
            active: true,
            expanded: String(item.strength_clip ?? model) !== String(model),
        };
    });

const cloneLoraValue = (value) => value.map((item) => ({ ...item }));

const loraItemName = (item) => String(item?.name || item?.lora_name || item?.lora || "").trim();

const dedupeLorasByLastName = (loras) => loras.reduce((acc, lora) => {
    const loraName = loraItemName(lora);
    const filtered = acc.filter((item) => loraItemName(item) !== loraName);
    return [...filtered, lora];
}, []);

const deactivateLoraItem = (item) => ({
    ...item,
    active: false,
    enabled: false,
});

const activateLoraItem = (item) => ({
    ...item,
    active: true,
    enabled: true,
});

const applyExclusiveLorasWidgetValue = (currentValue, incomingValue) => {
    const current = Array.isArray(currentValue) ? cloneLoraValue(currentValue) : [];
    const incomingNames = new Set(incomingValue.map(loraItemName).filter(Boolean));
    const merged = current
        .filter((item) => {
            const name = loraItemName(item);
            return name && !incomingNames.has(name);
        })
        .map(deactivateLoraItem);

    for (const incoming of incomingValue) {
        const existing = current.find((item) => loraItemName(item) === loraItemName(incoming));
        merged.push(activateLoraItem({ ...(existing || {}), ...incoming }));
    }
    return dedupeLorasByLastName(merged);
};

const loraWidgetItemToSyntax = (item) => {
    if (!loraItemName(item)) {
        return "";
    }
    const model = formatLoraNumber(item?.strength, 1);
    const clip = item?.clipStrength === null || item?.clipStrength === undefined
        ? model
        : formatLoraNumber(item.clipStrength, model);
    return String(clip) === String(model)
        ? `<lora:${item.name}:${model}>`
        : `<lora:${item.name}:${model}:${clip}>`;
};

const replaceLoraSyntaxText = (_currentValue, incomingValue, fallbackRawStack) => {
    const text = incomingValue.map(loraWidgetItemToSyntax).filter(Boolean).join(" ").trim();
    return text || fallbackRawStack || "";
};

const loraValuesMatch = (left, right) => {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
        return false;
    }
    return left.every((item, index) => {
        const other = right[index];
        return loraItemName(item) === loraItemName(other) &&
            String(item?.strength) === String(other?.strength) &&
            String(item?.clipStrength) === String(other?.clipStrength) &&
            Boolean(item?.active) === Boolean(other?.active) &&
            Boolean(item?.enabled) === Boolean(other?.enabled);
    });
};

const setWidgetValue = (node, widget, value, options = {}) => {
    widget.value = value;
    if (options.callback === false) {
        return;
    }
    try {
        widget.callback?.(value, app.canvas, node, undefined, undefined);
    } catch (error) {
        console.warn("Universal Extractor: LoRA widget callback failed:", error);
    }
};

const markNodeDirty = (node) => {
    node?.setDirtyCanvas?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
    app.canvas?.setDirty?.(true, true);
    app.canvas?.draw?.(true, true);
};

const applyLoraStackToNode = (node, loraManager) => {
    const widgets = Array.isArray(node?.widgets) ? node.widgets : [];
    if (!widgets.length) {
        return false;
    }

    const lorasValue = dedupeLorasByLastName(makeLorasWidgetValue(loraManager));
    const rawStack = makeLoraSyntax(loraManager);
    const loraWidgets = [];
    const textWidgets = [];
    const expectedWidgetValues = new Map();
    let changed = false;

    for (const widget of widgets) {
        const name = normalizeNodeText(widget?.name);
        if (name === "loras" || name === "lora_stack_data" || name === "active_loras") {
            loraWidgets.push(widget);
            continue;
        }
        if (name === "text" || name === "lora_stack" || name === "lora_syntax" || name === "lora_text") {
            textWidgets.push(widget);
        }
    }

    const hasStructuredLoras = loraWidgets.length > 0;
    if (!hasStructuredLoras) {
        for (const widget of textWidgets) {
            setWidgetValue(node, widget, replaceLoraSyntaxText(widget.value, lorasValue, rawStack));
            changed = true;
        }
    } else {
        const activeText = replaceLoraSyntaxText("", lorasValue, rawStack);
        for (const widget of textWidgets) {
            setWidgetValue(node, widget, activeText);
            changed = true;
        }
    }
    for (const widget of loraWidgets) {
        const mergedValue = applyExclusiveLorasWidgetValue(widget.value, lorasValue);
        expectedWidgetValues.set(widget, mergedValue);
        setWidgetValue(node, widget, cloneLoraValue(mergedValue));
        changed = true;
    }
    if (!changed && node.properties && typeof node.properties === "object") {
        if ("loras" in node.properties) {
            node.properties.loras = applyExclusiveLorasWidgetValue(node.properties.loras, lorasValue);
            changed = true;
        }
        if (!("loras" in node.properties) && ("lora_stack" in node.properties || "lora_syntax" in node.properties)) {
            node.properties.lora_stack = replaceLoraSyntaxText(node.properties.lora_stack, lorasValue, rawStack);
            changed = true;
        }
    }

    if (changed) {
        markNodeDirty(node);
        if (hasStructuredLoras) {
            window.setTimeout(() => {
                let repaired = false;
                for (const widget of loraWidgets) {
                    const expectedValue = expectedWidgetValues.get(widget) || lorasValue;
                    if (!loraValuesMatch(widget.value, expectedValue)) {
                        setWidgetValue(node, widget, cloneLoraValue(expectedValue));
                        repaired = true;
                    }
                }
                if (repaired) {
                    markNodeDirty(node);
                }
            }, 120);
        }
    }
    return changed;
};

const applyLoraStackPayload = (payload) => {
    const loraManager = payload?.loraManager;
    if (!loraManager?.detected || !Array.isArray(loraManager.loras) || loraManager.loras.length === 0) {
        return { ok: false, error: "No LoRA stack was provided." };
    }

    const candidates = [...getSelectedGraphNodes(), ...getAllGraphNodes()]
        .filter((node, index, list) => node && list.indexOf(node) === index)
        .filter(isLoraManagerNode);

    for (const node of candidates) {
        if (applyLoraStackToNode(node, loraManager)) {
            return { ok: true };
        }
    }

    return { ok: false };
};

const createExtensionObject = (useActionBar) => {
    const extensionObj = {
        name: "UniversalExtractor.TopMenu",
        async setup() {
            window.name = COMFY_WINDOW_NAME;
            let lastHandledWorkflowId = null;
            let lastHandledLoraStackId = null;
            let lastHandledLoraStackResult = { ok: true };
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
                } catch (error) {
                    console.warn("Universal Extractor: failed to load pending workflow:", error);
                }
            };

            const applyLoraStackPayloadOnce = (payload) => {
                try {
                    if (!payload) {
                        return;
                    }

                    if (payload.id && payload.id === lastHandledLoraStackId) {
                        notifyLoraStackDelivered(payload, lastHandledLoraStackResult);
                        return;
                    }
                    lastHandledLoraStackId = payload.id || null;
                    const result = applyLoraStackPayload(payload);
                    lastHandledLoraStackResult = result;
                    notifyLoraStackDelivered(payload, result);
                } catch (error) {
                    console.warn("Universal Extractor: failed to apply LoRA stack:", error);
                    lastHandledLoraStackResult = { ok: false, error: error?.message || "Unable to apply LoRA stack." };
                    notifyLoraStackDelivered(payload, lastHandledLoraStackResult);
                }
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
