"""Portable release metadata check. No ComfyUI or optional modules required."""
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parents[1]
version = re.search(r'^version\s*=\s*"([^"]+)"', (root / "pyproject.toml").read_text(), re.M)[1]
package = json.loads((root / "gallery_ui/package.json").read_text())
lock = json.loads((root / "gallery_ui/package-lock.json").read_text())
assert version == package["version"] == lock["version"] == lock["packages"][""]["version"], "Version mismatch"
assert f"## {version}" in (root / "CHANGELOG.md").read_text(encoding="utf-8-sig"), "Missing changelog"
index = (root / "gallery_ui/dist/index.html").read_text()
assets = re.findall(r'(?:src|href)="/gallery/([^"?#]+)"', index)
assert assets, "Missing built assets"
for asset in assets:
    assert (root / "gallery_ui/dist" / asset).is_file(), f"Missing asset: {asset}"
print(f"Release metadata verified: {version}")
