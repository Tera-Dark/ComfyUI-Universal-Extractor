from __future__ import annotations

import uuid

from ..paths import normalize_relative_path

IMAGE_REF_SEPARATOR = "::"
DEFAULT_OUTPUT_SOURCE_ID = "default_output"
DEFAULT_INPUT_SOURCE_ID = "default_input"


def sanitize_source_id(value: str) -> str:
    clean = "".join(ch if ch.isalnum() or ch in {"_", "-"} else "_" for ch in str(value or "").strip())
    clean = clean.strip("_-").lower()
    return clean or f"source_{uuid.uuid4().hex[:10]}"


def make_image_ref(source_id: str, relative_path: str) -> str:
    normalized_path = normalize_relative_path(relative_path)
    clean_source_id = sanitize_source_id(source_id)
    if clean_source_id == DEFAULT_OUTPUT_SOURCE_ID:
        return normalized_path
    return f"{clean_source_id}{IMAGE_REF_SEPARATOR}{normalized_path}"


def parse_image_ref(image_ref: str) -> tuple[str, str]:
    value = str(image_ref or "").strip()
    if IMAGE_REF_SEPARATOR in value:
        source_id, relative_path = value.split(IMAGE_REF_SEPARATOR, 1)
        source_id = sanitize_source_id(source_id)
        relative_path = normalize_relative_path(relative_path)
    else:
        source_id = DEFAULT_OUTPUT_SOURCE_ID
        relative_path = normalize_relative_path(value)
    if not relative_path:
        raise ValueError("relative_path required")
    return source_id, relative_path


def make_folder_ref(source_id: str, subfolder: str = "") -> str:
    return f"{sanitize_source_id(source_id)}{IMAGE_REF_SEPARATOR}{normalize_relative_path(subfolder)}"


def parse_folder_ref(folder_ref: str) -> tuple[str, str]:
    value = str(folder_ref or "").strip()
    if IMAGE_REF_SEPARATOR in value:
        source_id, subfolder = value.split(IMAGE_REF_SEPARATOR, 1)
        return sanitize_source_id(source_id), normalize_relative_path(subfolder)
    return DEFAULT_OUTPUT_SOURCE_ID, normalize_relative_path(value)
