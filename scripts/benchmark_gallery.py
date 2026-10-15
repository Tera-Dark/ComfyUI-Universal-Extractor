"""Reproducible isolated benchmark; never writes to registered user sources.

python scripts/benchmark_gallery.py --output artifacts/foundation-baseline.json
python scripts/benchmark_gallery.py --output artifacts/foundation-after.json --compare artifacts/foundation-baseline.json
Synthetic index timings are NOT measurements of a real file traversal.
"""
from __future__ import annotations

import argparse
import gc
import importlib.util
import json
import platform
import statistics
import sys
import tempfile
import time
from threading import Event
from contextlib import ExitStack
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def measure(function, samples=30):
    for _ in range(5):
        function()
    values = []
    for _ in range(samples):
        start = time.perf_counter()
        function()
        values.append((time.perf_counter() - start) * 1000)
    return {"p50_ms": statistics.median(values), "p95_ms": sorted(values)[int(.95 * (samples - 1))]}


def main():
    import pytest
    from PIL import Image
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--compare", type=Path)
    args = parser.parse_args()
    spec = importlib.util.spec_from_file_location("benchmark_fixtures", ROOT / "tests/conftest.py")
    fixtures = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fixtures)
    report = {"python": sys.version, "platform": platform.platform(), "real_sources": "not measured", "samples": 30, "warmups": 5, "datasets": {}}
    with tempfile.TemporaryDirectory(prefix="ue-benchmark-") as temporary, pytest.MonkeyPatch.context() as patch, ExitStack() as cleanup:
        fixture = fixtures.isolated_gallery_env.__wrapped__(Path(temporary), patch)
        env = next(fixture) if hasattr(fixture, "__next__") else fixture
        service = env.service
        def close_environment():
            runtime = getattr(service, "_runtime", None)
            if runtime:
                runtime.close()
            else:
                for executor in (service.COLOR_INDEX_EXECUTOR, service.DIMENSION_BACKFILL_EXECUTOR, service.THUMB_PREWARM_EXECUTOR):
                    executor.shutdown(wait=True)
            if hasattr(fixture, "__next__"):
                next(fixture, None)
            gc.collect()
        cleanup.callback(close_environment)
        for number in range(20):
            Image.new("RGB", (64, 48), (number, 90, 120)).save(env.output_dir / f"sample_{number}.png")
        start = time.perf_counter()
        service.list_images_page()
        report["cold_real_sample_ms"] = (time.perf_counter() - start) * 1000
        report["freshness_real_20_images"] = measure(lambda: service.get_image_freshness())
        scan_sources = service.list_gallery_sources()
        report["scan_real_20_images"] = measure(lambda: service._scan_index_records_for_scope(scan_sources))
        report["batch_real_20_images"] = measure(lambda: service.batch_update_images([f"sample_{n}.png" for n in range(20)], {"notes": str(time.perf_counter())}))
        runtime = getattr(service, "_runtime", None)
        if runtime and runtime.jobs:
            for job in runtime.jobs.list(active_only=True)["jobs"]:
                runtime.jobs.future(job["id"]).result(timeout=30)
        def snapshot(function):
            if not hasattr(service, "get_runtime"):
                return function()
            from py.gallery.execution import QUERY_ONLY, READ_CONNECTIONS
            from py.gallery.environment import SOURCE_SNAPSHOT
            source_token = SOURCE_SNAPSHOT.set(service.get_runtime().source_snapshot())
            token = QUERY_ONLY.set(True)
            connections = {}
            read_token = READ_CONNECTIONS.set(connections)
            try:
                return function()
            finally:
                for connection in connections.values():
                    connection.close()
                READ_CONNECTIONS.reset(read_token)
                QUERY_ONLY.reset(token)
                SOURCE_SNAPSHOT.reset(source_token)
        # Synthetic rows benchmark SQL/serialization, not absent files/decoding.
        patch.setattr(service, "_schedule_dimension_backfill_if_needed", lambda *a, **k: None)
        patch.setattr(service, "_schedule_color_index_backfill", lambda *a, **k: None)
        for count in (10_000, 50_000):
            with service._connect_gallery_index_db() as db:
                db.executemany("INSERT OR IGNORE INTO gallery_images(relative_path,source_id,source_relative_path,filename,relative_dir,subfolder,display_subfolder,size,image_width,image_height,created_at,modified_at,scanned_at) VALUES(?,?,?,?, '', '', '', 100,64,48,?,?,1)",
                               [(f"synthetic_{n}.png", "default_output", f"synthetic_{n}.png", f"synthetic_{n}.png", n, n) for n in range(count)])
                db.commit()
            # Prepare derived helpers before taking hot-query measurements.
            service.list_images_page()
            report["datasets"][str(count)] = {"list": measure(lambda: snapshot(service.list_images_page)), "context": measure(lambda: snapshot(service.get_gallery_context))}
            report["datasets"][str(count)]["filtered_page"] = measure(lambda: snapshot(lambda: service.list_images_page(
                page=10, limit=48, subfolder="default_output::", sort_by="filename")))
        runtime = getattr(service, "_runtime", None)
        if runtime:
            started, release = Event(), Event()
            def blocked_analysis(context, payload):
                started.set()
                release.wait(30)
                return {"ok": True}
            jobs = runtime.get_jobs()
            jobs.handlers["fingerprint_assets"] = ("analysis", blocked_analysis)
            job = jobs.enqueue("fingerprint_assets", {"_benchmark": True})
            try:
                assert started.wait(5), "analysis task did not start"
                report["blocked_analysis_50000"] = measure(lambda: snapshot(service.list_images_page))
                assert not release.is_set(), "analysis was released before query samples finished"
                assert not jobs.future(job["id"]).done(), "analysis finished before query samples completed"
            finally:
                release.set()
            jobs.future(job["id"]).result(5)
    if args.compare:
        baseline = json.loads(args.compare.read_text())
        report["ratios"] = {f"{size}/{kind}": report["datasets"][size][kind]["p95_ms"] / max(.001, baseline["datasets"][size][kind]["p95_ms"]) for size in report["datasets"] for kind in ("list", "context")}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))
    if any(ratio > 1.2 for ratio in report.get("ratios", {}).values()):
        raise SystemExit("Performance gate failed: hot-query P95 exceeds 120% of the fixed baseline")


if __name__ == "__main__":
    main()
