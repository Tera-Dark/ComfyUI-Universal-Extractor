"""Authoritative resource identity and task storage; never rebuilt as a cache."""
from __future__ import annotations

import hashlib
import os
import sqlite3
import time
import uuid
from pathlib import Path
from threading import RLock

from .sqlite_batch import ClosingConnection


class CatalogUnavailable(RuntimeError):
    pass


def source_namespace(root):
    return hashlib.sha256(os.path.normcase(os.path.realpath(root)).encode("utf-8")).hexdigest()


class Catalog:
    VERSION = 1

    def __init__(self, data_dir):
        self.path = Path(data_dir) / "catalog.sqlite3"
        self.lock = RLock()
        self.anchor = None
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            with self.connect() as db:
                version = db.execute("PRAGMA user_version").fetchone()[0]
                if version > self.VERSION:
                    raise CatalogUnavailable("Catalog is newer than this plugin; restore matching code.")
                if version and version < self.VERSION:
                    backup = sqlite3.connect(str(self.path) + f".bak-{time.time_ns()}")
                    try:
                        db.backup(backup)
                    finally:
                        backup.close()
                db.executescript("""
                    CREATE TABLE IF NOT EXISTS assets(
                      asset_id TEXT PRIMARY KEY, source_id TEXT NOT NULL,
                      namespace TEXT NOT NULL, relative_path TEXT NOT NULL,
                      location_key TEXT NOT NULL, availability TEXT NOT NULL,
                      media_type TEXT NOT NULL DEFAULT 'image', first_seen_at REAL NOT NULL,
                      content_revision INTEGER NOT NULL DEFAULT 1,
                      observed_size INTEGER NOT NULL, mtime_ns INTEGER NOT NULL,
                      trash_id TEXT NOT NULL DEFAULT '');
                    CREATE UNIQUE INDEX IF NOT EXISTS assets_live_location
                      ON assets(source_id, namespace, location_key)
                      WHERE availability IN ('online','missing');
                    CREATE INDEX IF NOT EXISTS assets_trash ON assets(trash_id);
                    CREATE INDEX IF NOT EXISTS assets_location_history ON assets(source_id, location_key);
                    CREATE TABLE IF NOT EXISTS catalog_meta(key TEXT PRIMARY KEY, value INTEGER NOT NULL);
                    INSERT OR IGNORE INTO catalog_meta VALUES('generation',0);
                    CREATE TABLE IF NOT EXISTS catalog_migrations(version INTEGER PRIMARY KEY, applied_at REAL NOT NULL);
                    CREATE TABLE IF NOT EXISTS jobs(
                      id TEXT PRIMARY KEY, kind TEXT NOT NULL, dedupe_key TEXT NOT NULL,
                      payload TEXT NOT NULL, state TEXT NOT NULL, completed INTEGER NOT NULL DEFAULT 0,
                      total INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '',
                      attempts INTEGER NOT NULL DEFAULT 0, created_at REAL NOT NULL,
                      updated_at REAL NOT NULL, retry_at REAL NOT NULL DEFAULT 0,
                      cancel_requested INTEGER NOT NULL DEFAULT 0, result TEXT);
                    CREATE INDEX IF NOT EXISTS jobs_state_time ON jobs(state, updated_at);
                    CREATE UNIQUE INDEX IF NOT EXISTS jobs_active_key ON jobs(dedupe_key)
                      WHERE state IN ('queued','running','cancelling');
                """)
                db.execute("INSERT OR IGNORE INTO catalog_migrations VALUES(?,?)", (self.VERSION, time.time()))
                db.execute(f"PRAGMA user_version={self.VERSION}")
            # Keep WAL open without retaining a transaction. Closing the last
            # connection after every tiny update forces repeated checkpoints.
            self.anchor = sqlite3.connect(self.path, check_same_thread=False)
            self.anchor.execute("SELECT value FROM catalog_meta LIMIT 1").fetchall()
        except (sqlite3.DatabaseError, OSError) as error:
            raise CatalogUnavailable(f"Catalog unavailable; preserve {self.path} and its WAL files: {error}") from error

    def close(self):
        if self.anchor:
            self.anchor.close()
            self.anchor = None

    def connect(self):
        db = sqlite3.connect(self.path, timeout=5, factory=ClosingConnection)
        try:
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA busy_timeout=5000")
            db.execute("PRAGMA journal_mode=WAL")
        except BaseException:
            db.close()
            raise
        return db

    def generation(self):
        with self.connect() as db:
            return db.execute("SELECT value FROM catalog_meta WHERE key='generation'").fetchone()[0]

    def observe_many(self, source, records):
        """Called at scan/commit boundaries, never per-card during a hot list."""
        namespace = source_namespace(source["path"])
        result = []
        with self.lock, self.connect() as db:
            for relative_path, size, mtime_ns in records:
                key = os.path.normcase(relative_path.replace("\\", "/"))
                row = db.execute("SELECT * FROM assets WHERE source_id=? AND namespace=? AND location_key=? AND availability IN ('online','missing')", (source["id"], namespace, key)).fetchone()
                if row:
                    revision = row["content_revision"] + int((row["observed_size"], row["mtime_ns"]) != (size, mtime_ns))
                    db.execute("UPDATE assets SET availability='online',relative_path=?,observed_size=?,mtime_ns=?,content_revision=? WHERE asset_id=?", (relative_path, size, mtime_ns, revision, row["asset_id"]))
                    asset_id = row["asset_id"]
                else:
                    asset_id, revision = str(uuid.uuid4()), 1
                    db.execute("INSERT INTO assets(asset_id,source_id,namespace,relative_path,location_key,availability,first_seen_at,observed_size,mtime_ns) VALUES(?,?,?,?,?,'online',?,?,?)", (asset_id, source["id"], namespace, relative_path, key, time.time(), size, mtime_ns))
                result.append({"asset_id": asset_id, "content_revision": revision})
        return result

    def find(self, source, relative_path):
        with self.connect() as db:
            row = db.execute("SELECT * FROM assets WHERE source_id=? AND namespace=? AND location_key=? AND availability IN ('online','missing')", (source["id"], source_namespace(source["path"]), os.path.normcase(relative_path.replace("\\", "/")))).fetchone()
            return dict(row) if row else None

    def get(self, asset_id):
        with self.connect() as db:
            row = db.execute("SELECT * FROM assets WHERE asset_id=?", (asset_id,)).fetchone()
            return dict(row) if row else None

    def tracks_location(self, source_id, relative_path):
        # Include old namespaces and tombstones: a known identity must never be
        # reassigned by legacy suffix-based annotation recovery.
        with self.connect() as db:
            return db.execute("SELECT 1 FROM assets WHERE source_id=? AND location_key=? LIMIT 1",
                              (source_id, os.path.normcase(relative_path.replace("\\", "/")))).fetchone() is not None

    def snapshot(self, ids):
        return [row for asset_id in ids if (row := self.get(asset_id))]

    def apply(self, changes):
        with self.lock, self.connect() as db:
            # Temporarily release live location uniqueness for swaps/cycles.
            for item in changes:
                db.execute("UPDATE assets SET availability='relocating' WHERE asset_id=?", (item["asset_id"],))
            for item in changes:
                db.execute("UPDATE assets SET source_id=?,namespace=?,relative_path=?,location_key=?,availability=?,trash_id=? WHERE asset_id=?", (item["source_id"], item["namespace"], item["relative_path"], item["location_key"], item["availability"], item.get("trash_id", ""), item["asset_id"]))
            db.execute("UPDATE catalog_meta SET value=value+1 WHERE key='generation'")

    def mark_missing(self, source, paths):
        with self.lock, self.connect() as db:
            db.executemany("UPDATE assets SET availability='missing' WHERE source_id=? AND namespace=? AND location_key=? AND availability='online'", [(source["id"], source_namespace(source["path"]), os.path.normcase(path)) for path in paths])

    def trash_assets(self, trash_id):
        with self.connect() as db:
            return [dict(row) for row in db.execute("SELECT * FROM assets WHERE trash_id=? AND availability='trashed'", (trash_id,))]

    def purge(self, trash_id):
        with self.lock, self.connect() as db:
            db.execute("UPDATE assets SET availability='purged' WHERE trash_id=? AND availability='trashed'", (trash_id,))
            db.execute("UPDATE catalog_meta SET value=value+1 WHERE key='generation'")
