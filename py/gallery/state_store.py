from __future__ import annotations

import os
import shutil
import time
import uuid
from datetime import datetime
from threading import RLock

from .. import paths as gallery_paths
from ..paths import load_gallery_state, normalize_relative_path, save_gallery_state


GALLERY_STATE_LOCK = RLock()


def ensure_gallery_state_shape(state: dict | None = None) -> dict:
    state = state if isinstance(state, dict) else load_gallery_state()
    if not isinstance(state.get("images"), dict):
        state["images"] = {}
    if not isinstance(state.get("boards"), dict):
        state["boards"] = {}
    return state


def create_gallery_state_backup() -> str:
    with GALLERY_STATE_LOCK:
        state_file = gallery_paths.GALLERY_STATE_FILE
        if not os.path.exists(state_file):
            return ""
        timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
        backup_path = f"{state_file}.bak-{timestamp}"
        counter = 1
        while os.path.exists(backup_path):
            backup_path = f"{state_file}.bak-{timestamp}-{counter}"
            counter += 1
        shutil.copy2(state_file, backup_path)
        return backup_path


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
    with GALLERY_STATE_LOCK:
        state = ensure_gallery_state_shape()
        relative_path = normalize_relative_path(relative_path)
        return normalize_image_state(state.setdefault("images", {}).get(relative_path, {}))


def get_image_state_map(state: dict | None = None) -> dict[str, dict]:
    with GALLERY_STATE_LOCK:
        state = ensure_gallery_state_shape(state)
        images = state.setdefault("images", {})
        return {normalize_relative_path(relative_path): normalize_image_state(image_state) for relative_path, image_state in images.items()}


def image_state_has_custom_data(image_state: dict | None) -> bool:
    normalized = normalize_image_state(image_state)
    return bool(
        normalized["pinned"]
        or normalized["boards"]
        or normalized["category"]
        or normalized["title"]
        or normalized["notes"]
    )


def merge_image_states(target_state: dict | None, incoming_state: dict | None) -> dict:
    target = normalize_image_state(target_state)
    incoming = normalize_image_state(incoming_state)
    board_ids = normalize_board_ids([*target["boards"], *incoming["boards"]])
    pinned = bool(target["pinned"] or incoming["pinned"] or board_ids)
    return {
        "favorite": pinned,
        "pinned": pinned,
        "boards": board_ids,
        "category": target["category"] or incoming["category"],
        "title": target["title"] or incoming["title"],
        "notes": target["notes"] or incoming["notes"],
        "updated_at": max(int(target["updated_at"] or 0), int(incoming["updated_at"] or 0)),
    }


def migrate_missing_image_states(
    existing_paths: set[str],
    candidate_paths: list[str] | set[str],
    *,
    create_backup: bool = True,
) -> dict[str, object]:
    with GALLERY_STATE_LOCK:
        state = ensure_gallery_state_shape()
        images = state.setdefault("images", {})
        normalized_existing = {normalize_relative_path(path) for path in existing_paths if normalize_relative_path(path)}
        normalized_candidates = sorted({normalize_relative_path(path) for path in candidate_paths if normalize_relative_path(path)})

        migrated: dict[str, str] = {}
        unresolved: list[str] = []
        changed = False
        backup_path = ""

        for raw_path in list(images.keys()):
            old_path = normalize_relative_path(raw_path)
            if not old_path or old_path in normalized_existing:
                continue
            old_state = normalize_image_state(images.get(raw_path, {}))
            if not image_state_has_custom_data(old_state):
                continue

            suffix = f"/{old_path}"
            matches = [path for path in normalized_candidates if path.endswith(suffix)]
            if len(matches) != 1:
                unresolved.append(old_path)
                continue

            new_path = matches[0]
            if create_backup and not backup_path:
                backup_path = create_gallery_state_backup()
            images.pop(raw_path, None)
            images[new_path] = merge_image_states(images.get(new_path, {}), old_state)
            touch_board_covers(state, old_path, new_path)
            migrated[old_path] = new_path
            changed = True

        if changed:
            save_gallery_state(state)

        return {
            "migrated": migrated,
            "unresolved": unresolved,
            "backup_path": backup_path,
        }


def update_image_state(relative_path: str, updates: dict) -> tuple[dict, list[str]]:
    with GALLERY_STATE_LOCK:
        state = ensure_gallery_state_shape()
        images = state.setdefault("images", {})
        relative_path = normalize_relative_path(relative_path)
        current = normalize_image_state(images.get(relative_path, {}))
        has_board_update = "boards" in updates
        has_pin_update = "pinned" in updates or "favorite" in updates
        pinned = bool(updates.get("pinned", updates.get("favorite", current["pinned"])))
        next_boards = normalize_board_ids(updates.get("boards", current["boards"]))
        if has_pin_update and not pinned and not has_board_update:
            next_boards = []
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
    with GALLERY_STATE_LOCK:
        state = ensure_gallery_state_shape()
        images = state.setdefault("images", {})
        for relative_path in relative_paths:
            images.pop(normalize_relative_path(relative_path), None)
        save_gallery_state(state)
        return collect_categories(state)


def rename_image_state(old_relative_path: str, new_relative_path: str) -> tuple[dict, list[str]]:
    with GALLERY_STATE_LOCK:
        state = ensure_gallery_state_shape()
        images = state.setdefault("images", {})
        old_relative_path = normalize_relative_path(old_relative_path)
        new_relative_path = normalize_relative_path(new_relative_path)
        existing = normalize_image_state(images.pop(old_relative_path, default_image_state()))
        images[new_relative_path] = existing
        touch_board_covers(state, old_relative_path, new_relative_path)
        save_gallery_state(state)
        return existing, collect_categories(state)


def move_image_states(path_mapping: dict[str, str]) -> list[str]:
    with GALLERY_STATE_LOCK:
        state = ensure_gallery_state_shape()
        images = state.setdefault("images", {})

        for old_relative_path, new_relative_path in path_mapping.items():
            old_relative_path = normalize_relative_path(old_relative_path)
            new_relative_path = normalize_relative_path(new_relative_path)
            if old_relative_path == new_relative_path:
                continue
            existing = normalize_image_state(images.pop(old_relative_path, default_image_state()))
            images[new_relative_path] = existing
            touch_board_covers(state, old_relative_path, new_relative_path)

        save_gallery_state(state)
        return collect_categories(state)


def extract_image_states(relative_paths: list[str]) -> tuple[dict[str, dict], list[str]]:
    with GALLERY_STATE_LOCK:
        state = ensure_gallery_state_shape()
        images = state.setdefault("images", {})
        extracted: dict[str, dict] = {}

        for relative_path in relative_paths:
            relative_path = normalize_relative_path(relative_path)
            if relative_path in images:
                extracted[relative_path] = normalize_image_state(images.pop(relative_path))
                remove_path_from_board_covers(state, relative_path)

        save_gallery_state(state)
        return extracted, collect_categories(state)


def extract_image_states_by_prefix(prefix: str) -> tuple[dict[str, dict], list[str]]:
    with GALLERY_STATE_LOCK:
        state = ensure_gallery_state_shape()
        images = state.setdefault("images", {})
        normalized_prefix = normalize_relative_path(prefix)
        extracted: dict[str, dict] = {}

        for relative_path in list(images.keys()):
            if relative_path == normalized_prefix or relative_path.startswith(f"{normalized_prefix}/"):
                extracted[relative_path] = normalize_image_state(images.pop(relative_path))
                remove_path_from_board_covers(state, relative_path)

        save_gallery_state(state)
        return extracted, collect_categories(state)


def restore_image_states(mapping: dict[str, dict]) -> list[str]:
    with GALLERY_STATE_LOCK:
        state = ensure_gallery_state_shape()
        images = state.setdefault("images", {})

        for relative_path, image_state in mapping.items():
            images[normalize_relative_path(relative_path)] = normalize_image_state(image_state)

        save_gallery_state(state)
        return collect_categories(state)


def remove_image_states_by_prefix(prefix: str) -> list[str]:
    with GALLERY_STATE_LOCK:
        state = ensure_gallery_state_shape()
        images = state.setdefault("images", {})
        normalized_prefix = normalize_relative_path(prefix)
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
    with GALLERY_STATE_LOCK:
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
    with GALLERY_STATE_LOCK:
        state = ensure_gallery_state_shape(state)
        boards = {}
        for board_id, raw_board in state.get("boards", {}).items():
            board = normalize_board(str(board_id), raw_board)
            boards[board["id"]] = board
        return boards


def create_board(name: str, description: str = "") -> dict:
    with GALLERY_STATE_LOCK:
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
    with GALLERY_STATE_LOCK:
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
    with GALLERY_STATE_LOCK:
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
    with GALLERY_STATE_LOCK:
        state = ensure_gallery_state_shape()
        boards = state.setdefault("boards", {})
        if board_id not in boards:
            raise FileNotFoundError("board not found")

        images = state.setdefault("images", {})
        updated: list[str] = []
        for relative_path in relative_paths:
            relative_path = normalize_relative_path(relative_path)
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
