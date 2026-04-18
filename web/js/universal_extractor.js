import { app } from "../../../scripts/app.js";

app.registerExtension({
    name: "Comfy.UniversalExtractor",

    async setup() {
        // --- Create the top-bar launch button (like LoRA Manager) ---
        const galleryBtn = document.createElement("button");
        galleryBtn.id = "universal-extractor-launch-btn";
        galleryBtn.title = "Launch Universal Gallery\n(Shift+Click opens in new window)";
        galleryBtn.innerHTML = `<span style="font-size:14px;font-weight:700;line-height:1;">&#x2728;</span>`;

        Object.assign(galleryBtn.style, {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: "32px",
            height: "32px",
            border: "none",
            borderRadius: "6px",
            background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
            color: "#fff",
            cursor: "pointer",
            marginLeft: "6px",
            boxShadow: "0 2px 8px rgba(99,102,241,0.35)",
            transition: "all 0.2s ease",
            position: "relative",
            zIndex: "9999",
        });

        galleryBtn.addEventListener("mouseenter", () => {
            galleryBtn.style.transform = "scale(1.12)";
            galleryBtn.style.boxShadow = "0 4px 16px rgba(99,102,241,0.5)";
        });
        galleryBtn.addEventListener("mouseleave", () => {
            galleryBtn.style.transform = "scale(1)";
            galleryBtn.style.boxShadow = "0 2px 8px rgba(99,102,241,0.35)";
        });

        galleryBtn.addEventListener("click", (e) => {
            const galleryUrl = `${window.location.origin}/gallery/index.html`;
            if (e.shiftKey) {
                // Shift+Click: open in new window
                window.open(galleryUrl, "_blank");
            } else {
                // Normal click: open in new tab
                window.open(galleryUrl, "_blank");
            }
        });

        // Insert button into ComfyUI's top menu bar
        // Try multiple known locations for compatibility
        const tryInsert = () => {
            // ComfyUI new frontend (Vue-based) - look for the top bar
            const menuBar = document.querySelector(".comfyui-menu") 
                || document.querySelector("header")
                || document.querySelector(".comfy-menu");
            
            if (menuBar) {
                // Try to find a good spot - after existing buttons
                const rightSection = menuBar.querySelector(".comfyui-menu-right") 
                    || menuBar.querySelector('[class*="right"]')
                    || menuBar;
                rightSection.prepend(galleryBtn);
                return true;
            }

            // Legacy ComfyUI menu
            const legacyMenu = document.getElementById("comfy-menu") 
                || document.querySelector(".comfy-menu");
            if (legacyMenu) {
                legacyMenu.appendChild(galleryBtn);
                return true;
            }

            return false;
        };

        // Retry insertion since the menu might load later
        if (!tryInsert()) {
            const observer = new MutationObserver(() => {
                if (tryInsert()) {
                    observer.disconnect();
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
            
            // Fallback: if not found after 8 seconds, attach to body as floating button
            setTimeout(() => {
                observer.disconnect();
                if (!document.getElementById("universal-extractor-launch-btn")?.parentElement 
                    || document.getElementById("universal-extractor-launch-btn")?.parentElement === document.body) {
                    return; // already inserted
                }
                // Float bottom-left as fallback
                Object.assign(galleryBtn.style, {
                    position: "fixed",
                    bottom: "80px",
                    left: "16px",
                    width: "44px",
                    height: "44px",
                    borderRadius: "12px",
                    fontSize: "18px",
                    zIndex: "99999",
                });
                document.body.appendChild(galleryBtn);
            }, 8000);
        }
    },
});
