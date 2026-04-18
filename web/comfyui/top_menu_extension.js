import { app } from "../../scripts/app.js";

const BUTTON_TOOLTIP = "Launch Universal Gallery\n(Shift+Click opens in new window)";
const GALLERY_PATH = "/gallery/index.html";
const NEW_WINDOW_FEATURES = "width=1280,height=860,resizable=yes,scrollbars=yes,status=yes";
const MAX_ATTACH_ATTEMPTS = 120;
const BUTTON_GROUP_CLASS = "universal-extractor-top-menu-group";

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
        if (window['__COMFYUI_FRONTEND_VERSION__']) {
            return window['__COMFYUI_FRONTEND_VERSION__'];
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
    if (!versionStr || typeof versionStr !== 'string') return [0, 0, 0];
    const clean = versionStr.replace(/^[vV]/, '').split('-')[0];
    const parts = clean.split('.').map(p => parseInt(p, 10) || 0);
    while (parts.length < 3) parts.push(0);
    return parts;
};

const compareVersions = (v1, v2) => {
    const a = typeof v1 === 'string' ? parseVersion(v1) : v1;
    const b = typeof v2 === 'string' ? parseVersion(v2) : v2;
    for (let i = 0; i < 3; i++) {
        if (a[i] > b[i]) return 1;
        if (a[i] < b[i]) return -1;
    }
    return 0;
};

const supportsActionBarButtons = async () => {
    const version = await getComfyUIFrontendVersion();
    return compareVersions(version, MIN_VERSION_FOR_ACTION_BAR) >= 0;
};

/* ── SVG icon: "U" letter on blue rounded rect, white text ── */
const getUEIcon = () => {
    return `
        <svg viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg">
            <rect x="2" y="2" width="28" height="28" rx="6" ry="6" fill="#3B82F6"/>
            <text x="16" y="23" text-anchor="middle" font-family="Arial, sans-serif" font-weight="bold" font-size="20" fill="white">U</text>
        </svg>
    `;
};

const createTopMenuButton = async () => {
    const { ComfyButton } = await import("../../scripts/ui/components/button.js");

    const button = new ComfyButton({
        icon: "universalextractor",
        tooltip: BUTTON_TOOLTIP,
        app,
        enabled: true,
        classList: "comfyui-button comfyui-menu-mobile-collapse primary",
    });

    button.element.setAttribute("aria-label", BUTTON_TOOLTIP);
    button.element.title = BUTTON_TOOLTIP;

    if (button.iconElement) {
        button.iconElement.innerHTML = getUEIcon();
        button.iconElement.style.width = "1.2rem";
        button.iconElement.style.height = "1.2rem";
    }

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

const createExtensionObject = (useActionBar) => {
    const extensionObj = {
        name: "UniversalExtractor.TopMenu",
        async setup() {
            if (!useActionBar) {
                console.log("Universal Extractor: using legacy button attachment (frontend < 1.33.9)");
                await attachTopMenuButton();
            } else {
                console.log("Universal Extractor: using actionBarButtons API (frontend >= 1.33.9)");
            }

            // Inject button icon styles
            const injectStyles = () => {
                const styleId = 'ue-top-menu-button-styles';
                if (document.getElementById(styleId)) return;
                const style = document.createElement('style');
                style.id = styleId;
                style.textContent = `
                    button[aria-label="${BUTTON_TOOLTIP}"].ue-top-menu-button {
                        transition: all 0.2s ease;
                        border: 1px solid transparent;
                    }
                    button[aria-label="${BUTTON_TOOLTIP}"].ue-top-menu-button:hover {
                        background-color: var(--primary-hover-bg) !important;
                    }
                `;
                document.head.appendChild(style);
            };
            injectStyles();

            // For actionBarButtons mode, replace the icon after it renders
            const replaceButtonIcon = () => {
                const buttons = document.querySelectorAll(`button[aria-label="${BUTTON_TOOLTIP}"]`);
                buttons.forEach(button => {
                    button.classList.add('ue-top-menu-button');
                    button.innerHTML = getUEIcon();
                    button.style.borderRadius = '4px';
                    button.style.padding = '6px';
                    button.style.backgroundColor = 'var(--primary-bg)';
                    const svg = button.querySelector('svg');
                    if (svg) {
                        svg.style.width = '20px';
                        svg.style.height = '20px';
                    }
                });
                if (buttons.length === 0) {
                    requestAnimationFrame(replaceButtonIcon);
                }
            };
            requestAnimationFrame(replaceButtonIcon);
        },
    };

    if (useActionBar) {
        extensionObj.actionBarButtons = [
            {
                icon: "icon-[mdi--alpha-u-box] size-4",
                tooltip: BUTTON_TOOLTIP,
                onClick: openGallery
            }
        ];
    }

    return extensionObj;
};

(async () => {
    const useActionBar = await supportsActionBarButtons();
    const extensionObj = createExtensionObject(useActionBar);
    app.registerExtension(extensionObj);
})();
