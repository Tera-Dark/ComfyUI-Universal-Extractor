"""indexing domain. Dependencies are injected by the host."""
from __future__ import annotations

import os
import json
import uuid
import time
import shutil
import sqlite3
import hashlib
import colorsys
from threading import Lock, BoundedSemaphore
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from typing import Any
from pathlib import Path
from .execution import QUERY_ONLY, DEFER_INDEX_REFRESH
from .jobs import checkpoint, CURRENT_JOB

def _is_gallery_index_corruption(env, error: BaseException) -> bool:
    if not isinstance(error, sqlite3.DatabaseError):
        return False
    message = str(error).lower()
    return any(marker in message for marker in env.GALLERY_INDEX_CORRUPTION_MARKERS)


def _unique_gallery_index_quarantine_path(env, path: str) -> str:
    timestamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    candidate = f"{path}.corrupt-{timestamp}"
    counter = 1
    while os.path.exists(candidate):
        candidate = f"{path}.corrupt-{timestamp}-{counter}"
        counter += 1
    return candidate


def _quarantine_gallery_index_db(env, reason: str) -> list[str]:
    env.get_runtime().release_index_anchor()
    quarantined: list[str] = []
    for path in (env.GALLERY_INDEX_DB_FILE, f"{env.GALLERY_INDEX_DB_FILE}-wal", f"{env.GALLERY_INDEX_DB_FILE}-shm"):
        if not os.path.exists(path):
            continue
        target = env._unique_gallery_index_quarantine_path(path)
        os.replace(path, target)
        quarantined.append(target)
    if quarantined:
        print(
            "[Universal Extractor] Gallery SQLite index looked corrupt and was moved aside "
            f"for rebuild: {reason}"
        )
    return quarantined


def _gallery_index_file_has_invalid_header(env) -> bool:
    if not os.path.exists(env.GALLERY_INDEX_DB_FILE) or os.path.getsize(env.GALLERY_INDEX_DB_FILE) == 0:
        return False
    try:
        with open(env.GALLERY_INDEX_DB_FILE, "rb") as file:
            header = file.read(16)
    except OSError:
        return False
    return header != b"SQLite format 3\x00"


def _record_gallery_index_migration(env,
    connection: sqlite3.Connection,
    migration_id: str,
    from_version: int,
    to_version: int,
):
    connection.execute(
        """
        INSERT OR IGNORE INTO gallery_schema_migrations(id, applied_at, from_version, to_version)
        VALUES(?, ?, ?, ?)
        """,
        (migration_id, time.time(), from_version, to_version),
    )


def _apply_gallery_index_migrations(env, connection: sqlite3.Connection):
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS gallery_schema_migrations (
            id TEXT PRIMARY KEY,
            applied_at REAL NOT NULL,
            from_version INTEGER NOT NULL,
            to_version INTEGER NOT NULL
        )
        """
    )
    current_version = int(connection.execute("PRAGMA user_version").fetchone()[0])
    if current_version < env.GALLERY_INDEX_SCHEMA_VERSION:
        env._record_gallery_index_migration(
            connection,
            f"schema-{current_version}-to-{env.GALLERY_INDEX_SCHEMA_VERSION}",
            current_version,
            env.GALLERY_INDEX_SCHEMA_VERSION,
        )
        connection.execute(f"PRAGMA user_version = {env.GALLERY_INDEX_SCHEMA_VERSION}")


def _initialize_gallery_index_db(env, connection: sqlite3.Connection):
    connection.row_factory = sqlite3.Row
    connection.execute(f"PRAGMA busy_timeout={env.GALLERY_INDEX_BUSY_TIMEOUT_MS}")
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA synchronous=NORMAL")
    connection.execute("CREATE TABLE IF NOT EXISTS gallery_folders(source_id TEXT NOT NULL,relative_path TEXT NOT NULL,source_path TEXT NOT NULL,modified_at INTEGER NOT NULL,PRIMARY KEY(source_id,relative_path))")
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS gallery_images (
            relative_path TEXT PRIMARY KEY,
            source_id TEXT NOT NULL,
            source_relative_path TEXT NOT NULL,
            filename TEXT NOT NULL,
            relative_dir TEXT NOT NULL,
            subfolder TEXT NOT NULL,
            display_subfolder TEXT NOT NULL,
            size INTEGER NOT NULL,
            image_width INTEGER NOT NULL DEFAULT 0,
            image_height INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL,
            modified_at INTEGER NOT NULL,
            title TEXT NOT NULL DEFAULT '',
            category TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT '',
            pinned INTEGER NOT NULL DEFAULT 0,
            boards_text TEXT NOT NULL DEFAULT '',
            dominant_color TEXT NOT NULL DEFAULT '',
            color_family TEXT NOT NULL DEFAULT '',
            color_families_text TEXT NOT NULL DEFAULT '',
            color_family_scores_json TEXT NOT NULL DEFAULT '{}',
            palette_json TEXT NOT NULL DEFAULT '[]',
            color_saturation REAL NOT NULL DEFAULT 0,
            color_luma REAL NOT NULL DEFAULT 0,
            scanned_at REAL NOT NULL
        )
        """
    )
    columns = {row["name"] for row in connection.execute("PRAGMA table_info(gallery_images)").fetchall()}
    for column_name, column_definition in {
        "asset_id": "TEXT NOT NULL DEFAULT ''",
        "content_revision": "INTEGER NOT NULL DEFAULT 1",
        "title": "TEXT NOT NULL DEFAULT ''",
        "category": "TEXT NOT NULL DEFAULT ''",
        "notes": "TEXT NOT NULL DEFAULT ''",
        "pinned": "INTEGER NOT NULL DEFAULT 0",
        "boards_text": "TEXT NOT NULL DEFAULT ''",
        "image_width": "INTEGER NOT NULL DEFAULT 0",
        "image_height": "INTEGER NOT NULL DEFAULT 0",
        "dominant_color": "TEXT NOT NULL DEFAULT ''",
        "color_family": "TEXT NOT NULL DEFAULT ''",
        "color_families_text": "TEXT NOT NULL DEFAULT ''",
        "color_family_scores_json": "TEXT NOT NULL DEFAULT '{}'",
        "palette_json": "TEXT NOT NULL DEFAULT '[]'",
        "color_saturation": "REAL NOT NULL DEFAULT 0",
        "color_luma": "REAL NOT NULL DEFAULT 0",
    }.items():
        if column_name not in columns:
            connection.execute(f"ALTER TABLE gallery_images ADD COLUMN {column_name} {column_definition}")
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS gallery_index_meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS gallery_image_color_family (
            relative_path TEXT NOT NULL,
            family TEXT NOT NULL,
            score REAL NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY(relative_path, family)
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS gallery_image_fingerprints (
            relative_path TEXT PRIMARY KEY,
            source_id TEXT NOT NULL DEFAULT '',
            file_size INTEGER NOT NULL DEFAULT 0,
            modified_at INTEGER NOT NULL DEFAULT 0,
            file_hash TEXT NOT NULL DEFAULT '',
            visual_hash TEXT NOT NULL DEFAULT '',
            prompt_hash TEXT NOT NULL DEFAULT '',
            workflow_hash TEXT NOT NULL DEFAULT '',
            filename_group_key TEXT NOT NULL DEFAULT '',
            error TEXT NOT NULL DEFAULT '',
            indexed_at REAL NOT NULL DEFAULT 0,
            version TEXT NOT NULL DEFAULT ''
        )
        """
    )
    try:
        connection.execute(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS gallery_images_fts
            USING fts5(relative_path UNINDEXED, search_text, tokenize='trigram')
            """
        )
        connection.execute(
            "INSERT OR IGNORE INTO gallery_index_meta(key, value) VALUES('fts_available', '1')"
        )
    except sqlite3.OperationalError as error:
        connection.execute(
            "INSERT OR REPLACE INTO gallery_index_meta(key, value) VALUES('fts_available', '0')"
        )
        print(f"[Universal Extractor] Gallery FTS unavailable, falling back to LIKE search: {error}")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_images_source ON gallery_images(source_id)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_images_created ON gallery_images(created_at DESC)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_images_dir ON gallery_images(relative_dir)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_images_category ON gallery_images(category)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_images_pinned ON gallery_images(pinned)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_images_color_family ON gallery_images(color_family)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_images_source_dir_created ON gallery_images(source_id, relative_dir, created_at DESC)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_images_pinned_created ON gallery_images(pinned, created_at DESC)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_images_category_created ON gallery_images(category, created_at DESC)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_images_color_created ON gallery_images(color_family, created_at DESC)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_images_filename_nocase ON gallery_images(filename COLLATE NOCASE)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_images_size_desc ON gallery_images(size DESC)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_images_stable_created ON gallery_images(created_at DESC,relative_path ASC)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_images_source_stable_created ON gallery_images(source_id,created_at DESC,relative_path ASC)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_images_source_stable_filename ON gallery_images(source_id,filename COLLATE NOCASE DESC,relative_path ASC)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_images_color_status ON gallery_images(dominant_color,color_family_scores_json)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_color_family_created ON gallery_image_color_family(family, created_at DESC)")
    fingerprint_columns = {row["name"] for row in connection.execute("PRAGMA table_info(gallery_image_fingerprints)").fetchall()}
    if "file_hash" not in fingerprint_columns:
        connection.execute("ALTER TABLE gallery_image_fingerprints ADD COLUMN file_hash TEXT NOT NULL DEFAULT ''")
    for name, definition in {"asset_id": "TEXT NOT NULL DEFAULT ''", "content_revision": "INTEGER NOT NULL DEFAULT 0"}.items():
        if name not in fingerprint_columns:
            connection.execute(f"ALTER TABLE gallery_image_fingerprints ADD COLUMN {name} {definition}")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_fingerprint_file ON gallery_image_fingerprints(file_hash)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_fingerprint_visual ON gallery_image_fingerprints(visual_hash)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_fingerprint_prompt ON gallery_image_fingerprints(prompt_hash)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_fingerprint_workflow ON gallery_image_fingerprints(workflow_hash)")
    connection.execute("CREATE INDEX IF NOT EXISTS idx_gallery_fingerprint_filename_group ON gallery_image_fingerprints(filename_group_key)")
    env._apply_gallery_index_migrations(connection)
    connection.commit()


def _connect_gallery_index_db(env) -> sqlite3.Connection:
    if QUERY_ONLY.get():
        connection = sqlite3.connect(Path(env.GALLERY_INDEX_DB_FILE).resolve().as_uri() + "?mode=ro", uri=True,
            timeout=env.GALLERY_INDEX_BUSY_TIMEOUT_MS / 1000, factory=env.ClosingConnection)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA query_only=ON")
        return connection
    env.ensure_data_dir()
    runtime = env.get_runtime()
    if env._gallery_index_file_has_invalid_header():
        env._quarantine_gallery_index_db("invalid sqlite header")
        runtime.index_initialized.clear()
    connection = sqlite3.connect(env.GALLERY_INDEX_DB_FILE, timeout=env.GALLERY_INDEX_BUSY_TIMEOUT_MS / 1000, factory=env.ClosingConnection)
    connection.row_factory = sqlite3.Row
    connection.execute(f"PRAGMA busy_timeout={env.GALLERY_INDEX_BUSY_TIMEOUT_MS}")
    identity = (env.GALLERY_INDEX_DB_FILE, os.stat(env.GALLERY_INDEX_DB_FILE).st_ino)
    try:
        if identity not in runtime.index_initialized:
            env._initialize_gallery_index_db(connection)
            runtime.index_initialized.add(identity)
            if runtime.index_anchor is None:
                runtime.index_anchor = sqlite3.connect(env.GALLERY_INDEX_DB_FILE, check_same_thread=False)
                runtime.index_anchor.execute("SELECT value FROM gallery_index_meta LIMIT 1").fetchall()
    except sqlite3.DatabaseError as error:
        connection.close()
        if not env._is_gallery_index_corruption(error):
            raise
        env._quarantine_gallery_index_db(str(error))
        runtime.index_initialized.clear()
        return env._connect_gallery_index_db()
    return connection


def _index_meta_get(env, connection: sqlite3.Connection, key: str) -> str:
    row = connection.execute("SELECT value FROM gallery_index_meta WHERE key = ?", (key,)).fetchone()
    return str(row["value"]) if row else ""


def _index_meta_set(env, connection: sqlite3.Connection, key: str, value: str):
    connection.execute(
        "INSERT INTO gallery_index_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )


def _image_row_to_payload(env, row: sqlite3.Row, source: dict[str, Any]) -> dict[str, Any]:
    relative_path = str(row["relative_path"])
    original_url, resolved_subfolder = env.build_view_url(relative_path)
    relative_dir = str(row["relative_dir"])
    return {
        "asset_id": str(row["asset_id"]) if "asset_id" in row.keys() else "",
        "content_revision": int(row["content_revision"]) if "content_revision" in row.keys() else 1,
        "media_type": "image",
        "filename": str(row["filename"]),
        "relative_path": relative_path,
        "source_id": source["id"],
        "source_name": source["name"],
        "source_kind": source["kind"],
        "source_path": source["path"],
        "source_relative_path": str(row["source_relative_path"]),
        "relative_dir": relative_dir,
        "subfolder": str(row["subfolder"]) if relative_dir or source["id"] != env.DEFAULT_OUTPUT_SOURCE_ID else resolved_subfolder,
        "display_subfolder": str(row["display_subfolder"]),
        "url": original_url,
        "original_url": original_url,
        "thumb_url": env.build_thumb_url(relative_path),
        "size": int(row["size"]),
        "width": int(row["image_width"] or 0),
        "height": int(row["image_height"] or 0),
        "created_at": int(row["created_at"]),
        "dominant_color": str(row["dominant_color"] or ""),
        "color_family": str(row["color_family"] or ""),
        "color_families": [
            family for family in str(row["color_families_text"] or "").splitlines() if family
        ],
        "color_family_scores": json.loads(str(row["color_family_scores_json"] or "{}")),
        "palette": json.loads(str(row["palette_json"] or "[]")),
        "color_saturation": float(row["color_saturation"] or 0),
        "color_luma": float(row["color_luma"] or 0),
    }


def _boards_to_search_text(env, boards: list[str]) -> str:
    return "\n".join(["", *env.normalize_board_ids(boards), ""])


def _image_row_state(env, row: sqlite3.Row) -> dict[str, Any]:
    boards = [board_id for board_id in str(row["boards_text"] or "").split("\n") if board_id]
    pinned = bool(int(row["pinned"] or 0))
    return {
        "favorite": pinned,
        "pinned": pinned,
        "boards": boards,
        "category": str(row["category"] or ""),
        "title": str(row["title"] or ""),
        "notes": str(row["notes"] or ""),
        "updated_at": 0,
    }


def _gallery_state_file_path(env) -> str:
    return os.path.join(env.DATA_DIR, "gallery_state.json")


def _gallery_state_signature(env, state_map: dict[str, dict[str, Any]] | None = None) -> tuple[str, str]:
    state_file = env._gallery_state_file_path()
    try:
        with open(state_file, "rb") as file:
            payload = file.read()
        return str(os.stat(state_file).st_mtime_ns), hashlib.sha256(payload).hexdigest()
    except OSError:
        if state_map is None:
            state_map = {}

    payload = json.dumps(state_map, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return "memory", hashlib.sha256(payload).hexdigest()


def _current_state_paths_from_db(env, connection: sqlite3.Connection) -> set[str]:
    encoded_paths = env._index_meta_get(connection, "gallery_state_paths_json")
    if encoded_paths:
        try:
            parsed = json.loads(encoded_paths)
            if isinstance(parsed, list):
                return {env.normalize_relative_path(path) for path in parsed if str(path).strip()}
        except json.JSONDecodeError:
            pass

    rows = connection.execute(
        """
        SELECT relative_path
        FROM gallery_images
        WHERE title <> '' OR category <> '' OR notes <> '' OR pinned = 1 OR boards_text <> ''
        """
    ).fetchall()
    return {str(row["relative_path"]) for row in rows}


def _search_text_for_row(env, row: sqlite3.Row | dict[str, Any]) -> str:
    return " ".join(
        [
            str(row["filename"] or ""),
            str(row["relative_path"] or ""),
            str(row["title"] or ""),
            str(row["category"] or ""),
            str(row["notes"] or ""),
        ]
    )


def _fts_match_query(env, search: str) -> str:
    value = str(search or "").strip()
    if len(value) < 3:
        return ""
    return f'"{value.replace(chr(34), chr(34) + chr(34))}"'


def _color_family_rows_for_image(env, row: sqlite3.Row | dict[str, Any]) -> list[tuple[str, str, float, int]]:
    relative_path = str(row["relative_path"])
    created_at = int(row["created_at"] or 0)
    families: dict[str, float] = {}
    primary_family = str(row["color_family"] or "").strip()
    if primary_family:
        families[primary_family] = max(families.get(primary_family, 0), 1.0)
    for family in str(row["color_families_text"] or "").splitlines():
        family = family.strip()
        if family:
            families[family] = max(families.get(family, 0), env.COLOR_FAMILY_MIN_RATIO)
    try:
        score_map = json.loads(str(row["color_family_scores_json"] or "{}"))
    except json.JSONDecodeError:
        score_map = {}
    if isinstance(score_map, dict):
        for family, score in score_map.items():
            try:
                parsed_score = float(score)
            except (TypeError, ValueError):
                continue
            if parsed_score >= env.COLOR_FAMILY_MIN_RATIO or family in {"warm", "cool", "low_saturation"} and parsed_score > 0:
                families[str(family)] = max(families.get(str(family), 0), parsed_score)
    return [(relative_path, family, score, created_at) for family, score in sorted(families.items())]


def _sync_auxiliary_rows(env, connection: sqlite3.Connection, rows: list[sqlite3.Row | dict[str, Any]], remove_paths: list[str] | None = None):
    removed_paths = [env.normalize_relative_path(path) for path in (remove_paths or []) if env.normalize_relative_path(path)]
    if removed_paths:
        connection.executemany("DELETE FROM gallery_image_color_family WHERE relative_path = ?", [(path,) for path in removed_paths])
        connection.executemany("DELETE FROM gallery_image_fingerprints WHERE relative_path = ?", [(path,) for path in removed_paths])
        if env._index_meta_get(connection, "fts_available") == "1":
            connection.executemany("DELETE FROM gallery_images_fts WHERE relative_path = ?", [(path,) for path in removed_paths])

    if not rows:
        return

    relative_paths = [str(row["relative_path"]) for row in rows]
    connection.executemany("DELETE FROM gallery_image_color_family WHERE relative_path = ?", [(path,) for path in relative_paths])
    color_rows: list[tuple[str, str, float, int]] = []
    for row in rows:
        color_rows.extend(env._color_family_rows_for_image(row))
    if color_rows:
        connection.executemany(
            """
            INSERT OR REPLACE INTO gallery_image_color_family(relative_path, family, score, created_at)
            VALUES(?, ?, ?, ?)
            """,
            color_rows,
        )

    if env._index_meta_get(connection, "fts_available") == "1":
        connection.executemany("DELETE FROM gallery_images_fts WHERE relative_path = ?", [(path,) for path in relative_paths])
        connection.executemany(
            "INSERT INTO gallery_images_fts(relative_path, search_text) VALUES(?, ?)",
            [(str(row["relative_path"]), env._search_text_for_row(row)) for row in rows],
        )


def _ensure_auxiliary_tables_current(env, connection: sqlite3.Connection):
    if QUERY_ONLY.get():
        return False
    if env._index_meta_get(connection, "auxiliary_schema_version") == str(env.GALLERY_INDEX_SCHEMA_VERSION):
        return
    rows = connection.execute(
        """
        SELECT relative_path, filename, title, category, notes, color_family, color_families_text,
               color_family_scores_json, created_at
        FROM gallery_images
        """
    ).fetchall()
    connection.execute("DELETE FROM gallery_image_color_family")
    if env._index_meta_get(connection, "fts_available") == "1":
        connection.execute("DELETE FROM gallery_images_fts")
    env._sync_auxiliary_rows(connection, rows)
    env._index_meta_set(connection, "auxiliary_schema_version", str(env.GALLERY_INDEX_SCHEMA_VERSION))


def _sync_image_state_to_index_db(env, connection: sqlite3.Connection, state_map: dict[str, dict[str, Any]] | None = None):
    if QUERY_ONLY.get():
        return False
    state_mtime, state_digest = env._gallery_state_signature(state_map)
    if (
        env._index_meta_get(connection, "gallery_state_mtime") == state_mtime
        and env._index_meta_get(connection, "gallery_state_digest") == state_digest
    ):
        return False

    state_map = state_map if state_map is not None else env.get_image_state_map()
    previous_paths = env._current_state_paths_from_db(connection)
    desired = {
        env.normalize_relative_path(relative_path): (
            str(image_state.get("title", "")),
            str(image_state.get("category", "")),
            str(image_state.get("notes", "")),
            1 if image_state.get("pinned", image_state.get("favorite", False)) else 0,
            env._boards_to_search_text(image_state.get("boards", [])),
        )
        for relative_path, image_state in state_map.items()
        if env.normalize_relative_path(relative_path)
    }
    current_paths = set(desired)
    # The state file can change externally, or contain thousands of already
    # indexed pins. Compare the existing index before writing: only a changed
    # row needs an UPDATE and an expensive FTS rebuild. Clearing a removed
    # state must still reset its old indexed fields.
    updates: list[tuple[Any, ...]] = []
    changed_paths: list[str] = []
    for batch in env.iter_sqlite_batches(sorted(current_paths | previous_paths)):
        placeholders = ",".join("?" for _ in batch)
        indexed_rows = connection.execute(
            f"""
            SELECT relative_path, title, category, notes, pinned, boards_text
            FROM gallery_images WHERE relative_path IN ({placeholders})
            """,
            batch,
        )
        for row in indexed_rows:
            relative_path = str(row["relative_path"])
            expected = desired.get(relative_path, ("", "", "", 0, ""))
            existing = (
                str(row["title"]), str(row["category"]), str(row["notes"]),
                int(row["pinned"]), str(row["boards_text"]),
            )
            if existing != expected:
                updates.append((*expected, relative_path))
                changed_paths.append(relative_path)

    if updates:
        connection.executemany(
            """
            UPDATE gallery_images
            SET title = ?, category = ?, notes = ?, pinned = ?, boards_text = ?
            WHERE relative_path = ?
            """,
            updates,
        )
        for batch in env.iter_sqlite_batches(changed_paths):
            placeholders = ",".join("?" for _ in batch)
            affected_rows = connection.execute(
                f"""
                SELECT relative_path, filename, title, category, notes, color_family, color_families_text,
                       color_family_scores_json, created_at
                FROM gallery_images WHERE relative_path IN ({placeholders})
                """,
                batch,
            ).fetchall()
            env._sync_auxiliary_rows(connection, affected_rows)
    env._index_meta_set(connection, "gallery_state_mtime", state_mtime)
    env._index_meta_set(connection, "gallery_state_digest", state_digest)
    env._index_meta_set(connection, "gallery_state_paths_json", json.dumps(sorted(current_paths), ensure_ascii=False))
    return True


def _indexed_relative_paths(env, connection: sqlite3.Connection) -> set[str]:
    rows = connection.execute("SELECT relative_path FROM gallery_images").fetchall()
    return {env.normalize_relative_path(str(row["relative_path"])) for row in rows if str(row["relative_path"]).strip()}


def _reconcile_missing_state_paths_to_index(env,
    connection: sqlite3.Connection,
    *,
    create_backup: bool = True,
) -> dict[str, object]:
    indexed_paths = env._indexed_relative_paths(connection)
    protected_paths = set()
    catalog = env.get_runtime().catalog
    if catalog:
        for path in env.get_image_state_map().keys() - indexed_paths:
            source_id, relative_path = env.parse_image_ref(path)
            if catalog.tracks_location(source_id, relative_path):
                protected_paths.add(path)
    result = env.migrate_missing_image_states(indexed_paths | protected_paths, indexed_paths, create_backup=create_backup)
    migrated = result.get("migrated", {})
    if migrated:
        env._sync_image_state_to_index_db(connection, env.get_image_state_map())
        with env.IMAGE_FRESHNESS_LOCK:
            env.IMAGE_FRESHNESS_CACHE.clear()
    return result


def _load_image_index_from_db(env, sources: list[dict[str, Any]], signature: str) -> dict[str, Any] | None:
    if not os.path.exists(env.GALLERY_INDEX_DB_FILE):
        return None

    source_by_id = {source["id"]: source for source in sources}
    with env._connect_gallery_index_db() as connection:
        if env._index_meta_get(connection, "source_signature") != signature:
            return None
        if not QUERY_ONLY.get() and not env._color_index_is_current(connection):
            env._schedule_color_index_backfill(sources, signature)
        if not QUERY_ONLY.get():
            env._schedule_dimension_backfill_if_needed(connection, sources, signature)
        rows = connection.execute(
            """
            SELECT relative_path, source_id, source_relative_path, filename, relative_dir,
                   subfolder, display_subfolder, size, image_width, image_height, created_at, modified_at,
                   dominant_color, color_family, color_families_text,
                   color_family_scores_json, palette_json, color_saturation, color_luma
            FROM gallery_images
            ORDER BY created_at DESC
            """
        ).fetchall()

    images: list[dict[str, Any]] = []
    subfolders: set[str] = set()
    source_counts: dict[str, int] = {source["id"]: 0 for source in sources}
    for row in rows:
        source = source_by_id.get(str(row["source_id"]))
        if not source or not source.get("enabled", True) or not source.get("exists"):
            continue
        relative_dir = str(row["relative_dir"])
        env._collect_index_subfolders(source["id"], relative_dir, subfolders)
        source_counts[source["id"]] = source_counts.get(source["id"], 0) + 1
        images.append(env._image_row_to_payload(row, source))

    indexed_sources = [{**source, "image_count": source_counts.get(source["id"], 0)} for source in sources]
    return {
        "signature": signature,
        "output_dir": env.get_output_dir(),
        "images": images,
        "subfolders": sorted(subfolders, key=lambda value: value.lower()),
        "sources": indexed_sources,
        "built_at": time.time(),
    }


def _image_index_db_has_signature(env, signature: str) -> bool:
    if not os.path.exists(env.GALLERY_INDEX_DB_FILE):
        return False
    with env._connect_gallery_index_db() as connection:
        return env._index_meta_get(connection, "source_signature") == signature


def get_color_index_status(env) -> dict[str, Any]:
    with env.COLOR_INDEX_BACKFILL_LOCK:
        running = env.COLOR_INDEX_BACKFILL_RUNNING
        queued = len(env.COLOR_INDEX_QUEUED_PATHS)

    if not os.path.exists(env.GALLERY_INDEX_DB_FILE):
        return {
            "running": running,
            "queued": queued,
            "total": 0,
            "indexed": 0,
            "missing": 0,
            "complete": False,
            "version": env.COLOR_INDEX_VERSION,
            "threshold": env.COLOR_FAMILY_MIN_RATIO,
        }

    with env._connect_gallery_index_db() as connection:
        total = int(connection.execute("SELECT COUNT(*) AS total FROM gallery_images").fetchone()["total"])
        missing = int(
            connection.execute(
                """
                SELECT COUNT(*) AS total
                FROM gallery_images
                WHERE dominant_color = '' OR color_family_scores_json = '{}'
                """
            ).fetchone()["total"]
        )
        current_version = env._index_meta_get(connection, "color_index_version")

    return {
        "running": running,
        "queued": queued,
        "total": total,
        "indexed": max(0, total - missing),
        "missing": missing,
        "complete": total > 0 and missing == 0 and current_version == env.COLOR_INDEX_VERSION,
        "version": current_version or "",
        "target_version": env.COLOR_INDEX_VERSION,
        "threshold": env.COLOR_FAMILY_MIN_RATIO,
    }


def _store_folder_snapshot(connection, sources, details):
    failed = getattr(details, "failed_sources", set())
    for source in sources:
        if not source.get("enabled") or not source.get("exists") or source["id"] in failed:
            continue
        connection.execute("DELETE FROM gallery_folders WHERE source_id=?", (source["id"],))
        connection.executemany("INSERT INTO gallery_folders(source_id,relative_path,source_path,modified_at) VALUES(?,?,?,?)",
            [(source["id"], item["relative_path"], source["path"], item["modified_at"])
             for item in details.values() if item["source_id"] == source["id"]])
    connection.execute("INSERT OR REPLACE INTO gallery_index_meta(key,value) VALUES('folder_snapshot_version','1')")


def _save_image_index_to_db(env, index: dict[str, Any]):
    image_states = env.get_image_state_map()
    with env.get_runtime().scan_commit(), env._connect_gallery_index_db() as connection:
        connection.execute("DELETE FROM gallery_images")
        connection.execute("DELETE FROM gallery_image_fingerprints")
        scanned_at = time.time()
        rows = []
        for image in index.get("images", []):
            image_state = image_states.get(image["relative_path"], env.default_image_state())
            rows.append(
                (
                    image["relative_path"],
                    image["source_id"],
                    image["source_relative_path"],
                    image["filename"],
                    image["relative_dir"],
                    image["subfolder"],
                    image["display_subfolder"],
                    int(image["size"]),
                    int(image.get("image_width", image.get("width", 0)) or 0),
                    int(image.get("image_height", image.get("height", 0)) or 0),
                    int(image["created_at"]),
                    int(image.get("modified_at", image["created_at"])),
                    str(image_state.get("title", "")),
                    str(image_state.get("category", "")),
                    str(image_state.get("notes", "")),
                    1 if image_state.get("pinned", image_state.get("favorite", False)) else 0,
                    env._boards_to_search_text(image_state.get("boards", [])),
                    str(image.get("dominant_color", "")),
                    str(image.get("color_family", "")),
                    str(image.get("color_families_text", env._encode_color_families([str(image.get("color_family", ""))]))),
                    json.dumps(image.get("color_family_scores", {}), ensure_ascii=False),
                    json.dumps(image.get("palette", []), ensure_ascii=False),
                    float(image.get("color_saturation", 0) or 0),
                    float(image.get("color_luma", 0) or 0),
                    scanned_at,
                )
            )
        connection.executemany(
            """
            INSERT INTO gallery_images(
                relative_path, source_id, source_relative_path, filename, relative_dir,
                subfolder, display_subfolder, size, image_width, image_height, created_at, modified_at,
                title, category, notes, pinned, boards_text,
                dominant_color, color_family, color_families_text,
                color_family_scores_json, palette_json, color_saturation, color_luma,
                scanned_at
            )
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
        connection.execute("DELETE FROM gallery_image_color_family")
        if env._index_meta_get(connection, "fts_available") == "1":
            connection.execute("DELETE FROM gallery_images_fts")
        auxiliary_rows = connection.execute(
            """
            SELECT relative_path, filename, title, category, notes, color_family, color_families_text,
                   color_family_scores_json, created_at
            FROM gallery_images
            """
        ).fetchall()
        env._sync_auxiliary_rows(connection, auxiliary_rows)
        env._index_meta_set(connection, "auxiliary_schema_version", str(env.GALLERY_INDEX_SCHEMA_VERSION))
        recovery = env._reconcile_missing_state_paths_to_index(connection)
        if recovery.get("migrated"):
            image_states = env.get_image_state_map()
        env._sync_image_state_to_index_db(connection, image_states)
        env._index_meta_set(connection, "source_signature", str(index.get("signature") or ""))
        env._index_meta_set(connection, "color_index_version", env.COLOR_INDEX_VERSION if index.get("color_index_complete") else "")
        env._index_meta_set(connection, "dimension_index_version", env.DIMENSION_INDEX_VERSION)
        env._index_meta_set(connection, "built_at", str(index.get("built_at") or scanned_at))
        runtime = env.get_runtime()
        if runtime.catalog:
            runtime.sync_identities(connection, index.get("sources", []))
            env._index_meta_set(connection, "asset_identity_version", "1")
        _store_folder_snapshot(connection, index.get("sources", []), index.get("folder_details", {}))
        connection.commit()


def invalidate_image_index_cache(env):
    with env.IMAGE_INDEX_LOCK:
        env.IMAGE_INDEX_CACHE["images"] = []
        env.IMAGE_INDEX_CACHE["subfolders"] = []
        env.IMAGE_INDEX_CACHE["sources"] = []
        env.IMAGE_INDEX_CACHE["built_at"] = 0.0
        env.IMAGE_INDEX_CACHE["output_dir"] = None
        env.IMAGE_INDEX_CACHE["signature"] = None
        env.IMAGE_INDEX_CACHE["dirty"] = True
    with env.IMAGE_FRESHNESS_LOCK:
        env.IMAGE_FRESHNESS_CACHE.clear()


def _build_image_index(env, sources: list[dict[str, Any]], include_color_profiles: bool = False) -> dict[str, Any]:
    images: list[dict[str, Any]] = []
    subfolders = env._collect_directory_subfolders(sources)
    source_counts: dict[str, int] = {source["id"]: 0 for source in sources}

    for source in sources:
        if not source.get("enabled", True) or not source.get("exists"):
            continue
        source_root = source.get("path", "")
        if not source_root:
            continue
        stack = [source_root]

        while stack:
            current_dir = stack.pop()
            try:
                with os.scandir(current_dir) as iterator:
                    entries = list(iterator)
            except (FileNotFoundError, PermissionError, OSError):
                continue

            for entry in entries:
                if entry.is_dir(follow_symlinks=False):
                    if entry.name == ".ue-uploads":
                        continue
                    if source.get("recursive", True):
                        stack.append(entry.path)
                    continue

                if not entry.is_file(follow_symlinks=False) or not entry.name.lower().endswith(env.SUPPORTED_IMAGE_EXTENSIONS):
                    continue

                try:
                    stat = entry.stat()
                except FileNotFoundError:
                    continue

                relative_path = env.normalize_relative_path(os.path.relpath(entry.path, source_root))
                image_ref = env.make_image_ref(source["id"], relative_path)
                relative_dir = env.normalize_relative_path(os.path.dirname(relative_path))
                display_dir = relative_dir
                subfolder_ref = relative_dir
                if source["id"] != env.DEFAULT_OUTPUT_SOURCE_ID:
                    subfolder_ref = f'{source["id"]}{env.IMAGE_REF_SEPARATOR}{relative_dir}' if relative_dir else source["id"]
                if relative_dir:
                    env._collect_index_subfolders(source["id"], relative_dir, subfolders)

                original_url, resolved_subfolder = env.build_view_url(image_ref)
                color_profile = env._extract_image_color_profile(entry.path) if include_color_profiles else dict(env.COLOR_PROFILE_DEFAULT)
                image_width, image_height = (0, 0) if CURRENT_JOB.get() else env._read_image_dimensions(entry.path)
                source_counts[source["id"]] = source_counts.get(source["id"], 0) + 1
                images.append(
                    {
                        "filename": entry.name,
                        "relative_path": image_ref,
                        "source_id": source["id"],
                        "source_name": source["name"],
                        "source_kind": source["kind"],
                        "source_path": source["path"],
                        "source_relative_path": relative_path,
                        "relative_dir": relative_dir,
                        "subfolder": subfolder_ref if relative_dir or source["id"] != env.DEFAULT_OUTPUT_SOURCE_ID else resolved_subfolder,
                        "display_subfolder": display_dir,
                        "url": original_url,
                        "original_url": original_url,
                        "thumb_url": env.build_thumb_url(image_ref),
                        "size": stat.st_size,
                        "image_width": image_width,
                        "image_height": image_height,
                        "created_at": int(stat.st_ctime),
                        "modified_at": int(stat.st_mtime),
                        "dominant_color": color_profile["dominant_color"],
                        "color_family": color_profile["color_family"],
                        "color_families_text": color_profile["color_families_text"],
                        "color_family_scores": json.loads(color_profile["color_family_scores_json"]),
                        "palette": json.loads(color_profile["palette_json"]),
                        "color_saturation": color_profile["color_saturation"],
                        "color_luma": color_profile["color_luma"],
                    }
                )

    images.sort(key=lambda item: item["created_at"], reverse=True)
    indexed_sources = [{**source, "image_count": source_counts.get(source["id"], 0)} for source in sources]
    index = {
        "signature": env._source_signature(sources),
        "output_dir": env.get_output_dir(),
        "images": images,
        "subfolders": sorted(subfolders, key=lambda value: value.lower()),
        "sources": indexed_sources,
        "built_at": time.time(),
        "color_index_complete": include_color_profiles,
        "folder_details": env._collect_directory_subfolder_details(sources),
    }
    env._save_image_index_to_db(index)
    if not include_color_profiles:
        env._schedule_color_index_backfill(sources, index["signature"])
    return index


def _image_record_for_file(env, source: dict[str, Any], full_path: str, stat: os.stat_result, include_dimensions: bool = True) -> dict[str, Any]:
    source_root = source.get("path", "")
    relative_path = env.normalize_relative_path(os.path.relpath(full_path, source_root))
    image_ref = env.make_image_ref(source["id"], relative_path)
    relative_dir = env.normalize_relative_path(os.path.dirname(relative_path))
    display_dir = relative_dir
    subfolder_ref = relative_dir
    if source["id"] != env.DEFAULT_OUTPUT_SOURCE_ID:
        subfolder_ref = f'{source["id"]}{env.IMAGE_REF_SEPARATOR}{relative_dir}' if relative_dir else source["id"]
    original_url, resolved_subfolder = env.build_view_url(image_ref)
    image_width, image_height = env._read_image_dimensions(full_path) if include_dimensions else (0, 0)
    return {
        "filename": os.path.basename(full_path),
        "relative_path": image_ref,
        "source_id": source["id"],
        "source_relative_path": relative_path,
        "relative_dir": relative_dir,
        "subfolder": subfolder_ref if relative_dir or source["id"] != env.DEFAULT_OUTPUT_SOURCE_ID else resolved_subfolder,
        "display_subfolder": display_dir,
        "size": stat.st_size,
        "image_width": image_width,
        "image_height": image_height,
        "created_at": int(stat.st_ctime),
        "modified_at": int(stat.st_mtime),
        "title": "",
        "category": "",
        "notes": "",
        "pinned": 0,
        "boards_text": "",
        **env.COLOR_PROFILE_DEFAULT,
    }


class ScanRecords(dict):
    def __init__(self):
        super().__init__()
        self.failed_sources = set()


def _scan_index_records_for_scope(env, sources: list[dict[str, Any]], scope: str = "") -> dict[str, dict[str, Any]]:
    scoped_sources, _ = env._freshness_sources_for_subfolder(sources, scope)
    records = ScanRecords()
    for source, relative_scope in scoped_sources:
        if not source.get("enabled", True) or not source.get("exists"):
            records.failed_sources.add(source["id"])
            continue
        source_root = source.get("path", "")
        if not source_root:
            continue
        try:
            scan_root = (
                env._ensure_within_directory(source_root, os.path.join(source_root, relative_scope), source.get("name", "source"))
                if relative_scope
                else env._real_abs(source_root)
            )
        except ValueError:
            continue
        if not os.path.isdir(scan_root):
            continue

        stack = [scan_root]
        while stack:
            checkpoint()
            current_dir = stack.pop()
            try:
                with os.scandir(current_dir) as iterator:
                    entries = list(iterator)
            except (FileNotFoundError, PermissionError, OSError):
                records.failed_sources.add(source["id"])
                continue
            for entry in entries:
                try:
                    if entry.is_dir(follow_symlinks=False):
                        if entry.name == ".ue-uploads":
                            continue
                        if source.get("recursive", True):
                            stack.append(entry.path)
                        continue
                    if not entry.is_file(follow_symlinks=False) or not entry.name.lower().endswith(env.SUPPORTED_IMAGE_EXTENSIONS):
                        continue
                    stat = entry.stat()
                except (FileNotFoundError, PermissionError, OSError):
                    continue
                record = env._image_record_for_file(source, entry.path, stat, include_dimensions=False)
                record["full_path"] = entry.path
                records[record["relative_path"]] = record
    return records


def _scope_where_sql(env, sources: list[dict[str, Any]], scope: str = "") -> tuple[str, list[Any]]:
    scoped_sources, _ = env._freshness_sources_for_subfolder(sources, scope)
    clauses: list[str] = []
    params: list[Any] = []
    for source, relative_scope in scoped_sources:
        source_id = source.get("id")
        if not source_id or not source.get("enabled") or not source.get("exists"):
            continue
        if relative_scope:
            clauses.append("(source_id = ? AND (lower(relative_dir) = ? OR lower(relative_dir) LIKE ?))")
            normalized_scope = relative_scope.lower()
            params.extend([source_id, normalized_scope, f"{normalized_scope}/%"])
        else:
            clauses.append("source_id = ?")
            params.append(source_id)
    return " OR ".join(clauses) if clauses else "0 = 1", params


def _sync_image_index_incremental_locked(env, sources: list[dict[str, Any]], signature: str, scope: str = "") -> dict[str, Any]:
    if not os.path.exists(env.GALLERY_INDEX_DB_FILE) or not env._image_index_db_has_signature(signature):
        return env._build_image_index(sources)

    scanned_records = env._scan_index_records_for_scope(sources, scope)
    folder_details = env._collect_directory_subfolder_details(sources)
    where_sql, params = env._scope_where_sql(sources, scope)
    scanned_at = time.time()
    state_map = env.get_image_state_map()
    upsert_rows: list[tuple[Any, ...]] = []
    upsert_payloads: list[dict[str, Any]] = []
    priority_paths: list[str] = []

    with env.get_runtime().scan_commit(), env._connect_gallery_index_db() as connection:
        existing_rows = connection.execute(
            f"""
            SELECT relative_path, source_id, source_relative_path, size, modified_at
            FROM gallery_images
            WHERE {where_sql}
            """,
            params,
        ).fetchall()
        existing = {str(row["relative_path"]): row for row in existing_rows}
        scanned_paths = set(scanned_records)
        failed_sources = getattr(scanned_records, "failed_sources", set())
        deleted_paths = sorted(path for path in set(existing) - scanned_paths if existing[path]["source_id"] not in failed_sources)
        runtime = env.get_runtime()
        if runtime.catalog:
            for source in sources:
                if source["id"] in failed_sources or not source.get("enabled") or not source.get("exists"):
                    continue
                runtime.catalog.mark_missing(source, [existing[path]["source_relative_path"] for path in deleted_paths if existing[path]["source_id"] == source["id"]])

        for relative_path, record in scanned_records.items():
            existing_row = existing.get(relative_path)
            if (
                existing_row
                and int(existing_row["size"]) == int(record["size"])
                and int(existing_row["modified_at"]) == int(record["modified_at"])
            ):
                continue
            image_state = state_map.get(relative_path, env.default_image_state())
            image_width, image_height = (0, 0) if CURRENT_JOB.get() else env._read_image_dimensions(str(record.get("full_path", "")))
            record = {
                **record,
                "image_width": image_width,
                "image_height": image_height,
                "title": str(image_state.get("title", "")),
                "category": str(image_state.get("category", "")),
                "notes": str(image_state.get("notes", "")),
                "pinned": 1 if image_state.get("pinned", image_state.get("favorite", False)) else 0,
                "boards_text": env._boards_to_search_text(image_state.get("boards", [])),
            }
            upsert_payloads.append(record)
            priority_paths.append(relative_path)
            upsert_rows.append(
                (
                    record["relative_path"],
                    record["source_id"],
                    record["source_relative_path"],
                    record["filename"],
                    record["relative_dir"],
                    record["subfolder"],
                    record["display_subfolder"],
                    int(record["size"]),
                    int(record.get("image_width", 0) or 0),
                    int(record.get("image_height", 0) or 0),
                    int(record["created_at"]),
                    int(record["modified_at"]),
                    record["title"],
                    record["category"],
                    record["notes"],
                    int(record["pinned"]),
                    record["boards_text"],
                    record["dominant_color"],
                    record["color_family"],
                    record["color_families_text"],
                    record["color_family_scores_json"],
                    record["palette_json"],
                    float(record["color_saturation"]),
                    float(record["color_luma"]),
                    scanned_at,
                )
            )

        if deleted_paths:
            connection.executemany("DELETE FROM gallery_images WHERE relative_path = ?", [(path,) for path in deleted_paths])
            env._sync_auxiliary_rows(connection, [], remove_paths=deleted_paths)
        if upsert_rows:
            connection.executemany(
                """
                INSERT INTO gallery_images(
                    relative_path, source_id, source_relative_path, filename, relative_dir,
                    subfolder, display_subfolder, size, image_width, image_height, created_at, modified_at,
                    title, category, notes, pinned, boards_text,
                    dominant_color, color_family, color_families_text,
                    color_family_scores_json, palette_json, color_saturation, color_luma,
                    scanned_at
                )
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(relative_path) DO UPDATE SET
                    source_id = excluded.source_id,
                    source_relative_path = excluded.source_relative_path,
                    filename = excluded.filename,
                    relative_dir = excluded.relative_dir,
                    subfolder = excluded.subfolder,
                    display_subfolder = excluded.display_subfolder,
                    size = excluded.size,
                    image_width = excluded.image_width,
                    image_height = excluded.image_height,
                    created_at = excluded.created_at,
                    modified_at = excluded.modified_at,
                    title = excluded.title,
                    category = excluded.category,
                    notes = excluded.notes,
                    pinned = excluded.pinned,
                    boards_text = excluded.boards_text,
                    dominant_color = excluded.dominant_color,
                    color_family = excluded.color_family,
                    color_families_text = excluded.color_families_text,
                    color_family_scores_json = excluded.color_family_scores_json,
                    palette_json = excluded.palette_json,
                    color_saturation = excluded.color_saturation,
                    color_luma = excluded.color_luma,
                    scanned_at = excluded.scanned_at
                """,
                upsert_rows,
            )
            env._sync_auxiliary_rows(connection, upsert_payloads)
            env._index_meta_set(connection, "color_index_version", "")
        recovery = env._reconcile_missing_state_paths_to_index(connection)
        if recovery.get("migrated"):
            state_map = env.get_image_state_map()
        env._sync_image_state_to_index_db(connection, state_map)
        env._index_meta_set(connection, "source_signature", signature)
        env._index_meta_set(connection, "built_at", str(scanned_at))
        if runtime.catalog:
            runtime.sync_identities(connection, sources, dimensions_current={row["relative_path"] for row in upsert_payloads})
            env._index_meta_set(connection, "asset_identity_version", "1")
        _store_folder_snapshot(connection, sources, folder_details)
        connection.commit()

    if priority_paths:
        env._schedule_color_index_backfill(sources, signature, priority_paths)
    return {
        "signature": signature,
        "output_dir": env.get_output_dir(),
        "images": [],
        "subfolders": [],
        "sources": sources,
        "built_at": scanned_at,
    }


def ensure_image_index_db_current(env, force_refresh: bool = False, scope: str = "") -> tuple[list[dict[str, Any]], str]:
    if QUERY_ONLY.get() or DEFER_INDEX_REFRESH.get():
        sources = env.list_gallery_sources()
        return sources, env._source_signature(sources)
    sources = env.list_gallery_sources()
    signature = env._source_signature(sources)
    with env.get_runtime().scan_sync_lock:
        should_sync = force_refresh or env.IMAGE_INDEX_CACHE.get("dirty") or not env._image_index_db_has_signature(signature)
        if should_sync:
            if force_refresh or env._image_index_db_has_signature(signature):
                env._sync_image_index_incremental_locked(sources, signature, scope=scope)
            else:
                env._build_image_index(sources)
            env.IMAGE_INDEX_CACHE.update(
                {
                    "signature": signature,
                    "output_dir": env.get_output_dir(),
                    "built_at": time.time(),
                    "images": [],
                    "subfolders": [],
                    "sources": [],
                    "dirty": False,
                }
            )
        with env.get_runtime().scan_commit(), env._connect_gallery_index_db() as connection:
            if should_sync or env._index_meta_get(connection, "asset_identity_version") != "1":
                runtime = env.get_runtime()
                if runtime.catalog:
                    runtime.sync_identities(connection, sources)
                    env._index_meta_set(connection, "asset_identity_version", "1")
                connection.commit()
    return sources, signature


def get_image_index(env, force_refresh: bool = False) -> dict[str, Any]:
    if DEFER_INDEX_REFRESH.get():
        sources = env.list_gallery_sources()
        return {"signature": env._source_signature(sources), "sources": sources, "images": [],
                "subfolders": sorted(env._collect_directory_subfolders(sources)),
                "output_dir": env.get_output_dir(), "built_at": env.IMAGE_INDEX_CACHE.get("built_at", 0)}
    sources = env.list_gallery_sources()
    signature = env._source_signature(sources)

    with env.get_runtime().scan_sync_lock:
        should_rebuild = (
            force_refresh
            or env.IMAGE_INDEX_CACHE.get("dirty")
            or env.IMAGE_INDEX_CACHE["signature"] != signature
            or not env.IMAGE_INDEX_CACHE["built_at"]
        )

        if should_rebuild:
            if force_refresh or (env.IMAGE_INDEX_CACHE.get("dirty") and env._image_index_db_has_signature(signature)):
                env._sync_image_index_incremental_locked(sources, signature)
                cached_index = env._load_image_index_from_db(sources, signature)
            else:
                cached_index = env._load_image_index_from_db(sources, signature)
            env.IMAGE_INDEX_CACHE.update(cached_index if cached_index is not None else env._build_image_index(sources))
            env.IMAGE_INDEX_CACHE["dirty"] = False

        return {
            "signature": env.IMAGE_INDEX_CACHE["signature"],
            "output_dir": env.IMAGE_INDEX_CACHE["output_dir"],
            "images": list(env.IMAGE_INDEX_CACHE["images"]),
            "subfolders": list(env.IMAGE_INDEX_CACHE["subfolders"]),
            "sources": list(env.IMAGE_INDEX_CACHE["sources"]),
            "built_at": env.IMAGE_INDEX_CACHE["built_at"],
        }


def _collect_subfolders_from_db(env, sources: list[dict[str, Any]]) -> set[str]:
    if not os.path.exists(env.GALLERY_INDEX_DB_FILE):
        return set()
    subfolders: set[str] = set()
    with env._connect_gallery_index_db() as connection:
        rows = connection.execute(
            """
            SELECT DISTINCT source_id, relative_dir
            FROM gallery_images
            WHERE relative_dir <> ''
            """
        ).fetchall()
    source_ids = {source["id"] for source in sources}
    for row in rows:
        source_id = str(row["source_id"])
        if source_id not in source_ids:
            continue
        env._collect_index_subfolders(source_id, str(row["relative_dir"]), subfolders)
    return subfolders


def collect_subfolders(env, output_dir: str, force_refresh: bool = False) -> list[str]:
    if not output_dir or not os.path.exists(output_dir):
        return []
    sources, _ = env.ensure_image_index_db_current(force_refresh=force_refresh)
    directory_subfolders = set(env._collect_directory_subfolder_details(sources))
    database_subfolders = env._collect_subfolders_from_db(sources)
    subfolders = env._merge_subfolder_refs(directory_subfolders, database_subfolders)
    return sorted(subfolders, key=lambda value: value.lower())


def collect_subfolder_details(env, output_dir: str, force_refresh: bool = False) -> list[dict[str, Any]]:
    if not output_dir or not os.path.exists(output_dir):
        return []
    sources, _ = env.ensure_image_index_db_current(force_refresh=force_refresh)
    directory_details = env._collect_directory_subfolder_details(sources)
    database_subfolders = env._collect_subfolders_from_db(sources)
    merged_refs = env._merge_subfolder_refs(set(directory_details), database_subfolders)
    details: list[dict[str, Any]] = []
    for folder_ref in merged_refs:
        source_id, relative_path = env.parse_folder_ref(folder_ref)
        detail = directory_details.get(folder_ref)
        if detail is None:
            detail = {
                "path": folder_ref,
                "source_id": source_id,
                "relative_path": relative_path,
                "modified_at": 0,
            }
        details.append(detail)
    return sorted(details, key=lambda item: str(item["path"]).lower())


def list_images(env,
    search: str = "",
    category: str = "",
    subfolder: str = "",
    board_id: str = "",
    date_from: str = "",
    date_to: str = "",
    favorites_only: bool = False,
    sort_by: str = "created_at",
    sort_order: str = "desc",
    force_refresh: bool = False,
) -> list[dict]:
    normalized_search = search.strip().lower()
    normalized_category = category.strip().lower()
    normalized_subfolder = env.normalize_relative_path(subfolder).lower()
    filter_source_id = ""
    filter_relative_dir = normalized_subfolder
    if env.IMAGE_REF_SEPARATOR in normalized_subfolder:
        filter_source_id, filter_relative_dir = normalized_subfolder.split(env.IMAGE_REF_SEPARATOR, 1)
    normalized_board_id = str(board_id or "").strip()
    date_from_ts = None
    date_to_ts = None

    if date_from.strip():
        date_from_ts = int(datetime.strptime(date_from.strip(), "%Y-%m-%d").timestamp())
    if date_to.strip():
        date_to_ts = int((datetime.strptime(date_to.strip(), "%Y-%m-%d") + timedelta(days=1)).timestamp())

    indexed_images = env.get_image_index(force_refresh=force_refresh)["images"]
    image_states = env.get_image_state_map()
    images: list[dict[str, Any]] = []

    for indexed_image in indexed_images:
        image_state = image_states.get(indexed_image["relative_path"], env.default_image_state())
        haystack = " ".join(
            [
                indexed_image["filename"],
                indexed_image["relative_path"],
                str(image_state.get("title", "")),
                str(image_state.get("category", "")),
                str(image_state.get("notes", "")),
            ]
        ).lower()

        if normalized_search and normalized_search not in haystack:
            continue
        if normalized_category and normalized_category != str(image_state.get("category", "")).strip().lower():
            continue
        if normalized_subfolder:
            if filter_source_id and indexed_image.get("source_id", "").lower() != filter_source_id:
                continue
            image_relative_dir = str(indexed_image["relative_dir"]).lower()
            if filter_relative_dir and not (
                image_relative_dir == filter_relative_dir
                or image_relative_dir.startswith(f"{filter_relative_dir}/")
            ):
                continue
        if normalized_board_id and normalized_board_id not in image_state.get("boards", []):
            continue
        if date_from_ts is not None and indexed_image["created_at"] < date_from_ts:
            continue
        if date_to_ts is not None and indexed_image["created_at"] >= date_to_ts:
            continue
        if favorites_only and not image_state.get("pinned", image_state.get("favorite", False)):
            continue

        images.append({**indexed_image, **image_state})

    reverse = sort_order.lower() != "asc"
    if sort_by == "filename":
        images.sort(key=lambda item: item["filename"].lower(), reverse=reverse)
    elif sort_by == "size":
        images.sort(key=lambda item: item["size"], reverse=reverse)
    else:
        images.sort(key=lambda item: item["created_at"], reverse=reverse)

    return images


def _freshness_scope_key(env, signature: str, subfolder: str) -> str:
    return json.dumps(
        {
            "signature": signature,
            "subfolder": env.normalize_relative_path(subfolder),
        },
        sort_keys=True,
        ensure_ascii=False,
    )


def _freshness_sources_for_subfolder(env,
    sources: list[dict[str, Any]],
    subfolder: str,
) -> tuple[list[tuple[dict[str, Any], str]], str]:
    normalized_subfolder = env.normalize_relative_path(subfolder)
    if not normalized_subfolder:
        return [(source, "") for source in sources], ""

    source_id, relative_dir = env.parse_folder_ref(normalized_subfolder)
    scoped_sources = [(source, relative_dir) for source in sources if source.get("id") == source_id]
    return scoped_sources, env.make_folder_ref(source_id, relative_dir) if source_id != env.DEFAULT_OUTPUT_SOURCE_ID or relative_dir else relative_dir


def _scan_image_freshness(env, sources: list[dict[str, Any]], subfolder: str) -> dict[str, Any]:
    scoped_sources, normalized_subfolder = env._freshness_sources_for_subfolder(sources, subfolder)
    digest = hashlib.sha256()
    digest.update(env._source_signature(sources).encode("utf-8"))
    digest.update(b"\0")
    digest.update(normalized_subfolder.encode("utf-8"))
    image_count = 0
    latest_created_ns = -1
    latest_created_at = 0
    latest_relative_path = ""

    # A stable traversal order makes the fingerprint independent of filesystem
    # enumeration order. Hash records as they arrive instead of retaining and
    # sorting every image in memory on each six-second live refresh.
    for source, relative_scope in scoped_sources:
        if not source.get("enabled", True) or not source.get("exists"):
            continue
        source_root = source.get("path", "")
        if not source_root:
            continue
        try:
            scan_root = (
                env._ensure_within_directory(source_root, os.path.join(source_root, relative_scope), source.get("name", "source"))
                if relative_scope
                else env._real_abs(source_root)
            )
        except ValueError:
            continue
        if not os.path.isdir(scan_root):
            continue

        stack = [scan_root]
        while stack:
            current_dir = stack.pop()
            try:
                with os.scandir(current_dir) as iterator:
                    entries = sorted(iterator, key=lambda entry: entry.name)
            except (FileNotFoundError, PermissionError, OSError):
                continue

            relative_dir = os.path.relpath(current_dir, source_root)
            if relative_dir == ".":
                relative_dir = ""
            for entry in entries:
                try:
                    if entry.is_dir(follow_symlinks=False):
                        if entry.name == ".ue-uploads":
                            continue
                        if source.get("recursive", True):
                            stack.append(entry.path)
                        continue
                    if not entry.is_file(follow_symlinks=False) or not entry.name.lower().endswith(env.SUPPORTED_IMAGE_EXTENSIONS):
                        continue
                    stat = entry.stat()
                except (FileNotFoundError, PermissionError, OSError):
                    continue

                relative_path = env.normalize_relative_path(os.path.join(relative_dir, entry.name))
                image_ref = env.make_image_ref(source["id"], relative_path)
                image_count += 1
                created_ns = getattr(stat, "st_ctime_ns", int(stat.st_ctime * 1_000_000_000))
                if created_ns > latest_created_ns:
                    latest_created_ns = created_ns
                    latest_created_at = int(stat.st_ctime)
                    latest_relative_path = image_ref
                modified_ns = getattr(stat, "st_mtime_ns", int(stat.st_mtime * 1_000_000_000))
                digest.update(b"\0")
                digest.update(f"{image_ref}\0{stat.st_size}\0{modified_ns}".encode("utf-8", errors="surrogateescape"))

    return {
        "fingerprint": digest.hexdigest(),
        "image_count": image_count,
        "latest_created_at": latest_created_at,
        "latest_relative_path": latest_relative_path,
        "checked_at": time.time(),
        "subfolder": normalized_subfolder,
    }


def get_image_freshness(env, subfolder: str = "", known: str = "") -> dict[str, Any]:
    sources = env.list_gallery_sources()
    signature = env._source_signature(sources)
    cache_key = env._freshness_scope_key(signature, subfolder)
    now = time.time()

    with env.IMAGE_FRESHNESS_LOCK:
        cached = env.IMAGE_FRESHNESS_CACHE.get(cache_key)
        if cached and now - float(cached.get("checked_at", 0)) < env.IMAGE_FRESHNESS_CACHE_TTL_SECONDS:
            payload = dict(cached)
        else:
            payload = env._scan_image_freshness(sources, subfolder)
        # Keep a small LRU of recently visited scopes; navigation through many
        # source folders should not grow the process cache without bound.
        env.IMAGE_FRESHNESS_CACHE.pop(cache_key, None)
        env.IMAGE_FRESHNESS_CACHE[cache_key] = dict(payload)
        while len(env.IMAGE_FRESHNESS_CACHE) > env.IMAGE_FRESHNESS_CACHE_MAX_SCOPES:
            env.IMAGE_FRESHNESS_CACHE.pop(next(iter(env.IMAGE_FRESHNESS_CACHE)))

    fingerprint = str(payload.get("fingerprint") or "")
    known_fingerprint = str(known or "").strip()
    return {
        **payload,
        "changed": bool(known_fingerprint and known_fingerprint != fingerprint),
    }


def list_images_page(env,
    page: int = 1,
    limit: int = 60,
    search: str = "",
    category: str = "",
    subfolder: str = "",
    board_id: str = "",
    date_from: str = "",
    date_to: str = "",
    favorites_only: bool = False,
    color_family: str = "",
    sort_by: str = "created_at",
    sort_order: str = "desc",
    force_refresh: bool = False,
) -> dict[str, Any]:
    sources, signature = env.ensure_image_index_db_current(force_refresh=force_refresh, scope=subfolder)
    source_by_id = {source["id"]: source for source in sources}
    where_sql, params, fts_query = env._build_image_filter_sql(
        search, category, subfolder, board_id, date_from, date_to, favorites_only, color_family)
    normalized_search = search.strip().lower()
    sort_field = {
        "filename": "filename COLLATE NOCASE",
        "size": "size",
        "created_at": "created_at",
    }.get(sort_by, "created_at")
    sort_direction = "ASC" if sort_order.lower() == "asc" else "DESC"
    safe_page = max(1, int(page or 1))
    safe_limit = max(1, min(200, int(limit or 60)))
    offset = (safe_page - 1) * safe_limit
    with env._connect_gallery_index_db() as connection:
        env._ensure_auxiliary_tables_current(connection)
        if not QUERY_ONLY.get() and not env._color_index_is_current(connection):
            env._schedule_color_index_backfill(sources, signature)
        if not QUERY_ONLY.get():
            env._schedule_dimension_backfill_if_needed(connection, sources, signature)
        env._sync_image_state_to_index_db(connection)
        try:
            total = int(
                connection.execute(f"SELECT COUNT(*) AS total FROM gallery_images WHERE {where_sql}", params).fetchone()["total"]
            )
            rows = connection.execute(
                f"""
                SELECT asset_id, content_revision, relative_path, source_id, source_relative_path, filename, relative_dir,
                       subfolder, display_subfolder, size, image_width, image_height, created_at, modified_at,
                       title, category, notes, pinned, boards_text,
                       dominant_color, color_family, color_families_text,
                       color_family_scores_json, palette_json, color_saturation, color_luma
                FROM gallery_images
                WHERE {where_sql}
                ORDER BY {sort_field} {sort_direction}, relative_path ASC
                LIMIT ? OFFSET ?
                """,
                [*params, safe_limit, offset],
            ).fetchall()
        except sqlite3.OperationalError:
            if not fts_query:
                raise
            fallback_where = where_sql.replace(
                "relative_path IN (SELECT relative_path FROM gallery_images_fts WHERE gallery_images_fts MATCH ?)",
                "lower(filename || ' ' || relative_path || ' ' || title || ' ' || category || ' ' || notes) LIKE ?",
                1,
            )
            fallback_params = [f"%{normalized_search}%" if value == fts_query else value for value in params]
            total = int(
                connection.execute(f"SELECT COUNT(*) AS total FROM gallery_images WHERE {fallback_where}", fallback_params).fetchone()["total"]
            )
            rows = connection.execute(
                f"""
                SELECT asset_id, content_revision, relative_path, source_id, source_relative_path, filename, relative_dir,
                       subfolder, display_subfolder, size, image_width, image_height, created_at, modified_at,
                       title, category, notes, pinned, boards_text,
                       dominant_color, color_family, color_families_text,
                       color_family_scores_json, palette_json, color_saturation, color_luma
                FROM gallery_images
                WHERE {fallback_where}
                ORDER BY {sort_field} {sort_direction}, relative_path ASC
                LIMIT ? OFFSET ?
                """,
                [*fallback_params, safe_limit, offset],
            ).fetchall()
        connection.commit()

    env._schedule_color_index_backfill(sources, signature, [str(row["relative_path"]) for row in rows])

    images: list[dict[str, Any]] = []
    for row in rows:
        source = source_by_id.get(str(row["source_id"]))
        if not source:
            continue
        images.append({**env._image_row_to_payload(row, source), **env._image_row_state(row)})

    return {
        "images": images,
        "total": total,
        "page": safe_page,
        "limit": safe_limit,
        "color_index_status": env.get_color_index_status(),
    }


def _build_image_filter_sql(env,
    search: str = "",
    category: str = "",
    subfolder: str = "",
    board_id: str = "",
    date_from: str = "",
    date_to: str = "",
    favorites_only: bool = False,
    color_family: str = "",
) -> tuple[str, list[Any], str]:
    normalized_search = search.strip().lower()
    normalized_category = category.strip().lower()
    normalized_color_family = color_family.strip().lower()
    normalized_subfolder = env.normalize_relative_path(subfolder).lower()
    filter_source_id = ""
    filter_relative_dir = normalized_subfolder
    if env.IMAGE_REF_SEPARATOR in normalized_subfolder:
        filter_source_id, filter_relative_dir = normalized_subfolder.split(env.IMAGE_REF_SEPARATOR, 1)
    normalized_board_id = str(board_id or "").strip()
    date_from_ts = None
    date_to_ts = None

    if date_from.strip():
        date_from_ts = int(datetime.strptime(date_from.strip(), "%Y-%m-%d").timestamp())
    if date_to.strip():
        date_to_ts = int((datetime.strptime(date_to.strip(), "%Y-%m-%d") + timedelta(days=1)).timestamp())

    where_clauses = ["1 = 1"]
    params: list[Any] = []
    fts_query = ""

    if normalized_search:
        fts_query = env._fts_match_query(normalized_search)
        if fts_query:
            where_clauses.append("relative_path IN (SELECT relative_path FROM gallery_images_fts WHERE gallery_images_fts MATCH ?)")
            params.append(fts_query)
        else:
            where_clauses.append(
                "lower(filename || ' ' || relative_path || ' ' || title || ' ' || category || ' ' || notes) LIKE ?"
            )
            params.append(f"%{normalized_search}%")
    if normalized_category:
        where_clauses.append("lower(category) = ?")
        params.append(normalized_category)
    if normalized_subfolder:
        if filter_source_id:
            where_clauses.append("source_id = ?")
            params.append(filter_source_id)
        if filter_relative_dir:
            where_clauses.append("(lower(relative_dir) = ? OR lower(relative_dir) LIKE ?)")
            params.extend([filter_relative_dir, f"{filter_relative_dir}/%"])
    if normalized_board_id:
        where_clauses.append("boards_text LIKE ?")
        params.append(f"%\n{normalized_board_id}\n%")
    if date_from_ts is not None:
        where_clauses.append("created_at >= ?")
        params.append(date_from_ts)
    if date_to_ts is not None:
        where_clauses.append("created_at < ?")
        params.append(date_to_ts)
    if favorites_only:
        where_clauses.append("pinned = 1")
    if normalized_color_family:
        if normalized_color_family == "low_saturation":
            where_clauses.append(
                "(relative_path IN (SELECT relative_path FROM gallery_image_color_family WHERE family = ?) OR (color_saturation > 0 AND color_saturation < 0.18))"
            )
            params.append("low_saturation")
        else:
            where_clauses.append("relative_path IN (SELECT relative_path FROM gallery_image_color_family WHERE family = ?)")
            params.append(normalized_color_family)

    return " AND ".join(where_clauses), params, fts_query


def _image_row_select_sql(env) -> str:
    return """
        asset_id, content_revision, relative_path, source_id, source_relative_path, filename, relative_dir,
        subfolder, display_subfolder, size, image_width, image_height, created_at, modified_at,
        title, category, notes, pinned, boards_text,
        dominant_color, color_family, color_families_text,
        color_family_scores_json, palette_json, color_saturation, color_luma
    """


def _query_filtered_image_rows(env,
    connection: sqlite3.Connection,
    *,
    search: str = "",
    category: str = "",
    subfolder: str = "",
    board_id: str = "",
    date_from: str = "",
    date_to: str = "",
    favorites_only: bool = False,
    color_family: str = "",
    sort_by: str = "created_at",
    sort_order: str = "desc",
    limit: int = 2000,
) -> list[sqlite3.Row]:
    where_sql, params, fts_query = env._build_image_filter_sql(
        search=search,
        category=category,
        subfolder=subfolder,
        board_id=board_id,
        date_from=date_from,
        date_to=date_to,
        favorites_only=favorites_only,
        color_family=color_family,
    )
    sort_field = {
        "filename": "filename COLLATE NOCASE",
        "size": "size",
        "created_at": "created_at",
    }.get(sort_by, "created_at")
    sort_direction = "ASC" if sort_order.lower() == "asc" else "DESC"
    safe_limit = max(1, min(env.VARIANT_GROUP_SCAN_LIMIT, int(limit or env.VARIANT_GROUP_SCAN_LIMIT)))
    try:
        return connection.execute(
            f"""
            SELECT {env._image_row_select_sql()}
            FROM gallery_images
            WHERE {where_sql}
            ORDER BY {sort_field} {sort_direction}, relative_path ASC
            LIMIT ?
            """,
            [*params, safe_limit],
        ).fetchall()
    except sqlite3.OperationalError:
        if not fts_query:
            raise
        fallback_where = where_sql.replace(
            "relative_path IN (SELECT relative_path FROM gallery_images_fts WHERE gallery_images_fts MATCH ?)",
            "lower(filename || ' ' || relative_path || ' ' || title || ' ' || category || ' ' || notes) LIKE ?",
            1,
        )
        fallback_params = [f"%{search.strip().lower()}%" if value == fts_query else value for value in params]
        return connection.execute(
            f"""
            SELECT {env._image_row_select_sql()}
            FROM gallery_images
            WHERE {fallback_where}
            ORDER BY {sort_field} {sort_direction}, relative_path ASC
            LIMIT ?
            """,
            [*fallback_params, safe_limit],
        ).fetchall()


def _board_cover_payload(env, relative_path: str) -> dict[str, str] | None:
    if not relative_path:
        return None
    try:
        _, full_path = env.resolve_image_path(relative_path)
    except (FileNotFoundError, ValueError):
        return None
    if not os.path.exists(full_path):
        return None
    original_url, _ = env.build_view_url(relative_path)
    return {
        "relative_path": env.normalize_relative_path(relative_path),
        "url": original_url,
        "thumb_url": env.build_thumb_url(relative_path),
    }


def list_boards(env, force_refresh: bool = False) -> list[dict[str, Any]]:
    boards = env.get_raw_boards()
    sources, _ = env.ensure_image_index_db_current(force_refresh=force_refresh)
    image_states = env.get_image_state_map()
    board_counts: dict[str, int] = {board_id: 0 for board_id in boards}
    first_cover_by_board: dict[str, str] = {}
    # Only stored board members need an existence check. Chunk the indexed
    # lookups so a gallery with many boards works on SQLite's 999-bind builds.
    # Do not scan every gallery_images row when boards are sparse.
    board_paths = [
        path for path, state in image_states.items()
        if any(board_id in boards for board_id in state.get("boards", []))
    ]
    if boards and os.path.exists(env.GALLERY_INDEX_DB_FILE):
        rows: list[sqlite3.Row] = []
        with env._connect_gallery_index_db() as connection:
            env._sync_image_state_to_index_db(connection, image_states)
            for batch in env.iter_sqlite_batches(board_paths):
                placeholders = ",".join("?" for _ in batch)
                rows.extend(connection.execute(
                    f"SELECT relative_path, created_at FROM gallery_images WHERE relative_path IN ({placeholders})",
                    batch,
                ).fetchall())
            connection.commit()
        rows.sort(key=lambda row: int(row["created_at"]), reverse=True)
        for row in rows:
            relative_path = str(row["relative_path"])
            image_state = image_states.get(relative_path)
            if not image_state:
                continue
            for board_id in image_state.get("boards", []):
                if board_id not in boards:
                    continue
                board_counts[board_id] += 1
                first_cover_by_board.setdefault(board_id, relative_path)

    summaries = []
    for board_id, board in boards.items():
        preferred_cover = board.get("cover") or first_cover_by_board.get(board_id, "")
        cover = env._board_cover_payload(preferred_cover)
        summaries.append(
            {
                **board,
                "count": board_counts.get(board_id, 0),
                "cover_image": cover,
            }
        )

    summaries.sort(key=lambda item: (item.get("updated_at") or 0, item.get("name", "").lower()), reverse=True)
    return summaries


def create_gallery_board(env, name: str, description: str = "") -> dict[str, Any]:
    board = env.create_board(name, description)
    return {"ok": True, "board": {**board, "count": 0, "cover_image": None}, "boards": env.list_boards()}


def update_gallery_board(env, board_id: str, updates: dict[str, Any]) -> dict[str, Any]:
    board = env.update_board(board_id, updates)
    return {"ok": True, "board": board, "boards": env.list_boards()}


def delete_gallery_board(env, board_id: str) -> dict[str, Any]:
    categories = env.delete_board(board_id)
    return {"ok": True, "id": board_id, "boards": env.list_boards(), "categories": categories}


def update_board_images(env, board_id: str, relative_paths: list[str], pinned: bool = True) -> dict[str, Any]:
    normalized_paths = [env.normalize_relative_path(path) for path in relative_paths if str(path).strip()]
    if not normalized_paths:
        raise ValueError("relative_paths required")

    for relative_path in normalized_paths:
        _, full_path = env.resolve_image_path(relative_path)
        if not os.path.exists(full_path):
            raise FileNotFoundError(f"image not found: {relative_path}")

    updated, categories = env.set_image_board_membership(normalized_paths, board_id, pinned=pinned)
    return {
        "ok": True,
        "updated": updated,
        "boards": env.list_boards(),
        "categories": categories,
    }


def get_gallery_context(env, force_refresh: bool = False) -> dict:
    output_dir = env.get_output_dir()
    base_dir = env.get_comfy_base_dir()
    import_dir = os.path.join(output_dir, env.IMPORT_IMAGE_SUBFOLDER) if output_dir else ""
    sources, _ = env.ensure_image_index_db_current(force_refresh=force_refresh)
    subfolder_details = env.collect_subfolder_details(output_dir, force_refresh=False)
    subfolders = [str(item["path"]) for item in subfolder_details]
    source_counts: dict[str, int] = {source["id"]: 0 for source in sources}
    pinned_count = 0
    if os.path.exists(env.GALLERY_INDEX_DB_FILE):
        with env._connect_gallery_index_db() as connection:
            env._ensure_auxiliary_tables_current(connection)
            env._sync_image_state_to_index_db(connection)
            for row in connection.execute("SELECT source_id, COUNT(*) AS total FROM gallery_images GROUP BY source_id"):
                source_counts[str(row["source_id"])] = int(row["total"])
            pinned_count = int(connection.execute("SELECT COUNT(*) AS total FROM gallery_images WHERE pinned = 1").fetchone()["total"])
            connection.commit()
    indexed_sources = [{**source, "image_count": source_counts.get(source["id"], 0)} for source in sources]

    return {
        "catalog_error": env.get_runtime().catalog_error,
        "read_only": env.get_runtime().catalog is None,
        "base_dir": base_dir,
        "output_dir_absolute": output_dir,
        "output_dir_relative": env.build_relative_display(output_dir, base_dir) if output_dir else "",
        "import_image_subfolder": env.IMPORT_IMAGE_SUBFOLDER,
        "import_image_target_relative": env.build_relative_display(import_dir, base_dir) if import_dir else "",
        "categories": env.collect_categories(),
        "subfolders": subfolders,
        "subfolder_details": subfolder_details,
        "move_targets": env.build_move_target_options({"sources": indexed_sources, "subfolders": subfolders}),
        "sources": indexed_sources,
        "active_source_count": sum(1 for source in indexed_sources if source.get("enabled") and source.get("exists")),
        "pinned_count": pinned_count,
        "color_index_status": env.get_color_index_status(),
        "boards": env.list_boards(force_refresh=False),
    }
