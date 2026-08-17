from __future__ import annotations

import asyncio
import json
import re
import time
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from ..constants import PLUGIN_DIR


GITHUB_REPO = "Tera-Dark/ComfyUI-Universal-Extractor"
GITHUB_RELEASES_URL = f"https://api.github.com/repos/{GITHUB_REPO}/releases?per_page=5"
GITHUB_REPOSITORY_URL = f"https://github.com/{GITHUB_REPO}"
UPDATE_CACHE_SECONDS = 30 * 60
CHANGELOG_PATH = Path(PLUGIN_DIR) / "CHANGELOG.md"

_UPDATE_CACHE: dict[str, Any] | None = None
_UPDATE_CACHE_TS = 0.0


def _read_current_version() -> str:
    pyproject = Path(PLUGIN_DIR) / "pyproject.toml"
    try:
        text = pyproject.read_text(encoding="utf-8")
    except OSError:
        return "0.0.0"
    match = re.search(r'(?m)^version\s*=\s*"([^"]+)"', text)
    return match.group(1).strip() if match else "0.0.0"


def _version_parts(value: str) -> list[int]:
    clean = str(value or "").strip().lstrip("vV").split("-", 1)[0]
    parts: list[int] = []
    for piece in clean.split("."):
        match = re.match(r"(\d+)", piece)
        parts.append(int(match.group(1)) if match else 0)
    while len(parts) < 3:
        parts.append(0)
    return parts[:3]


def _compare_versions(left: str, right: str) -> int:
    left_parts = _version_parts(left)
    right_parts = _version_parts(right)
    return (left_parts > right_parts) - (left_parts < right_parts)


def _release_version(release: dict[str, Any]) -> str:
    tag = str(release.get("tag_name") or release.get("name") or "").strip()
    return tag.lstrip("vV")


def _normalize_release(release: dict[str, Any]) -> dict[str, Any]:
    version = _release_version(release)
    return {
        "version": version,
        "tag_name": str(release.get("tag_name") or version),
        "name": str(release.get("name") or release.get("tag_name") or version),
        "body": str(release.get("body") or ""),
        "url": str(release.get("html_url") or GITHUB_REPOSITORY_URL),
        "published_at": str(release.get("published_at") or ""),
    }


def _read_local_changelog_body(version: str) -> str:
    try:
        text = CHANGELOG_PATH.read_text(encoding="utf-8")
    except OSError:
        return ""

    current_header = re.compile(rf"(?m)^##\s+v?{re.escape(version)}(?:\s+-[^\n]*)?\s*$")
    match = current_header.search(text)
    if not match:
        return ""

    next_match = re.search(r"(?m)^##\s+", text[match.end() :])
    section = text[match.end() : match.end() + next_match.start()] if next_match else text[match.end() :]
    return section.strip()


def _local_release(version: str) -> dict[str, Any] | None:
    body = _read_local_changelog_body(version)
    if not body:
        return None
    return {
        "version": version,
        "tag_name": f"v{version}",
        "name": f"v{version}",
        "body": body,
        "url": f"{GITHUB_REPOSITORY_URL}/releases/tag/v{version}",
        "published_at": "",
    }


def _merge_local_release_notes(releases: list[dict[str, Any]], current_version: str) -> list[dict[str, Any]]:
    local = _local_release(current_version)
    if not local:
        return releases

    merged: list[dict[str, Any]] = []
    inserted = False
    for release in releases:
        if release["version"] == current_version:
            merged.append({**release, "body": release["body"] or local["body"]})
            inserted = True
        else:
            merged.append(release)

    if not inserted:
        if not merged or _compare_versions(current_version, merged[0]["version"]) >= 0:
            return [local, *merged]
        merged.append(local)
    return merged


def _fetch_releases_from_github() -> list[dict[str, Any]]:
    request = Request(
        GITHUB_RELEASES_URL,
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "ComfyUI-Universal-Extractor",
            "X-GitHub-Api-Version": "2022-11-28",
        },
    )
    with urlopen(request, timeout=8) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, list):
        raise ValueError("GitHub releases response was not a list")
    return [release for release in payload if isinstance(release, dict)]


def _build_status(releases: list[dict[str, Any]], *, error: str = "") -> dict[str, Any]:
    current_version = _read_current_version()
    stable_releases = [
        release
        for release in releases
        if not release.get("draft") and not release.get("prerelease") and _release_version(release)
    ]
    normalized = _merge_local_release_notes([_normalize_release(release) for release in stable_releases[:5]], current_version)
    latest = normalized[0] if normalized else None
    latest_version = latest["version"] if latest else current_version
    if _compare_versions(current_version, latest_version) > 0:
        latest_version = current_version
        latest = next((release for release in normalized if release["version"] == current_version), None)
    return {
        "current_version": current_version,
        "latest_version": latest_version,
        "update_available": _compare_versions(latest_version, current_version) > 0,
        "release_url": latest["url"] if latest else GITHUB_REPOSITORY_URL,
        "repository_url": GITHUB_REPOSITORY_URL,
        "checked_at": int(time.time()),
        "error": error,
        "releases": normalized,
    }


async def check_update_status(*, force: bool = False) -> dict[str, Any]:
    global _UPDATE_CACHE, _UPDATE_CACHE_TS

    now = time.time()
    if not force and _UPDATE_CACHE and now - _UPDATE_CACHE_TS < UPDATE_CACHE_SECONDS:
        return _UPDATE_CACHE

    try:
        releases = await asyncio.to_thread(_fetch_releases_from_github)
        status = _build_status(releases)
        _UPDATE_CACHE = status
        _UPDATE_CACHE_TS = now
        return status
    except (HTTPError, URLError, TimeoutError, OSError, ValueError, json.JSONDecodeError) as error:
        fallback = _build_status([], error=str(error))
        if _UPDATE_CACHE:
            return {**_UPDATE_CACHE, "checked_at": int(now), "error": str(error)}
        return fallback
