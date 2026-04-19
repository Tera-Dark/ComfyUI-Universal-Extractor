import json
import os
from pathlib import Path

import folder_paths

from .constants import DATA_DIR, GALLERY_STATE_FILE, TRASH_DIR, TRASH_STATE_FILE


def ensure_data_dir():
    os.makedirs(DATA_DIR, exist_ok=True)


def get_output_dir() -> str:
    return folder_paths.get_output_directory()


def get_comfy_base_dir() -> str:
    base_dir = getattr(folder_paths, "base_path", "")
    if base_dir:
        return os.path.abspath(base_dir)

    output_dir = get_output_dir()
    if output_dir:
        return os.path.dirname(os.path.abspath(output_dir))

    return os.path.dirname(os.path.dirname(DATA_DIR))


def to_posix(path: str) -> str:
    return path.replace("\\", "/")


def normalize_relative_path(path: str) -> str:
    return to_posix(path).strip("/").strip()


def build_relative_display(path: str, base_dir: str) -> str:
    try:
        relative = os.path.relpath(path, base_dir)
        if relative == ".":
            return "./"
        return f"./{to_posix(relative)}"
    except Exception:
        return path


def ensure_unique_path(directory: str, filename: str) -> str:
    stem = Path(filename).stem
    suffix = Path(filename).suffix
    candidate = os.path.join(directory, filename)
    counter = 1
    while os.path.exists(candidate):
        candidate = os.path.join(directory, f"{stem}_{counter}{suffix}")
        counter += 1
    return candidate


def load_json(path: str, default):
    try:
        with open(path, "r", encoding="utf-8") as file:
            return json.load(file)
    except Exception:
        return default


def save_json(path: str, data):
    with open(path, "w", encoding="utf-8") as file:
        json.dump(data, file, ensure_ascii=False, indent=2)


def load_gallery_state() -> dict:
    ensure_data_dir()
    state = load_json(GALLERY_STATE_FILE, {"images": {}})
    if isinstance(state, dict) and isinstance(state.get("images"), dict):
        return state
    return {"images": {}}


def save_gallery_state(state: dict):
    ensure_data_dir()
    save_json(GALLERY_STATE_FILE, state)


def ensure_trash_dir():
    ensure_data_dir()
    os.makedirs(TRASH_DIR, exist_ok=True)


def load_trash_state() -> dict:
    ensure_trash_dir()
    state = load_json(TRASH_STATE_FILE, {"items": []})
    if isinstance(state, dict) and isinstance(state.get("items"), list):
        return state
    return {"items": []}


def save_trash_state(state: dict):
    ensure_trash_dir()
    save_json(TRASH_STATE_FILE, state)
