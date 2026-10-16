"""Generate/check current CHANGELOG and GitHub body from bilingual JSON."""
import argparse
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--check", action="store_true")
parser.add_argument("--body", choices=["en", "zh-CN"])
args = parser.parse_args()
version = re.search(r'^version\s*=\s*"([^"]+)"', (root / "pyproject.toml").read_text(), re.M)[1]
note = json.loads((root / "docs/releases" / f"{version}.json").read_text(encoding="utf-8"))
assert note["version"] == version and note["date"], "Invalid release metadata"
assert set(note["locales"]) == {"en", "zh-CN"}, "Both release-note languages are required"

def render(locale):
    sections = note["locales"][locale]
    assert sections and all(section["title"] and section["items"] and all(section["items"]) for section in sections)
    return "\n\n".join(f"### {section['title']}\n" + "\n".join(f"- {item}" for item in section["items"]) for section in sections)

body = render("zh-CN") + "\n\n" + render("en")
section = f"## {version} - {note['date']}\n\n{body}\n\n"
path = root / "CHANGELOG.md"
text = path.read_text(encoding="utf-8-sig")
match = re.search(rf"(?ms)^## v?{re.escape(version)}[^\n]*\n.*?(?=^## |\Z)", text)
if args.body:
    print(render(args.body))
elif args.check:
    assert match and match.group().strip() == section.strip(), "Release notes and CHANGELOG differ"
    print(f"Bilingual release notes verified: {version}")
else:
    if match:
        text = text[:match.start()] + section + text[match.end():]
    else:
        offset = text.index("\n") + 1
        text = text[:offset] + "\n" + section + text[offset:].lstrip()
    path.write_text(text, encoding="utf-8")
