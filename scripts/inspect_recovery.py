"""Read-only inspection of unresolved file-operation journals.

Usage: python scripts/inspect_recovery.py /path/to/plugin/data
Stop ComfyUI and back up both files and data before manual recovery.
This script never executes paths, moves files, or rewrites metadata.
"""
import argparse
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("data_dir", type=Path)
args = parser.parse_args()
found = 0
for path in sorted((args.data_dir / "operation_journal").glob("*.json")):
    try:
        record = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        print(f"UNREADABLE {path}: {error}")
        found += 1
        continue
    if record.get("status") in {"committed", "rolled_back"}:
        continue
    found += 1
    print(f"\n{record.get('status', 'unknown').upper()}: {path}")
    print(f"Error: {record.get('error', '(interrupted before completion)')}")
    for entry in record.get("entries", []):
        for key in ("source", "staging", "target"):
            location = entry.get(key, "")
            exists = Path(location).exists() if location else False
            print(f"  {key:8} {'EXISTS ' if exists else 'missing'} {location}")
    print("State snapshot is stored in state_before. Inspect before restoring; do not blindly replay paths.")
print(f"\nUnresolved journals: {found}")
raise SystemExit(1 if found else 0)
