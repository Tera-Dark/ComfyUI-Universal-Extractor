"""Regressions for large galleries and refresh work that must not repeat."""
from __future__ import annotations

import os
import sqlite3

import pytest

from py.gallery.sqlite_batch import SQLITE_BIND_BATCH_SIZE, iter_sqlite_batches


def test_sqlite_bind_batches_are_portable():
    values = list(range(2101))
    batches = list(iter_sqlite_batches(values))
    assert [len(batch) for batch in batches] == [900, 900, 301]
    assert [value for batch in batches for value in batch] == values
    assert list(iter_sqlite_batches([])) == []
    with pytest.raises(ValueError):
        list(iter_sqlite_batches(values, SQLITE_BIND_BATCH_SIZE + 1))


def test_large_state_sync_only_reindexes_changed_rows_and_boards(isolated_gallery_env, monkeypatch):
    from py import paths

    service = isolated_gallery_env.service
    service.list_images_page()  # Initialize an isolated database and signature.
    board = isolated_gallery_env.state_store.create_board("Pinned shots")
    filenames = [f"shot_{index:04}.png" for index in range(1205)]
    newest = filenames[-1]
    (isolated_gallery_env.output_dir / newest).write_bytes(b"image")

    with service._connect_gallery_index_db() as connection:
        # Python 3.10's older bundled SQLite may cap this at 999 by default.
        if hasattr(connection, "setlimit"):
            connection.setlimit(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER, 999)
        connection.executemany(
            """
            INSERT INTO gallery_images(
                relative_path, source_id, source_relative_path, filename,
                relative_dir, subfolder, display_subfolder, size,
                created_at, modified_at, scanned_at
            ) VALUES(?, ?, ?, ?, '', '', '', 1, ?, ?, 1)
            """,
            [(name, service.DEFAULT_OUTPUT_SOURCE_ID, name, name, index, index) for index, name in enumerate(filenames)],
        )
        connection.executemany(
            "INSERT INTO gallery_image_fingerprints(relative_path) VALUES(?)",
            [(name,) for name in filenames],
        )
        connection.commit()
        fingerprints = service._lookup_fingerprint_rows(connection, filenames)
        assert len(fingerprints) == len(filenames)
        image_rows = connection.execute("SELECT relative_path FROM gallery_images ORDER BY created_at DESC").fetchall()
        assert len(service._rows_with_fingerprints(connection, image_rows)) == len(filenames)

    state = paths.load_gallery_state()
    state["images"] = {name: {"pinned": True, "boards": [board["id"]]} for name in filenames}
    paths.save_gallery_state(state)
    with service._connect_gallery_index_db() as connection:
        if hasattr(connection, "setlimit"):
            connection.setlimit(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER, 999)
        assert service._sync_image_state_to_index_db(connection) is True
        connection.commit()

    summaries = service.list_boards()
    assert summaries[0]["count"] == len(filenames)
    assert summaries[0]["cover_image"]["relative_path"] == newest

    reindexed: list[int] = []
    real_sync = service._sync_auxiliary_rows

    def track_sync(connection, rows, remove_paths=None):
        reindexed.append(len(rows))
        return real_sync(connection, rows, remove_paths)

    monkeypatch.setattr(service, "_sync_auxiliary_rows", track_sync)
    state["images"][newest]["notes"] = "searchable-one-change"
    paths.save_gallery_state(state)
    with service._connect_gallery_index_db() as connection:
        if hasattr(connection, "setlimit"):
            connection.setlimit(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER, 999)
        assert service._sync_image_state_to_index_db(connection) is True
        connection.commit()
        row = connection.execute("SELECT notes FROM gallery_images WHERE relative_path = ?", (newest,)).fetchone()
        assert row["notes"] == "searchable-one-change"
        if service._index_meta_get(connection, "fts_available") == "1":
            results = connection.execute(
                "SELECT relative_path FROM gallery_images_fts WHERE gallery_images_fts MATCH ?",
                ('"searchable-one-change"',),
            ).fetchall()
            assert [result["relative_path"] for result in results] == [newest]
    assert reindexed == [1]

    del state["images"][newest]
    paths.save_gallery_state(state)
    with service._connect_gallery_index_db() as connection:
        if hasattr(connection, "setlimit"):
            connection.setlimit(sqlite3.SQLITE_LIMIT_VARIABLE_NUMBER, 999)
        assert service._sync_image_state_to_index_db(connection) is True
        connection.commit()
        cleared = connection.execute(
            "SELECT pinned, notes, boards_text FROM gallery_images WHERE relative_path = ?", (newest,),
        ).fetchone()
        assert (cleared["pinned"], cleared["notes"], cleared["boards_text"]) == (0, "", "")
    assert reindexed == [1, 1]
    assert service.list_boards()[0]["count"] == len(filenames) - 1


def test_forced_context_refresh_scans_once(isolated_gallery_env, monkeypatch):
    service = isolated_gallery_env.service
    (isolated_gallery_env.output_dir / "fresh.png").write_bytes(b"image")
    service.list_images_page(force_refresh=True)
    real_scan = service._scan_index_records_for_scope
    scans: list[str] = []

    def count_scan(sources, scope=""):
        scans.append(scope)
        return real_scan(sources, scope)

    monkeypatch.setattr(service, "_scan_index_records_for_scope", count_scan)
    context = service.get_gallery_context(force_refresh=True)
    assert context["sources"][0]["image_count"] == 1
    assert scans == [""]


def test_freshness_cache_is_bounded_and_order_independent(isolated_gallery_env, monkeypatch):
    service = isolated_gallery_env.service
    monkeypatch.setattr(service, "IMAGE_FRESHNESS_CACHE_TTL_SECONDS", 0)
    for name in ("z.png", "a.png", "sub/b.png"):
        path = isolated_gallery_env.output_dir / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(name.encode())

    original = service.get_image_freshness()
    real_scandir = os.scandir

    def reversed_scandir(path):
        class ReversedDirectory:
            def __enter__(self):
                with real_scandir(path) as entries:
                    return iter(reversed(list(entries)))

            def __exit__(self, *_args):
                return False

        return ReversedDirectory()

    monkeypatch.setattr(service.os, "scandir", reversed_scandir)
    again = service.get_image_freshness(known=original["fingerprint"])
    assert again["changed"] is False
    assert again["image_count"] == 3
    for number in range(service.IMAGE_FRESHNESS_CACHE_MAX_SCOPES + 7):
        service.get_image_freshness(subfolder=f"no-such-folder-{number}")
    assert len(service.IMAGE_FRESHNESS_CACHE) == service.IMAGE_FRESHNESS_CACHE_MAX_SCOPES
    assert service.get_image_freshness(known=original["fingerprint"])["changed"] is False
