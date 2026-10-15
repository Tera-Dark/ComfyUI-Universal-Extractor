from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from py.gallery.uploads import UploadSession, recover_uploads


def validator(root):
    def validate(path, _kind):
        Path(path).resolve().relative_to(root.resolve())
    return validate


def test_upload_not_visible_until_commit_and_duplicate_names(tmp_path):
    session = UploadSession(tmp_path / "data", validator(tmp_path))
    target = tmp_path / "image.png"
    first = session.add(str(target), "image")
    second = session.add(str(target), "image")
    session.write(first, b"one")
    session.write(second, b"two")
    assert not target.exists()
    entries = session.commit()
    assert [Path(entry["target"]).read_bytes() for entry in entries] == [b"one", b"two"]
    assert not session.journal.exists()


def test_upload_abort_and_crash_recovery(tmp_path):
    session = UploadSession(tmp_path / "data", validator(tmp_path))
    session.write(session.add(str(tmp_path / "a.png"), "image"), b"partial")
    assert recover_uploads(tmp_path / "data", validator(tmp_path)) == []
    assert not Path(session.entries[0]["stage"]).exists()
    assert not (tmp_path / "a.png").exists()


def test_upload_commit_collision_preserves_user_file(tmp_path):
    session = UploadSession(tmp_path / "data", validator(tmp_path))
    session.write(session.add(str(tmp_path / "a.png"), "image"), b"new")
    (tmp_path / "a.png").write_bytes(b"existing")
    with pytest.raises(FileExistsError):
        session.commit()
    assert (tmp_path / "a.png").read_bytes() == b"existing"


def test_batch_saves_once_and_noop_does_not_save(isolated_gallery_env, monkeypatch):
    from py.gallery import state_store
    env = isolated_gallery_env
    for name in ("a.png", "b.png"):
        (env.output_dir / name).write_bytes(b"test")
    original = state_store.save_gallery_state
    calls = []
    def save(state):
        calls.append(True)
        original(state)
    monkeypatch.setattr(state_store, "save_gallery_state", save)
    result = env.service.batch_update_images(["a.png", "b.png", "a.png", "missing.png"], {"notes": "test"})
    assert result["updated"] == ["a.png", "b.png"]
    assert result["missing"] == ["missing.png"]
    assert len(calls) == 1
    env.service.batch_update_images(["a.png", "b.png"], {"notes": "test"})
    assert len(calls) == 1


def test_asset_identity_survives_rebuilt_index_and_tracks_content(isolated_gallery_env):
    env = isolated_gallery_env
    (env.output_dir / "a.png").write_bytes(b"one")
    (env.output_dir / "copy.png").write_bytes(b"one")
    first = env.service.list_images_page()["images"]
    ids = {row["filename"]: row["asset_id"] for row in first}
    assert ids["a.png"] and ids["a.png"] != ids["copy.png"]
    jobs = env.service.get_runtime().get_jobs()
    for job in jobs.list(active_only=True)["jobs"]:
        jobs.future(job["id"]).result(timeout=10)
    env.service.get_runtime().release_index_anchor()
    Path(env.service.GALLERY_INDEX_DB_FILE).unlink()
    rebuilt = env.service.list_images_page()["images"]
    assert {row["filename"]: row["asset_id"] for row in rebuilt} == ids
    (env.output_dir / "a.png").write_bytes(b"changed contents")
    changed = env.service.list_images_page(force_refresh=True)["images"]
    row = next(row for row in changed if row["filename"] == "a.png")
    assert row["asset_id"] == ids["a.png"]
    assert row["content_revision"] == 2


def test_corrupt_authoritative_catalog_is_not_rebuilt(isolated_gallery_env):
    env = isolated_gallery_env
    path = env.data_dir / "catalog.sqlite3"
    path.write_bytes(b"broken authoritative data")
    runtime = env.service.get_runtime()
    assert runtime.catalog is None
    assert path.read_bytes() == b"broken authoritative data"
    from py.gallery.catalog import CatalogUnavailable
    with pytest.raises(CatalogUnavailable):
        runtime.require_catalog()


def test_identity_survives_move_trash_restore(isolated_gallery_env):
    env = isolated_gallery_env
    (env.output_dir / "a.png").write_bytes(b"one")
    identity = env.service.list_images_page()["images"][0]["asset_id"]
    env.service.move_images(["a.png"], "destination")
    assert env.service.get_asset_identity("destination/a.png")["asset_id"] == identity
    env.service.delete_images(["destination/a.png"])
    item = env.service.list_trash_items()[0]
    assert item["asset_id"] == identity
    assert env.service.get_runtime().catalog.get(identity)["availability"] == "trashed"
    env.service.restore_trash_item(item["id"])
    assert env.service.get_asset_identity("destination/a.png")["asset_id"] == identity


def test_catalog_commit_failure_rolls_back_file_and_json(isolated_gallery_env, monkeypatch):
    env = isolated_gallery_env
    (env.output_dir / "a.png").write_bytes(b"one")
    identity = env.service.get_asset_identity("a.png")["asset_id"]
    env.service.persist_image_state("a.png", {"notes": "keep"})
    catalog = env.service.get_runtime().catalog
    original, calls = catalog.apply, []
    def fail_first(changes):
        calls.append(True)
        if len(calls) == 1:
            raise OSError("injected catalog write failure")
        return original(changes)
    monkeypatch.setattr(catalog, "apply", fail_first)
    with pytest.raises(RuntimeError, match="journal"):
        env.service.move_images(["a.png"], "destination")
    assert (env.output_dir / "a.png").read_bytes() == b"one"
    assert env.service.get_image_state("a.png")["notes"] == "keep"
    assert catalog.get(identity)["relative_path"] == "a.png"


@pytest.mark.anyio
async def test_analysis_cannot_block_committed_list(isolated_gallery_env):
    import threading
    from py.gallery.execution import execute
    env = isolated_gallery_env
    (env.output_dir / "a.png").write_bytes(b"one")
    runtime = env.service.get_runtime()
    await runtime.prepare_index()
    started, release = threading.Event(), threading.Event()
    jobs = runtime.get_jobs()
    def slow(context, _payload):
        started.set()
        release.wait(10)
        context.checkpoint()
        return {"ok": True}
    jobs.handlers["fingerprint_assets"] = ("analysis", slow)
    job = jobs.enqueue("fingerprint_assets", {"relative_paths": ["a.png"]})
    try:
        assert await asyncio.to_thread(started.wait, 3)
        result = await asyncio.wait_for(execute(runtime, env.service.list_images_page), 2)
        assert result["total"] == 1
        assert not release.is_set()
        jobs.cancel(job["id"])
    finally:
        release.set()
    with pytest.raises(RuntimeError, match="cancelled"):
        await asyncio.wrap_future(jobs.future(job["id"]))


def test_persistent_jobs_recover_and_deduplicate(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from py.gallery.catalog import Catalog
    from py.gallery.jobs import JobScheduler
    catalog = Catalog(tmp_path)
    with catalog.connect() as db:
        db.execute("INSERT INTO jobs(id,kind,dedupe_key,payload,state,created_at,updated_at) VALUES('recover','refresh_index','recover','{}','running',1,1)")
    with ThreadPoolExecutor(1) as scan, ThreadPoolExecutor(2) as analysis:
        scheduler = JobScheduler(catalog, scan, analysis, {"refresh_index": ("scan", lambda context, payload: {"recovered": True})})
        try:
            assert scheduler.future("recover").result(3) == {"recovered": True}
            assert scheduler.get("recover")["attempts"] == 1
        finally:
            scheduler.close()
            scheduler.catalog.close()


def test_failed_scan_does_not_treat_source_as_deleted(isolated_gallery_env, monkeypatch):
    env = isolated_gallery_env
    (env.output_dir / "a.png").write_bytes(b"one")
    identity = env.service.list_images_page()["images"][0]["asset_id"]
    original = env.service.os.scandir
    def deny(path):
        if Path(path) == env.output_dir:
            raise PermissionError("source temporarily unavailable")
        return original(path)
    monkeypatch.setattr(env.service.os, "scandir", deny)
    assert env.service.list_images_page(force_refresh=True)["total"] == 1
    assert env.service.get_runtime().catalog.get(identity)["availability"] == "online"


def test_job_queue_is_bounded_and_active_requests_coalesce(tmp_path):
    import threading
    from concurrent.futures import ThreadPoolExecutor
    from py.gallery.catalog import Catalog
    from py.gallery.jobs import JobScheduler, QueueFull
    release, started = threading.Event(), threading.Event()
    def hold(context, payload):
        started.set()
        release.wait(10)
        return {}
    with ThreadPoolExecutor(1) as scan, ThreadPoolExecutor(2) as analysis:
        scheduler = JobScheduler(Catalog(tmp_path), scan, analysis, {"refresh_index": ("scan", hold)})
        try:
            first = scheduler.enqueue("refresh_index", {"scope": "same"})
            assert started.wait(3)
            assert scheduler.enqueue("refresh_index", {"scope": "same"})["id"] == first["id"]
            for number in range(256):
                scheduler.enqueue("refresh_index", {"scope": str(number)})
            with pytest.raises(QueueFull):
                scheduler.enqueue("refresh_index", {"scope": "overflow"})
        finally:
            scheduler.close()
            release.set()
            scan.shutdown(wait=True)
            analysis.shutdown(wait=True)
            scheduler.catalog.close()


@pytest.mark.anyio
async def test_interrupted_upload_leaves_no_partial(isolated_gallery_env):
    from py.gallery import routes
    class Part:
        filename = "broken.png"
        count = 0
        async def read_chunk(self):
            self.count += 1
            if self.count == 1:
                return b"partial"
            raise ConnectionResetError("disconnected")
    class Reader:
        async def next(self):
            return Part()
    class Request:
        content_length = None
        async def multipart(self):
            return Reader()
    with pytest.raises(ConnectionResetError):
        await routes.api_import_files(Request())
    assert not list(isolated_gallery_env.output_dir.rglob("*.part"))
    assert not list(isolated_gallery_env.output_dir.rglob("broken.png"))


@pytest.fixture
def anyio_backend():
    return "asyncio"
