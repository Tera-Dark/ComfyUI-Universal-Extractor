"""Journaled two-phase image moves with conservative in-process rollback.

Journals are evidence for recovery, never instructions executed automatically.
A process/power failure cannot be made atomic across files and JSON; pending
journals include original paths, staging paths, destinations and state snapshot.
Do not delete a pending journal or its staging files before manual recovery.
"""
from __future__ import annotations

import os
import errno
import json
from pathlib import Path
import shutil
import uuid
from threading import RLock

from ..paths import save_json

FILE_OPERATION_LOCK = RLock()


def _transfer_file(source, target):
    """No-clobber transfer. Copy exclusively across devices; clean partial copies."""
    if os.path.isdir(source):
        # Directory moves must be atomic on one filesystem. Never silently
        # copy/delete a tree across volumes; use per-image moves in that case.
        if os.path.lexists(target):
            raise FileExistsError(target)
        os.rename(source, target)
        return
    owned = False
    try:
        try:
            os.link(source, target)
            owned = True
        except OSError as error:
            if error.errno not in {errno.EXDEV, errno.EPERM, errno.EOPNOTSUPP, errno.ENOSYS}:
                raise
            with open(source, "rb") as incoming, open(target, "xb") as outgoing:
                owned = True
                shutil.copyfileobj(incoming, outgoing, 1024 * 1024)
                outgoing.flush()
                os.fsync(outgoing.fileno())
            shutil.copystat(source, target)
        os.unlink(source)
    except Exception:
        if owned:
            os.unlink(target)
        raise


def execute_moves(moves, journal_dir, commit_state, rollback_state, state_snapshot):
    """Stage all sources first so swaps and cycles are safe. Caller owns state lock."""
    for existing_journal in Path(journal_dir).glob("*.json"):
        try:
            status = json.loads(existing_journal.read_text(encoding="utf-8")).get("status")
        except (OSError, ValueError, AttributeError):
            status = "unknown"
        if status not in {"committed", "rolled_back"}:
            raise RuntimeError(f"Unresolved file operation: {existing_journal}. Stop ComfyUI and inspect recovery before more file operations.")
    moves = [(os.path.abspath(a), os.path.abspath(b)) for a, b in moves if a != b]
    if not moves:
        return commit_state()
    sources = {os.path.normcase(a) for a, _ in moves}
    targets = {os.path.normcase(b) for _, b in moves}
    if len(sources) != len(moves) or len(targets) != len(moves):
        raise ValueError("duplicate source or destination")
    for source, target in moves:
        if not (os.path.isfile(source) or os.path.isdir(source)):
            raise FileNotFoundError(source)
        if os.path.lexists(target) and os.path.normcase(target) not in sources:
            raise FileExistsError(target)
    transaction_id = uuid.uuid4().hex
    entries = [
        {"source": a, "target": b,
         "staging": os.path.join(os.path.dirname(a), f".ue-move-{transaction_id}-{i}.tmp"),
         "phase": "source"}
        for i, (a, b) in enumerate(moves)
    ]
    journal_path = os.path.join(journal_dir, f"{transaction_id}.json")
    journal = {"version": 1, "id": transaction_id, "status": "pending",
               "entries": entries, "state_before": state_snapshot}
    save_json(journal_path, journal)
    try:
        for item in entries:
            if os.path.lexists(item["staging"]):
                raise FileExistsError(item["staging"])
            os.rename(item["source"], item["staging"])
            item["phase"] = "staging"
            save_json(journal_path, journal)
        for item in entries:
            if os.path.lexists(item["target"]):
                raise FileExistsError(item["target"])
            _transfer_file(item["staging"], item["target"])
            item["phase"] = "target"
            save_json(journal_path, journal)
        result = commit_state()
        journal["status"] = "committed"
        save_json(journal_path, journal)
    except Exception as error:
        rollback_errors = []
        # First undo every destination, then restore sources (handles cycles).
        for item in reversed(entries):
            if item["phase"] == "target":
                try:
                    if os.path.lexists(item["staging"]):
                        raise FileExistsError(item["staging"])
                    _transfer_file(item["target"], item["staging"])
                    item["phase"] = "staging"
                except Exception as rollback_error:
                    rollback_errors.append(str(rollback_error))
        for item in entries:
            if item["phase"] == "staging":
                try:
                    if os.path.lexists(item["source"]):
                        raise FileExistsError(item["source"])
                    os.rename(item["staging"], item["source"])
                    item["phase"] = "source"
                except Exception as rollback_error:
                    rollback_errors.append(str(rollback_error))
        try:
            rollback_state()
        except Exception as rollback_error:
            rollback_errors.append(str(rollback_error))
        journal.update(status="needs_recovery" if rollback_errors else "rolled_back",
                       error=str(error), rollback_errors=rollback_errors)
        try:
            save_json(journal_path, journal)
        except OSError:
            pass  # Retain the last durable journal; never obscure the original error.
        raise RuntimeError(f"File operation failed; journal: {journal_path}. {error}") from error
    # Only unresolved/failed operations retain journals. No unbounded success log.
    try:
        os.remove(journal_path)
    except OSError:
        pass  # A committed journal is harmless and explicitly labelled.
    return result
