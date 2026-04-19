# ComfyUI Universal Extractor

`ComfyUI Universal Extractor` is a custom node plus a full web workspace for managing prompt libraries and browsing generated images inside ComfyUI.

It is built for two common real-world workflows:

1. Reusing large prompt libraries such as artist, style, character, and utility snippets.
2. Reviewing generated images later, adding notes/categories/favorites, and searching those annotations back quickly.

The project includes:

- A ComfyUI node: `Universal Extractor`
- A built-in gallery UI at `/gallery/`
- Library CRUD tools for `data/*.json`
- Image metadata editing with searchable notes
- Prompt helper tools such as artist string generation and format conversion

## What It Does

### 1. Universal Extractor Node

The node reads a JSON library from `data/` and returns a prompt string.

Features:

- Switch between multiple JSON libraries directly from the node
- Random or sequential extraction
- Prefix / suffix / separator formatting
- Works with simple string arrays and richer object-style entries

Supported entry shapes include:

```json
[
  "greg rutkowski",
  "wlop",
  "alphonse mucha"
]
```

and:

```json
[
  {
    "name": "tapioka_(coconuts)",
    "prompt": "tapioka_(coconuts)",
    "other_names": ["tapioka"],
    "tags": ["artist", "anime"],
    "model": "SDXL"
  }
]
```

### 2. Built-in Gallery

Open the gallery at:

- `http://127.0.0.1:8188/gallery/`

or use the top menu button added inside ComfyUI.

Features:

- Browse output images with thumbnails and detail viewer
- Open image metadata and embedded workflow info
- Edit title, category, favorite, and notes
- Save notes for later search
- Search images by filename, title, category, and notes
- Right-click image menu for common actions
- Trash / restore workflow

### 3. Library Workspace

The library workspace is designed for both beginners and heavy users.

Features:

- Manage `data/*.json` directly in the browser
- Search current library entries
- Create, import, merge, replace, export, and delete libraries
- Add single entries with starter templates
- Edit large libraries as JSON when needed
- Copy prompt text or full JSON from an entry
- View lightweight library insights such as tag/model usage

### 4. Workbench Tools

Includes helper tools for prompt assembly:

- Artist string generation
- Searchable artist pool
- Anima format conversion
- Custom format conversion

Example Anima conversion:

- `inari_(ambercrown)` -> `@inari \(ambercrown\)`
- `tapioka_(coconuts)` -> `@tapioka \(coconuts\)`

## Installation

### Option 1: Clone into `custom_nodes`

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/Tera-Dark/ComfyUI-Universal-Extractor.git
```

Restart ComfyUI after cloning.

### Option 2: Download ZIP

Download the repository ZIP, extract it into:

```text
ComfyUI/custom_nodes/ComfyUI-Universal-Extractor
```

Then restart ComfyUI.

## Frontend Build

This repository keeps the built frontend in `gallery_ui/dist`, so normal users can install and use it directly.

If you modify the frontend source, rebuild with:

```bash
cd gallery_ui
npm install
npm run build
```

## How To Use

### Use the Node

Find the node in:

```text
Universal Tools -> Universal Extractor
```

Inputs:

- `file_name`: pick a JSON library from `data/`
- `extract_count`: how many items to extract
- `mode`: `random` or `sequential`
- `prefix`: prepend text to each item
- `suffix`: append text to each item
- `separator`: join extracted items
- `seed`: seed for reproducible results

Output:

- `Prompt (STRING)`

### Use the Gallery

The gallery is meant for post-generation organization:

- Open an image
- Add title / category / notes
- Save
- Search later with the top search bar using note text or category text

### Use the Library Workspace

Recommended beginner workflow:

1. Create or open a library
2. Start with a template entry
3. Fill `name`, `prompt`, aliases, tags, and model notes
4. Test the result in the workbench
5. Refine entries over time instead of trying to perfect everything at once

## Repository Structure

```text
.
├─ api/
├─ data/                  # prompt libraries and runtime state
├─ gallery_ui/            # React + Vite frontend
├─ nodes/
├─ py/
│  ├─ gallery/            # gallery routes, metadata, services, state store
│  └─ nodes/
├─ web/comfyui/           # ComfyUI frontend integration
├─ __init__.py
└─ README.md
```

## Notes About Data Files

The repository is set up so runtime-only files are not meant to be committed, such as:

- `data/gallery_state.json`
- `data/thumb_cache/`
- `data/trash/`
- `data/trash_state.json`
- local `output/`

Only reusable example libraries should be kept in `data/`.

## Development Notes

- Backend: Python
- Frontend: React + TypeScript + Vite
- ComfyUI integration: custom routes + top menu injection

If the gallery page does not update after frontend edits, rebuild `gallery_ui/dist` and restart ComfyUI.

## Current Focus

This project is optimized around practical ComfyUI usage:

- fast library reuse
- searchable image review
- lightweight annotation workflow
- prompt helper tools for repeated runs

If you use ComfyUI heavily and keep large personal JSON prompt collections, this plugin is designed to make that workflow much easier to maintain.
