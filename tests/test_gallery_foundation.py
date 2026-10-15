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


def test_upload_later_publish_failure_rolls_back_earlier_files(tmp_path, monkeypatch):
    import os
    session = UploadSession(tmp_path / "data", validator(tmp_path))
    for name in ("a.png", "b.png"):
        session.write(session.add(str(tmp_path / name), "image"), b"new")
    original = os.link
    def fail_second(source, target):
        if str(target).endswith("b.png"):
            raise OSError("injected disk failure")
        original(source, target)
    monkeypatch.setattr(os, "link", fail_second)
    with pytest.raises(OSError):
        session.commit()
    assert not (tmp_path / "a.png").exists()
    assert not (tmp_path / "b.png").exists()
    assert not list(tmp_path.rglob("*.part"))


def test_upload_restart_recovers_link_created_before_journal_save(tmp_path):
    import os
    from py.gallery.uploads import _identity
    session = UploadSession(tmp_path / "data", validator(tmp_path))
    target = tmp_path / "a.png"
    session.write(session.add(str(target), "image"), b"new")
    session.entries[0]["identity"] = _identity(session.entries[0]["stage"])
    session.status = "committing"
    session.save()
    os.link(session.entries[0]["stage"], target)
    assert recover_uploads(tmp_path / "data", validator(tmp_path)) == []
    assert not target.exists()


@pytest.mark.parametrize("phase", ["catalog", "commit_journal"])
def test_upload_final_commit_failure_still_rolls_back(tmp_path, monkeypatch, phase):
    session = UploadSession(tmp_path / "data", validator(tmp_path))
    target = tmp_path / "a.png"
    session.write(session.add(str(target), "image"), b"new")
    def fail():
        raise OSError("injected final commit failure")
    if phase == "commit_journal":
        original = session.save
        def save(status=None):
            if status == "committed":
                fail()
            original(status)
        monkeypatch.setattr(session, "save", save)
    with pytest.raises(OSError):
        session.commit(fail if phase == "catalog" else None)
    assert not target.exists()
    assert not list(tmp_path.rglob("*.part"))


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


@pytest.mark.parametrize("phase", ["stage", "publish", "json"])
def test_file_transaction_fault_boundaries(isolated_gallery_env, monkeypatch, phase):
    from py.gallery import file_transactions
    env = isolated_gallery_env
    source = env.output_dir / "a.png"
    source.write_bytes(b"valuable")
    identity = env.service.get_asset_identity("a.png")["asset_id"]
    env.service.persist_image_state("a.png", {"notes": "keep"})
    target_object, attribute = ((file_transactions.os, "rename") if phase == "stage" else
                                (file_transactions, "_transfer_file") if phase == "publish" else
                                (env.service, "move_image_states"))
    original = getattr(target_object, attribute)
    calls = []
    def fail_once(*args, **kwargs):
        calls.append(True)
        if len(calls) == 1:
            raise OSError(f"injected {phase} failure")
        return original(*args, **kwargs)
    monkeypatch.setattr(target_object, attribute, fail_once)
    with pytest.raises(RuntimeError, match="journal"):
        env.service.move_images(["a.png"], "destination")
    assert source.read_bytes() == b"valuable"
    assert not (env.output_dir / "destination" / "a.png").exists()
    assert env.service.get_image_state("a.png")["notes"] == "keep"
    assert env.service.get_runtime().catalog.get(identity)["relative_path"] == "a.png"


def test_unresolved_transaction_blocks_folder_creation_and_upload_targets(isolated_gallery_env):
    env = isolated_gallery_env
    journal = env.data_dir / "operation_journal"
    journal.mkdir()
    (journal / "pending.json").write_text('{"status":"needs_recovery"}')
    with pytest.raises(RuntimeError, match="Unresolved"):
        env.service.create_folder("new")
    with pytest.raises(RuntimeError, match="Unresolved"):
        env.service.get_import_target_for_filename("a.png")
    assert not (env.output_dir / "new").exists()


def test_same_second_content_revision_invalidates_derived_dimensions_and_color(isolated_gallery_env, monkeypatch):
    import os
    env = isolated_gallery_env
    monkeypatch.setattr(env.service, "_schedule_color_index_backfill", lambda *args: None)
    monkeypatch.setattr(env.service, "_schedule_dimension_backfill", lambda *args: None)
    path = env.output_dir / "a.png"
    path.write_bytes(b"one")
    env.service.list_images_page()
    with env.service._connect_gallery_index_db() as db:
        db.execute("UPDATE gallery_images SET image_width=10,image_height=20,dominant_color='#ff0000',color_family='red',color_family_scores_json='{\"red\":1}'")
    previous = path.stat()
    path.write_bytes(b"two")
    # NTFS stores 100 ns ticks; a 1 ns edit can round back to the same value.
    next_mtime = previous.st_mtime_ns + (100_000 if previous.st_mtime_ns % 1_000_000_000 < 999_900_000 else -100_000)
    os.utime(path, ns=(previous.st_atime_ns, next_mtime))
    env.service.ensure_image_index_db_current(force_refresh=True)
    with env.service._connect_gallery_index_db() as db:
        row = db.execute("SELECT * FROM gallery_images").fetchone()
        assert row["content_revision"] == 2
        assert row["image_width"] == row["image_height"] == 0
        assert row["dominant_color"] == ""


def test_analysis_result_is_discarded_after_resource_move(isolated_gallery_env, monkeypatch):
    import threading
    env = isolated_gallery_env
    monkeypatch.setattr(env.service, "_schedule_color_index_backfill", lambda *args: None)
    monkeypatch.setattr(env.service, "_schedule_dimension_backfill", lambda *args: None)
    (env.output_dir / "a.png").write_bytes(b"one")
    env.service.list_images_page()
    runtime = env.service.get_runtime()
    started, release = threading.Event(), threading.Event()
    def blocked_fingerprint(path, filename):
        started.set()
        release.wait(5)
        return {"file_hash": "old", "version": env.service.FINGERPRINT_VERSION}
    monkeypatch.setattr(env.service, "build_image_fingerprint", blocked_fingerprint)
    future = runtime.analysis_executor.submit(env.service.prewarm_image_fingerprints, relative_paths=["a.png"])
    try:
        assert started.wait(3)
        env.service.rename_image("a.png", "b.png")
    finally:
        release.set()
    future.result(5)
    with env.service._connect_gallery_index_db() as db:
        assert db.execute("SELECT COUNT(*) FROM gallery_image_fingerprints WHERE relative_path='a.png'").fetchone()[0] == 0


@pytest.mark.parametrize("kind", ["colors", "dimensions"])
def test_invalid_image_analysis_retains_soft_failure_diagnostics(isolated_gallery_env, monkeypatch, kind):
    env = isolated_gallery_env
    monkeypatch.setattr(env.service, "_schedule_color_index_backfill", lambda *args: None)
    monkeypatch.setattr(env.service, "_schedule_dimension_backfill", lambda *args: None)
    (env.output_dir / "broken.png").write_bytes(b"not an image")
    identity = env.service.list_images_page()["images"][0]["asset_id"]
    jobs = env.service.get_runtime().get_jobs()
    job = jobs.enqueue(kind, version="test-processor")
    result = jobs.future(job["id"]).result(5)
    assert result["failed"] == 1
    assert result["diagnostics"][0]["asset_id"] == identity
    assert job["payload"]["_processor_version"] == "test-processor"
    assert env.service.list_images_page()["total"] == 1
    with env.service._connect_gallery_index_db() as db:
        assert db.execute("SELECT dominant_color FROM gallery_images").fetchone()[0] == ""


@pytest.mark.parametrize("error_type,attempts", [(OSError, 2), (PermissionError, 1)])
def test_jobs_retry_only_transient_io(tmp_path, error_type, attempts):
    from concurrent.futures import ThreadPoolExecutor
    from py.gallery.catalog import Catalog
    from py.gallery.jobs import JobScheduler
    calls = []
    def handler(context, payload):
        calls.append(True)
        if len(calls) == 1:
            raise error_type("injected IO error")
        return {"ok": True}
    catalog = Catalog(tmp_path)
    with ThreadPoolExecutor(1) as scan, ThreadPoolExecutor(2) as analysis:
        scheduler = JobScheduler(catalog, scan, analysis, {"refresh_index": ("scan", handler)})
        try:
            job = scheduler.enqueue("refresh_index")
            future = scheduler.future(job["id"])
            if error_type is PermissionError:
                with pytest.raises(RuntimeError, match="injected IO"):
                    future.result(5)
            else:
                assert future.result(5) == {"ok": True}
            assert scheduler.get(job["id"])["attempts"] == attempts
        finally:
            scheduler.close()
    catalog.close()


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


@pytest.mark.anyio
async def test_hot_context_uses_folder_snapshot_without_traversal(isolated_gallery_env, monkeypatch):
    from py.gallery.execution import execute
    env = isolated_gallery_env
    (env.output_dir / "empty-folder").mkdir()
    (env.output_dir / ".ue-uploads" / "session").mkdir(parents=True)
    runtime = env.service.get_runtime()
    await runtime.prepare_index()
    def forbidden_scan(path):
        raise AssertionError("hot context must not traverse directories")
    monkeypatch.setattr(env.service.os, "scandir", forbidden_scan)
    context = await execute(runtime, env.service.get_gallery_context)
    assert "default_output::empty-folder" in context["subfolders"]
    assert not any(".ue-uploads" in folder for folder in context["subfolders"])


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


def test_catalog_schema_upgrade_keeps_backup(tmp_path, monkeypatch):
    from py.gallery.catalog import Catalog
    catalog = Catalog(tmp_path)
    catalog.close()
    monkeypatch.setattr(Catalog, "VERSION", 2)
    upgraded = Catalog(tmp_path)
    try:
        assert list(tmp_path.glob("catalog.sqlite3.bak-*"))
        with upgraded.connect() as db:
            assert db.execute("PRAGMA user_version").fetchone()[0] == 2
    finally:
        upgraded.close()


def test_shutdown_keeps_runtime_available_until_workers_finish(isolated_gallery_env):
    import threading
    service = isolated_gallery_env.service
    runtime = service.get_runtime()
    release = threading.Event()
    observed = []
    def draining_worker():
        release.wait(3)
        observed.append(service.get_runtime())
    runtime.analysis_executor.submit(draining_worker)
    original_shutdown = runtime.scan_executor.shutdown
    def begin_shutdown(**kwargs):
        release.set()
        return original_shutdown(**kwargs)
    runtime.scan_executor.shutdown = begin_shutdown
    original_close = runtime.release_index_anchor
    def release_after_workers():
        assert observed == [runtime]
        original_close()
    runtime.release_index_anchor = release_after_workers
    runtime.close()
    assert runtime.closed


@pytest.mark.anyio
@pytest.mark.parametrize("failure", [ConnectionResetError, asyncio.CancelledError])
async def test_interrupted_upload_leaves_no_partial(isolated_gallery_env, failure):
    from py.gallery import routes
    class Part:
        filename = "broken.png"
        count = 0
        async def read_chunk(self):
            self.count += 1
            if self.count == 1:
                return b"partial"
            raise failure("disconnected")
    class Reader:
        async def next(self):
            return Part()
    class Request:
        content_length = None
        async def multipart(self):
            return Reader()
    with pytest.raises(failure):
        await routes.api_import_files(Request())
    assert not list(isolated_gallery_env.output_dir.rglob("*.part"))
    assert not list(isolated_gallery_env.output_dir.rglob("broken.png"))


@pytest.fixture
def anyio_backend():
    return "asyncio"
