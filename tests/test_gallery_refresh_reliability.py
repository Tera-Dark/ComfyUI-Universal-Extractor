from concurrent.futures import ThreadPoolExecutor
import json
from threading import Event

import pytest

from py.gallery.catalog import Catalog
from py.gallery.jobs import JobScheduler


def test_refresh_requests_during_385_mutations_share_one_task(tmp_path):
    catalog = Catalog(tmp_path)
    started, release = Event(), Event()

    def scan(context, payload):
        started.set()
        release.wait(15)
        return {"ok": True}

    with ThreadPoolExecutor(1) as scans, ThreadPoolExecutor(2) as analysis:
        scheduler = JobScheduler(catalog, scans, analysis, {"refresh_index": ("scan", scan)})
        try:
            first = scheduler.enqueue("refresh_index", {"subfolder": "", "force": True, "_generation": 0})
            assert started.wait(3)
            for generation in range(1, 386):
                job = scheduler.enqueue("refresh_index", {"subfolder": "", "force": True, "_generation": generation})
                assert job["id"] == first["id"]
            assert scheduler.list()["total"] == 1
            future = scheduler.future(first["id"])
            release.set()
            assert future.result(5) == {"ok": True}
        finally:
            release.set()
            scheduler.close()
    catalog.close()


def test_scan_conflict_retries_same_job_then_commits_fresh_snapshot(isolated_gallery_env, monkeypatch):
    service = isolated_gallery_env.service
    (isolated_gallery_env.output_dir / "a.png").write_bytes(b"image")
    service.list_images_page()
    runtime = service.get_runtime()
    original = service._scan_index_records_for_scope
    scans = []

    def change_once(sources, scope):
        records = original(sources, scope)
        scans.append(True)
        if len(scans) == 1:
            # Simulate a file commit after enumeration and before index commit.
            runtime.catalog.apply([])
        return records

    monkeypatch.setattr(service, "_scan_index_records_for_scope", change_once)
    scheduler = runtime.get_jobs()
    job = scheduler.enqueue("refresh_index", {"subfolder": "", "force": True})
    assert scheduler.future(job["id"]).result(10) == {"ok": True}
    assert scheduler.get(job["id"])["attempts"] == 2
    assert len(scans) == 2
    assert service.list_images_page()["total"] == 1


def test_waiting_scan_captures_generation_only_after_getting_scan_lock(isolated_gallery_env, monkeypatch):
    from py.gallery.jobs import JobContext
    service = isolated_gallery_env.service
    (isolated_gallery_env.output_dir / "a.png").write_bytes(b"image")
    service.list_images_page()
    runtime = service.get_runtime()
    reached_scan = Event()
    checkpoint = JobContext.checkpoint

    def observe(context, completed=None, total=None):
        checkpoint(context, completed, total)
        if (completed, total) == (0, 1):
            reached_scan.set()

    monkeypatch.setattr(JobContext, "checkpoint", observe)
    scheduler = runtime.get_jobs()
    with runtime.scan_sync_lock:
        job = scheduler.enqueue("refresh_index", {"force": True})
        assert reached_scan.wait(3)
        runtime.catalog.apply([])
    assert scheduler.future(job["id"]).result(5) == {"ok": True}
    assert scheduler.get(job["id"])["attempts"] == 1


def test_continuous_conflict_fails_after_three_attempts_without_forking_jobs(tmp_path, monkeypatch):
    catalog = Catalog(tmp_path)
    calls = []

    def conflict(context, payload):
        calls.append(True)
        raise OSError("Gallery files changed during indexing")

    with ThreadPoolExecutor(1) as scans, ThreadPoolExecutor(2) as analysis:
        scheduler = JobScheduler(catalog, scans, analysis, {"refresh_index": ("scan", conflict)})
        finish = scheduler._finish
        # Skip only the test clock delay; exercise real scheduling/state/retry limits.
        monkeypatch.setattr(scheduler, "_finish", lambda *args, **kwargs: finish(*args, **{**kwargs, "retry_at": 0}))
        try:
            job = scheduler.enqueue("refresh_index", {"force": True})
            with pytest.raises(RuntimeError, match="Gallery files changed"):
                scheduler.future(job["id"]).result(5)
            assert len(calls) == 3
            assert scheduler.list()["total"] == 1
            assert scheduler.get(job["id"])["state"] == "failed"
        finally:
            scheduler.close()
    catalog.close()


def test_restart_consolidates_legacy_refresh_backlog_without_removing_history(tmp_path):
    catalog = Catalog(tmp_path)
    with catalog.connect() as db:
        for generation in range(385):
            db.execute("INSERT INTO jobs(id,kind,dedupe_key,payload,state,created_at,updated_at) VALUES(?, 'refresh_index', ?, ?, 'queued', ?, 0)",
                       (str(generation), f"legacy-{generation}", json.dumps({"subfolder": "", "force": True, "_generation": generation, "_processor_version": "1"}), generation))
    calls = []
    with ThreadPoolExecutor(1) as scans, ThreadPoolExecutor(2) as analysis:
        scheduler = JobScheduler(catalog, scans, analysis, {"refresh_index": ("scan", lambda context, payload: calls.append(payload["_generation"]))})
        try:
            scheduler.future("384").result(5)
            assert calls == [384]
            with catalog.connect() as db:
                assert db.execute("SELECT COUNT(*) FROM jobs").fetchone()[0] == 385
                assert db.execute("SELECT COUNT(*) FROM jobs WHERE state='cancelled'").fetchone()[0] == 384
            assert scheduler.get("0")["result"] == {"superseded_by": "384"}
        finally:
            scheduler.close()
    catalog.close()
