# Agent Handoff Notes

This repository is a ComfyUI custom node plus a React/Vite gallery frontend.

## Project Map

- `py/` contains the ComfyUI node registration and Gallery backend.
- `py/gallery/` contains the aiohttp API routes, gallery service, state store, metadata parsing, thumbnailing, indexing, trash, folder, and source management logic.
- `gallery_ui/src/` contains the React frontend.
- `gallery_ui/dist/` is committed and served by ComfyUI at `/gallery/`.
- `web/comfyui/top_menu_extension.js` adds the ComfyUI top-menu entry and workflow handoff bridge.
- `data/` stores runtime gallery state, source configuration, SQLite index, thumbnail cache, trash, and prompt JSON libraries.

## Build And Verification

Use these from the repository root unless noted:

```powershell
cd gallery_ui
cmd /c node_modules\.bin\tsc.cmd -b
cmd /c node_modules\.bin\vite.cmd build
cd ..
D:\comfyui\ComfyUI-aki-v1.5\ComfyUI-aki-v1.5\python\python.exe -m compileall py\gallery
```

The machine used for this project may not have `python` or `py` on `PATH`; prefer the bundled ComfyUI Python path above when available.

After `vite build`, ComfyUI or a browser may still request older hashed assets. Preserve compatibility by copying the latest generated CSS content to all tracked `gallery_ui/dist/assets/index-*.css` files and the latest generated JS content to all tracked `index-*.js` files before committing release-ready dist changes.

## Frontend Behavior To Preserve

- Gallery uses a three-column shell: left resource navigation, center content, right Inspector on desktop.
- Trash does not use the right Inspector; it keeps its own bulk toolbar.
- Default selection mode is off. Single click opens image detail unless the user enables default selection mode in Settings.
- Selection mode supports click-select, left-button box select, Shift range select, right-click menus, and bulk actions.
- The filter popover is compact: fixed header, scrollable body, fixed footer, current-filter chips, compact sorting controls, compact color palette, date range, and Pin state.
- Color filtering is backed by the backend index. A color family must meet the 25% threshold to match.
- Opening a workflow in ComfyUI should first try the existing ComfyUI page through `BroadcastChannel`, `postMessage`, and `localStorage` before opening a new page.
- Right-click and detail actions include copying the positive prompt and viewing Metadata.

## Safety Notes

- Gallery file APIs must stay scoped to registered gallery sources and supported image extensions.
- Source configuration must validate paths, writable status, and import targets.
- Write operations and source settings need same-origin protection.
- Import APIs should keep file size, total request size, and file count limits.

