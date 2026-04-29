from __future__ import annotations

import time
import uuid

from ..paths import load_gallery_state, save_gallery_state


def ensure_gallery_state_shape(state: dict | None = None) -> dict:
    state = state if isinstance(state, dict) else load_gallery_state()
    if not isinstance(state.get("images"), dict):
        state["images"] = {}
    if not isinstance(state.get("boards"), dict):
        state["boards"] = {}
    return state


def normalize_board_ids(value) -> list[str]:
    if not isinstance(value, list):
        return []
    seen: set[str] = set()
    board_ids: list[str] = []
    for item in value:
        board_id = str(item).strip()
        if not board_id or board_id in seen:
            continue
        seen.add(board_id)
        board_ids.append(board_id)
    return board_ids


def default_image_state() -> dict:
    return {
        "favorite": False,
        "pinned": False,
        "boards": [],
        "category": "",
        "title": "",
        "notes": "",
        "updated_at": 0,
    }


def normalize_image_state(raw_state: dict | None = None) -> dict:
    raw_state = raw_state if isinstance(raw_state, dict) else {}
    pinned = bool(raw_state.get("pinned", raw_state.get("favorite", False)))
    return {
        "favorite": pinned,
        "pinned": pinned,
        "boards": normalize_board_ids(raw_state.get("boards", [])),
        "category": str(raw_state.get("category", "")).strip(),
        "title": str(raw_state.get("title", "")).strip(),
        "notes": str(raw_state.get("notes", "")).strip(),
        "updated_at": int(raw_state.get("updated_at") or 0),
    }


def get_image_state(relative_path: str) -> dict:
    state = ensure_gallery_state_shape()
    return normalize_image_state(state.setdefault("images", {}).get(relative_path, {}))


def update_image_state(relative_path: str, updates: dict) -> tuple[dict, list[str]]:
    state = ensure_gallery_state_shape()
    images = state.setdefault("images", {})
    current = normalize_image_state(images.get(relative_path, {}))
    next_boards = normalize_board_ids(updates.get("boards", current["boards"]))
    pinned = bool(updates.get("pinned", updates.get("favorite", current["pinned"])))
    if next_boards:
        pinned = True
    current.update(
        {
            "favorite": pinned,
            "pinned": pinned,
            "boards": next_boards,
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
    state = ensure_gallery_state_shape()
    images = state.setdefault("images", {})
    for relative_path in relative_paths:
        images.pop(relative_path, None)
    save_gallery_state(state)
    return collect_categories(state)


def rename_image_state(old_relative_path: str, new_relative_path: str) -> tuple[dict, list[str]]:
    state = ensure_gallery_state_shape()
    images = state.setdefault("images", {})
    existing = normalize_image_state(images.pop(old_relative_path, default_image_state()))
    images[new_relative_path] = existing
    touch_board_covers(state, old_relative_path, new_relative_path)
    save_gallery_state(state)
    return existing, collect_categories(state)


def move_image_states(path_mapping: dict[str, str]) -> list[str]:
    state = ensure_gallery_state_shape()
    images = state.setdefault("images", {})

    for old_relative_path, new_relative_path in path_mapping.items():
        if old_relative_path == new_relative_path:
            continue
        existing = normalize_image_state(images.pop(old_relative_path, default_image_state()))
        images[new_relative_path] = existing
        touch_board_covers(state, old_relative_path, new_relative_path)

    save_gallery_state(state)
    return collect_categories(state)


def extract_image_states(relative_paths: list[str]) -> tuple[dict[str, dict], list[str]]:
    state = ensure_gallery_state_shape()
    images = state.setdefault("images", {})
    extracted: dict[str, dict] = {}

    for relative_path in relative_paths:
      if relative_path in images:
          extracted[relative_path] = normalize_image_state(images.pop(relative_path))
          remove_path_from_board_covers(state, relative_path)

    save_gallery_state(state)
    return extracted, collect_categories(state)


def extract_image_states_by_prefix(prefix: str) -> tuple[dict[str, dict], list[str]]:
    state = ensure_gallery_state_shape()
    images = state.setdefault("images", {})
    normalized_prefix = prefix.strip("/").strip()
    extracted: dict[str, dict] = {}

    for relative_path in list(images.keys()):
      if relative_path == normalized_prefix or relative_path.startswith(f"{normalized_prefix}/"):
          extracted[relative_path] = normalize_image_state(images.pop(relative_path))
          remove_path_from_board_covers(state, relative_path)

    save_gallery_state(state)
    return extracted, collect_categories(state)


def restore_image_states(mapping: dict[str, dict]) -> list[str]:
    state = ensure_gallery_state_shape()
    images = state.setdefault("images", {})

    for relative_path, image_state in mapping.items():
      images[relative_path] = normalize_image_state(image_state)

    save_gallery_state(state)
    return collect_categories(state)


def remove_image_states_by_prefix(prefix: str) -> list[str]:
    state = ensure_gallery_state_shape()
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
        remove_path_from_board_covers(state, relative_path)

    save_gallery_state(state)
    return collect_categories(state)


def collect_categories(state: dict | None = None) -> list[str]:
    state = ensure_gallery_state_shape(state)
    categories = {
        str(item.get("category", "")).strip()
        for item in state.get("images", {}).values()
        if str(item.get("category", "")).strip()
    }
    return sorted(categories, key=lambda value: value.lower())


def normalize_board(board_id: str, raw_board: dict | None = None) -> dict:
    raw_board = raw_board if isinstance(raw_board, dict) else {}
    now = int(time.time())
    return {
        "id": str(raw_board.get("id") or board_id),
        "name": str(raw_board.get("name") or "").strip() or "Untitled board",
        "description": str(raw_board.get("description") or "").strip(),
        "cover": str(raw_board.get("cover") or "").strip(),
        "created_at": int(raw_board.get("created_at") or now),
        "updated_at": int(raw_board.get("updated_at") or raw_board.get("created_at") or now),
    }


def get_raw_boards(state: dict | None = None) -> dict[str, dict]:
    state = ensure_gallery_state_shape(state)
    boards = {}
    for board_id, raw_board in state.get("boards", {}).items():
        board = normalize_board(str(board_id), raw_board)
        boards[board["id"]] = board
    return boards


def create_board(name: str, description: str = "") -> dict:
    clean_name = str(name or "").strip()
    if not clean_name:
        raise ValueError("board name required")
    state = ensure_gallery_state_shape()
    board_id = uuid.uuid4().hex
    now = int(time.time())
    board = {
        "id": board_id,
        "name": clean_name,
        "description": str(description or "").strip(),
        "cover": "",
        "created_at": now,
        "updated_at": now,
    }
    state.setdefault("boards", {})[board_id] = board
    save_gallery_state(state)
    return board


def update_board(board_id: str, updates: dict) -> dict:
    state = ensure_gallery_state_shape()
    boards = state.setdefault("boards", {})
    if board_id not in boards:
        raise FileNotFoundError("board not found")
    current = normalize_board(board_id, boards.get(board_id, {}))
    if "name" in updates:
        name = str(updates.get("name") or "").strip()
        if not name:
            raise ValueError("board name required")
        current["name"] = name
    if "description" in updates:
        current["description"] = str(updates.get("description") or "").strip()
    if "cover" in updates:
        current["cover"] = str(updates.get("cover") or "").strip()
    current["updated_at"] = int(time.time())
    boards[board_id] = current
    save_gallery_state(state)
    return current


def delete_board(board_id: str) -> list[str]:
    state = ensure_gallery_state_shape()
    boards = state.setdefault("boards", {})
    if board_id not in boards:
        raise FileNotFoundError("board not found")
    boards.pop(board_id, None)
    images = state.setdefault("images", {})
    for relative_path, raw_image_state in list(images.items()):
        image_state = normalize_image_state(raw_image_state)
        if board_id not in image_state["boards"]:
            continue
        image_state["boards"] = [item for item in image_state["boards"] if item != board_id]
        image_state["pinned"] = bool(image_state["boards"]) or image_state["pinned"]
        image_state["favorite"] = image_state["pinned"]
        image_state["updated_at"] = int(time.time())
        images[relative_path] = image_state
    save_gallery_state(state)
    return collect_categories(state)


def set_image_board_membership(relative_paths: list[str], board_id: str, pinned: bool = True) -> tuple[list[str], list[str]]:
    state = ensure_gallery_state_shape()
    boards = state.setdefault("boards", {})
    if board_id not in boards:
        raise FileNotFoundError("board not found")

    images = state.setdefault("images", {})
    updated: list[str] = []
    for relative_path in relative_paths:
        image_state = normalize_image_state(images.get(relative_path, {}))
        board_ids = image_state["boards"]
        if pinned and board_id not in board_ids:
            board_ids.append(board_id)
        if not pinned:
            board_ids = [item for item in board_ids if item != board_id]
        image_state["boards"] = board_ids
        image_state["pinned"] = pinned or bool(board_ids) or image_state["pinned"]
        if not board_ids and not pinned:
            image_state["pinned"] = False
        image_state["favorite"] = image_state["pinned"]
        image_state["updated_at"] = int(time.time())
        images[relative_path] = image_state
        updated.append(relative_path)

    board = normalize_board(board_id, boards.get(board_id, {}))
    board["updated_at"] = int(time.time())
    boards[board_id] = board
    save_gallery_state(state)
    return updated, collect_categories(state)


def touch_board_covers(state: dict, old_relative_path: str, new_relative_path: str):
    for board_id, raw_board in list(state.setdefault("boards", {}).items()):
        board = normalize_board(board_id, raw_board)
        if board.get("cover") == old_relative_path:
            board["cover"] = new_relative_path
            board["updated_at"] = int(time.time())
            state["boards"][board_id] = board


def remove_path_from_board_covers(state: dict, relative_path: str):
    for board_id, raw_board in list(state.setdefault("boards", {}).items()):
        board = normalize_board(board_id, raw_board)
        if board.get("cover") == relative_path:
            board["cover"] = ""
            board["updated_at"] = int(time.time())
            state["boards"][board_id] = board
