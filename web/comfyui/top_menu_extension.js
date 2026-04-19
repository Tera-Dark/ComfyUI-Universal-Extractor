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

const createExtensionObject = (useActionBar) => {
    const extensionObj = {
        name: "UniversalExtractor.TopMenu",
        async setup() {
            window.name = COMFY_WINDOW_NAME;
            let lastHandledWorkflowId = null;

            const applyWorkflowPayload = async (payload) => {
                try {
                    if (!payload) {
                        return;
                    }

                    if (payload.id && payload.id === lastHandledWorkflowId) {
                        return;
                    }
                    lastHandledWorkflowId = payload.id || null;

                    if (payload.workflow && typeof app.loadGraphData === "function") {
                        await app.loadGraphData(payload.workflow, true, true, payload.image || null);
                        return;
                    }

                    if (payload.prompt && typeof app.loadApiJson === "function") {
                        await app.loadApiJson(payload.prompt, payload.image || "gallery-image");
                        return;
                    }

                    console.warn("Universal Extractor: no supported workflow payload was found.");
                } catch (error) {
                    console.warn("Universal Extractor: failed to load pending workflow:", error);
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

            if ("BroadcastChannel" in window) {
                const channel = new BroadcastChannel(WORKFLOW_CHANNEL_NAME);
                channel.onmessage = (event) => {
                    void applyWorkflowPayload(event.data);
                };
            }

            window.addEventListener("message", (event) => {
                if (event.origin !== window.location.origin) {
                    return;
                }

                if (event.data?.type === WORKFLOW_MESSAGE_TYPE && event.data.payload) {
                    void applyWorkflowPayload(event.data.payload);
                }
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
