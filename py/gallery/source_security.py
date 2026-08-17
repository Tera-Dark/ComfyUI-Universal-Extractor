from __future__ import annotations

import os
from typing import Any

from ..constants import SUPPORTED_IMAGE_EXTENSIONS
from ..paths import get_comfy_base_dir, get_input_dir, get_output_dir


def real_abs(path: str) -> str:
    return os.path.realpath(os.path.abspath(os.path.expanduser(str(path or "").strip())))


def ensure_within_directory(root_dir: str, full_path: str, label: str = "source") -> str:
    normalized_root = real_abs(root_dir)
    normalized_path = real_abs(full_path)
    try:
        common = os.path.commonpath([normalized_root, normalized_path])
    except ValueError as error:
        raise ValueError("invalid path") from error

    if common != normalized_root:
        raise ValueError(f"path must stay within {label} directory")
    return normalized_path


def env_flag(name: str) -> bool:
    return str(os.environ.get(name, "")).strip().lower() in {"1", "true", "yes", "on"}


def path_is_within_any(path: str, roots: list[str]) -> bool:
    normalized_path = real_abs(path)
    for root in roots:
        if not root:
            continue
        try:
            if os.path.commonpath([real_abs(root), normalized_path]) == real_abs(root):
                return True
        except ValueError:
            continue
    return False


def safe_source_roots() -> list[str]:
    return [path for path in [get_comfy_base_dir(), get_output_dir(), get_input_dir()] if path]


def external_sources_allowed() -> bool:
    return env_flag("UNIVERSAL_EXTRACTOR_ALLOW_EXTERNAL_SOURCES")


def validate_source_path(source: dict[str, Any]) -> str:
    path = source.get("path", "")
    if not path:
        raise ValueError("source path required")

    full_path = real_abs(path)
    if not os.path.isdir(full_path):
        raise FileNotFoundError("source directory not found")
    if not os.access(full_path, os.R_OK):
        raise ValueError("source directory is not readable")
    if not external_sources_allowed() and not path_is_within_any(full_path, safe_source_roots()):
        raise ValueError(
            "custom source path must stay within the ComfyUI directory; "
            "set UNIVERSAL_EXTRACTOR_ALLOW_EXTERNAL_SOURCES=1 to allow external read-only sources"
        )
    return full_path


def harden_source(source: dict[str, Any]) -> dict[str, Any]:
    hardened = {**source}
    try:
        full_path = validate_source_path(hardened)
    except (FileNotFoundError, ValueError) as error:
        hardened["enabled"] = False
        hardened["writable"] = False
        hardened["import_target"] = False
        hardened["exists"] = bool(hardened.get("path") and os.path.isdir(os.path.expanduser(str(hardened.get("path")))))
        hardened["security_error"] = str(error)
        return hardened

    within_safe_root = path_is_within_any(full_path, safe_source_roots())
    requested_writable = bool(hardened.get("writable"))
    writable = requested_writable and within_safe_root and os.access(full_path, os.W_OK)
    if requested_writable and not within_safe_root:
        hardened["security_error"] = "external source directories are read-only"
    if hardened.get("writable") and not writable:
        hardened["security_error"] = hardened.get("security_error") or "source directory is not writable"
    hardened["path"] = full_path
    hardened["exists"] = True
    hardened["writable"] = writable
    if not writable:
        hardened["import_target"] = False
    return hardened


def ensure_supported_image_path(path: str):
    if not path.lower().endswith(SUPPORTED_IMAGE_EXTENSIONS):
        raise ValueError("path must reference a supported image file")
    if os.path.exists(path) and not os.path.isfile(path):
        raise ValueError("path must reference a regular image file")
