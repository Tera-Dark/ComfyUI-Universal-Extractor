"""Journaled same-volume uploads. Only files owned by a session are removed."""
from __future__ import annotations

import os
import uuid
from pathlib import Path

from ..paths import load_json, save_json


def _identity(path):
    stat = os.stat(path, follow_symlinks=False)
    return [stat.st_dev, stat.st_ino, stat.st_size, stat.st_mtime_ns]


class UploadSession:
    def __init__(self, data_dir, validate):
        self.id = uuid.uuid4().hex
        self.journal = Path(data_dir) / "upload_journal" / f"{self.id}.json"
        self.validate = validate
        self.entries = []
        self.status = "receiving"

    def save(self):
        save_json(str(self.journal), {"version": 1, "id": self.id, "status": self.status, "entries": self.entries})

    def add(self, target, kind):
        self.validate(target, kind)
        target = Path(target).resolve()
        # A batch can contain repeated filenames before any final file exists.
        reserved = {entry["target"] for entry in self.entries}
        counter, initial = 1, target
        while str(target) in reserved or target.exists():
            target = initial.with_name(f"{initial.stem}_{counter}{initial.suffix}")
            counter += 1
        stage = target.parent / ".ue-uploads" / self.id / f"{len(self.entries)}.part"
        if stage.parent.resolve() != stage.parent or stage.parent.parent.is_symlink():
            raise ValueError("unsafe upload staging directory")
        stage.parent.mkdir(parents=True, exist_ok=True)
        entry = {"target": str(target), "stage": str(stage), "kind": kind, "identity": None, "published": False}
        self.entries.append(entry)
        self.save()  # Evidence exists before the first byte is written.
        with stage.open("xb"):
            pass
        return len(self.entries) - 1

    def write(self, index, chunk):
        with open(self.entries[index]["stage"], "ab") as stream:
            stream.write(chunk)

    def commit(self):
        try:
            for entry in self.entries:
                self.validate(entry["target"], entry["kind"])
                with open(entry["stage"], "rb+") as stream:
                    os.fsync(stream.fileno())
                entry["identity"] = _identity(entry["stage"])
            self.status = "committing"
            self.save()
            for entry in self.entries:
                # Exclusive publication; never replace an existing user file.
                # Staging on the target volume makes identity-based rollback possible.
                os.link(entry["stage"], entry["target"])
                entry["published"] = True
                self.save()
            self.status = "committed"
            self.save()
        except BaseException:
            self.abort()
            raise
        self.cleanup()
        return self.entries

    def cleanup(self):
        for entry in self.entries:
            stage = Path(entry["stage"])
            if stage.exists():
                stage.unlink()
            try:
                stage.parent.rmdir()
                stage.parent.parent.rmdir()
            except OSError:
                pass
        self.journal.unlink(missing_ok=True)

    def abort(self):
        if self.status == "committed":
            self.cleanup()
            return
        for entry in self.entries:
            target = Path(entry["target"])
            identity = entry.get("identity")
            if identity and target.exists():
                if _identity(target) != identity:
                    if entry.get("published"):
                        raise RuntimeError(f"Upload needs manual recovery: {self.journal}")
                    continue
                stage = Path(entry["stage"])
                if not stage.exists() or not os.path.samefile(stage, target):
                    raise RuntimeError(f"Upload ownership cannot be verified: {self.journal}")
                target.unlink()
        self.cleanup()


def recover_uploads(data_dir, validate):
    """Startup only, before accepting uploads. Never infer ownership from age."""
    errors = []
    for journal in (Path(data_dir) / "upload_journal").glob("*.json"):
        try:
            data = load_json(str(journal), {})
            session_id = data["id"]
            if len(session_id) != 32 or any(c not in "0123456789abcdef" for c in session_id) or journal.stem != session_id:
                raise ValueError("invalid upload session")
            entries = data["entries"]
            for number, entry in enumerate(entries):
                validate(entry["target"], entry["kind"])
                target = Path(entry["target"]).resolve()
                expected = target.parent / ".ue-uploads" / session_id / f"{number}.part"
                if Path(entry["stage"]) != expected or expected.resolve() != expected:
                    raise ValueError("unsafe upload journal")
            session = object.__new__(UploadSession)
            session.id, session.journal, session.entries = session_id, journal, entries
            session.status = data["status"]
            session.validate = validate
            session.abort()
        except Exception as error:
            errors.append(f"{journal}: {error}")
    return errors
