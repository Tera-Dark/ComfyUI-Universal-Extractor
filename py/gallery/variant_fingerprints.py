from __future__ import annotations

import hashlib
import json
import os
import re
from typing import Any

from .image_safety import DecompressionBombError, guarded_image_open
from .metadata import read_image_metadata
from .recipe import build_prompt_summary

try:
    from PIL import Image

    HAS_PIL = True
except ImportError:
    HAS_PIL = False


FINGERPRINT_VERSION = "1"
DHASH_SIZE = 8
FILENAME_SEQUENCE_RE = re.compile(
    r"^(?P<base>.+?)(?:[_\-\s]+(?P<number>\d{3,})(?:[_\-\s]*(?:upscaled?|hires|final|edit|基础生图|最终成图|系数放大))*)$",
    re.IGNORECASE,
)
FILENAME_SUFFIX_RE = re.compile(r"[_\-\s]+(?:upscaled?|hires|final|edit|基础生图|最终成图|系数放大)$", re.IGNORECASE)


def stable_json_hash(value: Any) -> str:
    if value in (None, "", {}, []):
        return ""
    try:
        payload = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    except TypeError:
        payload = str(value)
    payload = payload.strip()
    if not payload:
        return ""
    return hashlib.sha256(payload.encode("utf-8", errors="ignore")).hexdigest()


def text_hash(value: str) -> str:
    normalized = " ".join(str(value or "").split())
    if not normalized:
        return ""
    return hashlib.sha256(normalized.encode("utf-8", errors="ignore")).hexdigest()


def filename_group_key(filename: str) -> str:
    stem = os.path.splitext(os.path.basename(filename))[0].strip()
    if not stem:
        return ""
    normalized = stem.replace("\\", "/").split("/")[-1]
    match = FILENAME_SEQUENCE_RE.match(normalized)
    if match:
        base = match.group("base")
        return " ".join(FILENAME_SUFFIX_RE.sub("", base).replace("_", " ").replace("-", " ").split()).casefold()
    stripped = FILENAME_SUFFIX_RE.sub("", normalized).strip()
    return " ".join(stripped.replace("_", " ").replace("-", " ").split()).casefold() if stripped != normalized else ""


def dhash(image_path: str) -> str:
    if not HAS_PIL:
        return ""
    try:
        with guarded_image_open(image_path) as image:
            resample = getattr(Image, "Resampling", Image).LANCZOS
            grayscale = image.convert("L").resize((DHASH_SIZE + 1, DHASH_SIZE), resample)
            pixels = list(grayscale.getdata())
    except DecompressionBombError:
        raise
    except Exception:
        return ""

    bits = []
    for row in range(DHASH_SIZE):
        offset = row * (DHASH_SIZE + 1)
        for column in range(DHASH_SIZE):
            bits.append(1 if pixels[offset + column] > pixels[offset + column + 1] else 0)

    value = 0
    for bit in bits:
        value = (value << 1) | bit
    return f"{value:016x}"


def hamming_distance_hex(left: str, right: str) -> int:
    if not left or not right:
        return 999
    try:
        return (int(left, 16) ^ int(right, 16)).bit_count()
    except ValueError:
        return 999


def build_metadata_hashes(image_path: str) -> tuple[str, str]:
    metadata = read_image_metadata(image_path)
    if not metadata:
        return "", ""

    summary = build_prompt_summary(metadata)
    prompt_payload = {
        "positive": summary.get("positive_prompt") or "",
        "negative": summary.get("negative_prompt") or "",
        "size": summary.get("size") or "",
    }
    prompt_hash = stable_json_hash(prompt_payload)

    workflow = metadata.get("workflow")
    prompt_graph = metadata.get("prompt")
    workflow_hash = stable_json_hash(workflow if workflow not in (None, "", {}, []) else prompt_graph)
    return prompt_hash, workflow_hash


def build_image_fingerprint(image_path: str, filename: str) -> dict[str, Any]:
    error = ""
    visual_hash = ""
    prompt_hash = ""
    workflow_hash = ""
    file_hash = ""
    try:
        hasher = hashlib.sha256()
        with open(image_path, "rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                hasher.update(chunk)
        file_hash = hasher.hexdigest()
    except Exception as exc:
        error = str(exc)
    try:
        visual_hash = dhash(image_path)
    except DecompressionBombError as exc:
        error = str(exc)
    try:
        prompt_hash, workflow_hash = build_metadata_hashes(image_path)
    except Exception as exc:
        error = error or str(exc)

    return {
        "visual_hash": visual_hash,
        "file_hash": file_hash,
        "prompt_hash": prompt_hash,
        "workflow_hash": workflow_hash,
        "filename_group_key": filename_group_key(filename),
        "error": error,
        "version": FINGERPRINT_VERSION,
    }
