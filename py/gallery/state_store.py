from __future__ import annotations

from ..paths import load_gallery_state, save_gallery_state


def default_image_state() -> dict:
    return {
        "favorite": False,
        "category": "",
        "title": "",
        "notes": "",
        "updated_at": 0,
    }


def get_image_state(relative_path: str) -> dict:
    state = load_gallery_state()
    return {**default_image_state(), **state.setdefault("images", {}).get(relative_path, {})}


def update_image_state(relative_path: str, updates: dict) -> tuple[dict, list[str]]:
    import time

    state = load_gallery_state()
    images = state.setdefault("images", {})
    current = {**default_image_state(), **images.get(relative_path, {})}
    current.update(
        {
            "favorite": bool(updates.get("favorite", current["favorite"])),
            "category": str(updates.get("category", current["category"])).strip(),
            "title": str(updates.get("title", current["title"])).strip(),
            "notes": str(updates.get("notes", current["notes"])).strip(),
            "updated_at": int(time.time()),
        }
    )
    images[relative_path] = current
    save_gallery_state(state)
    return current, collect_categories(state)


def remove_image_states(relative_paths: list[str]) -> list[str]:
    state = load_gallery_state()
    images = state.setdefault("images", {})
    for relative_path in relative_paths:
        images.pop(relative_path, None)
    save_gallery_state(state)
    return collect_categories(state)


def rename_image_state(old_relative_path: str, new_relative_path: str) -> tuple[dict, list[str]]:
    state = load_gallery_state()
    images = state.setdefault("images", {})
    existing = images.pop(old_relative_path, default_image_state())
    images[new_relative_path] = existing
    save_gallery_state(state)
    return existing, collect_categories(state)


def move_image_states(path_mapping: dict[str, str]) -> list[str]:
    state = load_gallery_state()
    images = state.setdefault("images", {})

    for old_relative_path, new_relative_path in path_mapping.items():
        if old_relative_path == new_relative_path:
            continue
        existing = images.pop(old_relative_path, default_image_state())
        images[new_relative_path] = existing

    save_gallery_state(state)
    return collect_categories(state)


def extract_image_states(relative_paths: list[str]) -> tuple[dict[str, dict], list[str]]:
    state = load_gallery_state()
    images = state.setdefault("images", {})
    extracted: dict[str, dict] = {}

    for relative_path in relative_paths:
      if relative_path in images:
          extracted[relative_path] = images.pop(relative_path)

    save_gallery_state(state)
    return extracted, collect_categories(state)


def extract_image_states_by_prefix(prefix: str) -> tuple[dict[str, dict], list[str]]:
    state = load_gallery_state()
    images = state.setdefault("images", {})
    normalized_prefix = prefix.strip("/").strip()
    extracted: dict[str, dict] = {}

    for relative_path in list(images.keys()):
      if relative_path == normalized_prefix or relative_path.startswith(f"{normalized_prefix}/"):
          extracted[relative_path] = images.pop(relative_path)

    save_gallery_state(state)
    return extracted, collect_categories(state)


def restore_image_states(mapping: dict[str, dict]) -> list[str]:
    state = load_gallery_state()
    images = state.setdefault("images", {})

    for relative_path, image_state in mapping.items():
      images[relative_path] = image_state

    save_gallery_state(state)
    return collect_categories(state)


def remove_image_states_by_prefix(prefix: str) -> list[str]:
    state = load_gallery_state()
    images = state.setdefault("images", {})
    normalized_prefix = prefix.strip("/").strip()
    if not normalized_prefix:
        return collect_categories(state)

    matched_keys = [
        relative_path
        for relative_path in list(images.keys())
        if relative_path == normalized_prefix or relative_path.startswith(f"{normalized_prefix}/")
    ]
    for relative_path in matched_keys:
        images.pop(relative_path, None)

    save_gallery_state(state)
    return collect_categories(state)


def collect_categories(state: dict | None = None) -> list[str]:
    state = state or load_gallery_state()
    categories = {
        str(item.get("category", "")).strip()
        for item in state.get("images", {}).values()
        if str(item.get("category", "")).strip()
    }
    return sorted(categories, key=lambda value: value.lower())
