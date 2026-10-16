"""Installed release notes, available without network access."""
from __future__ import annotations

import json
import re
from pathlib import Path

from ..constants import PLUGIN_DIR

NOTES_DIR = Path(PLUGIN_DIR) / "docs" / "releases"


def render_notes(note, locale="zh-CN"):
    sections = note["locales"][locale]
    return "\n\n".join(f"### {section['title']}\n" + "\n".join(f"- {item}" for item in section["items"])
                       for section in sections)


def installed_release_notes(current_version, locale="zh-CN"):
    locale = "en" if locale == "en" else "zh-CN"
    releases = {}
    for path in sorted(NOTES_DIR.glob("*.json"), reverse=True):
        note = json.loads(path.read_text(encoding="utf-8"))
        version = note["version"]
        releases[version] = {"version": version, "tag_name": f"v{version}", "name": f"v{version}",
                             "body": render_notes(note, locale), "published_at": note["date"],
                             "url": f"https://github.com/Tera-Dark/ComfyUI-Universal-Extractor/releases/tag/v{version}",
                             "source": "local"}
    # Older releases remain readable even before structured notes were used.
    try:
        changelog = (Path(PLUGIN_DIR) / "CHANGELOG.md").read_text(encoding="utf-8-sig")
    except OSError:
        changelog = ""
    for match in re.finditer(r"(?ms)^## v?(\d+\.\d+\.\d+)(?:[^\n]*)\n(.*?)(?=^## |\Z)", changelog):
        version, body = match.groups()
        releases.setdefault(version, {"version": version, "tag_name": f"v{version}", "name": f"v{version}",
                                      "body": body.strip(), "published_at": "", "source": "changelog", "url": ""})
    def key(value):
        return tuple(int(part) for part in value.split("."))
    eligible = sorted((v for v in releases if key(v) <= key(current_version)), key=key, reverse=True)
    versions = ([current_version] if current_version in releases else []) + [v for v in eligible if v != current_version]
    return {"current_version": current_version, "source": "local", "releases": [releases[v] for v in versions[:5]]}
