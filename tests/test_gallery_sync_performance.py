"""Real-file operation counts and failure cases, using isolated sources only."""
import os
from threading import Event
from concurrent.futures import ThreadPoolExecutor

from py.gallery.catalog import Catalog
from py.gallery.jobs import JobScheduler
from py.gallery.image_safety import extract_rgba_pixels
from py.gallery.sync_signals import OutputSignals


def test_modern_pillow_rgba_tuples_are_not_grouped_as_channels():
    class Pixels:
        def get_flattened_data(self):
            return ((10, 20, 30, 255), (40, 50, 60, 127))
    assert extract_rgba_pixels(Pixels()) == [(10, 20, 30, 255), (40, 50, 60, 127)]


def test_backend_observes_private_api_completions_without_websocket_bridge(isolated_gallery_env):
    service = isolated_gallery_env.service
    (isolated_gallery_env.output_dir / "today").mkdir()
    history = {"old": {"prompt": {"private": "never copied"}, "outputs": {}}}
    calls = []
    def reader(*, max_items, map_function):
        calls.append(max_items)
        return {key: map_function(value) for key, value in history.items()}
    signals = OutputSignals(reader)
    signals.ingest_history(service)
    assert signals.since(0)["events"] == []  # startup is not 256 new completions
    for prompt in ("api-success", "api-failed-after-saving", "cached"):
        history[prompt] = {"outputs": {"save": {"images": [{"type": "output", "subfolder": "today"}]}}}
    signals.history_checked = 0
    signals.ingest_history(service)
    events = signals.since(0)["events"]
    assert len(events) == 3
    assert all(event["scopes"] == ["default_output::today"] for event in events)
    assert all("prompt" not in event and "outputs" not in event for event in events)
    signals.publish("api-success", [])  # duplicate browser relay
    signals.history_checked = 0
    signals.ingest_history(service)
    assert signals.sequence == 3
    assert calls == [256, 256, 256]


def test_refresh_walks_once_and_observes_only_changes(isolated_gallery_env, monkeypatch):
    service = isolated_gallery_env.service
    for name in ("one/a.png", "two/b.png"):
        path = isolated_gallery_env.output_dir / name
        path.parent.mkdir(exist_ok=True)
        path.write_bytes(b"image")
    monkeypatch.setattr(service, "_schedule_dimension_backfill", lambda *args: None)
    monkeypatch.setattr(service, "_schedule_color_index_backfill", lambda *args: None)
    service.list_images_page()
    catalog = service.get_runtime().catalog
    observed, walked = [], []
    observe, scandir = catalog.observe_many, os.scandir

    def record(source, records):
        observed.extend(records)
        return observe(source, records)

    def walk(path):
        walked.append(os.fspath(path))
        return scandir(path)

    monkeypatch.setattr(catalog, "observe_many", record)
    monkeypatch.setattr(os, "scandir", walk)
    def no_scan_urls(*args):
        raise AssertionError("scan must not construct URLs for every indexed image")
    monkeypatch.setattr(service, "build_view_url", no_scan_urls)
    service.ensure_image_index_db_current(force_refresh=True)
    assert observed == []
    assert len(walked) == len(set(walked))  # no second directory walk
    (isolated_gallery_env.output_dir / "one/new.png").write_bytes(b"new")
    service.ensure_image_index_db_current(force_refresh=True, scope="default_output::one")
    assert len(observed) == 1 and observed[0][0] == "one/new.png"
    with service._connect_gallery_index_db() as db:
        folders = [row[0] for row in db.execute("SELECT relative_path FROM gallery_folders")]
    assert "one" in folders and "two" in folders  # scoped refresh preserves siblings


def test_same_second_edit_advances_revision(isolated_gallery_env):
    service = isolated_gallery_env.service
    path = isolated_gallery_env.output_dir / "edit.png"
    path.write_bytes(b"old")
    first = service.list_images_page()["images"][0]
    before = path.stat()
    path.write_bytes(b"new")
    os.utime(path, ns=(before.st_atime_ns, before.st_mtime_ns + 1000))
    after = service.list_images_page(force_refresh=True)["images"][0]
    assert after["asset_id"] == first["asset_id"]
    assert after["content_revision"] == first["content_revision"] + 1


def test_whole_refresh_covers_narrower_refresh(tmp_path):
    catalog = Catalog(tmp_path)
    started, release = Event(), Event()
    def scan(context, payload):
        started.set()
        release.wait(10)
        return {"ok": True}
    with ThreadPoolExecutor(1) as scans, ThreadPoolExecutor(2) as analysis:
        jobs = JobScheduler(catalog, scans, analysis, {"refresh_index": ("scan", scan)})
        try:
            first = jobs.enqueue("refresh_index", {"subfolder": "", "force": True})
            assert started.wait(2)
            second = jobs.enqueue("refresh_index", {"subfolder": "default_output::folder", "force": True})
            assert first["id"] == second["id"]
        finally:
            release.set()
            jobs.close()
    catalog.close()


def test_new_completion_gets_one_followup_instead_of_joining_an_older_scan(tmp_path):
    catalog = Catalog(tmp_path)
    started, release = Event(), Event()
    def scan(context, payload):
        started.set()
        release.wait(10)
        return {"ok": True}
    with ThreadPoolExecutor(1) as scans, ThreadPoolExecutor(2) as analysis:
        jobs = JobScheduler(catalog, scans, analysis, {"refresh_index": ("scan", scan)})
        try:
            older = jobs.enqueue("refresh_index", {"subfolder": "", "force": True, "_output_sequence": 0})
            assert started.wait(2)
            followup = jobs.enqueue("refresh_index", {"subfolder": "default_output::today", "force": True, "_output_sequence": 1})
            assert followup["id"] != older["id"]
            latest = jobs.enqueue("refresh_index", {"subfolder": "default_output::today", "force": True, "_output_sequence": 2})
            assert latest["id"] == followup["id"]
            assert latest["payload"]["_output_sequence"] == 2
            assert jobs.list()["total"] == 2
        finally:
            release.set()
            jobs.close()
    catalog.close()


def test_backfills_keep_one_running_and_one_latest_followup(tmp_path):
    catalog = Catalog(tmp_path)
    started, release = Event(), Event()
    calls = []
    def analyze(context, payload):
        calls.append(payload["_built"])
        if len(calls) == 1:
            started.set()
            release.wait(10)
        return {"ok": True}
    with ThreadPoolExecutor(1) as scans, ThreadPoolExecutor(2) as analysis:
        jobs = JobScheduler(catalog, scans, analysis, {"colors": ("analysis", analyze)})
        try:
            jobs.enqueue("colors", {"_signature": "same", "_built": "0"})
            assert started.wait(2)
            followup = jobs.enqueue("colors", {"_signature": "same", "_built": "1"})
            for number in range(2, 31):
                assert jobs.enqueue("colors", {"_signature": "same", "_built": str(number)})["id"] == followup["id"]
            assert jobs.list()["total"] == 2
            assert calls == ["0"]
            future = jobs.future(followup["id"])
            release.set()
            assert future.result(5) == {"ok": True}
            assert calls == ["0", "30"]
        finally:
            release.set()
            jobs.close()
    catalog.close()


def test_fts_rowids_migrate_and_keep_unrelated_results(isolated_gallery_env):
    service = isolated_gallery_env.service
    for name in ("a.png", "b.png"):
        (isolated_gallery_env.output_dir / name).write_bytes(b"image")
    service.list_images_page()
    with service._connect_gallery_index_db() as db:
        if service._index_meta_get(db, "fts_available") != "1":
            return  # Behavior still runs in LIKE mode on SQLite without FTS5.
        db.execute("DELETE FROM gallery_images_fts")
        db.execute("DELETE FROM gallery_fts_rows")
        db.execute("DELETE FROM gallery_index_meta WHERE key='fts_rowid_map_version'")
        db.executemany("INSERT INTO gallery_images_fts(rowid,relative_path,search_text) VALUES(?,?,?)",
                       [(14, "a.png", "previous alpha"), (23, "b.png", "unchanged bravo")])
    service.get_runtime().index_initialized.clear()
    with service._connect_gallery_index_db() as db:
        statements = []
        db.set_trace_callback(statements.append)
        rows = db.execute("SELECT * FROM gallery_images WHERE relative_path='a.png'").fetchall()
        service._sync_auxiliary_rows(db, rows)
        assert db.execute("SELECT rowid FROM gallery_images_fts WHERE relative_path='a.png'").fetchone()[0] == 14
        assert db.execute("SELECT relative_path FROM gallery_images_fts WHERE gallery_images_fts MATCH 'bravo'").fetchone()[0] == "b.png"
        db.execute("DELETE FROM gallery_images WHERE relative_path='a.png'")
        service._sync_auxiliary_rows(db, [], remove_paths=["a.png"])
        assert db.execute("SELECT COUNT(*) FROM gallery_images_fts").fetchone()[0] == 1
        assert db.execute("SELECT COUNT(*) FROM gallery_fts_rows").fetchone()[0] == 1
        assert not any(sql.startswith("DELETE FROM gallery_images_fts WHERE relative_path") for sql in statements)
