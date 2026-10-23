"""Balanced A/B benchmark on ONE read-only physical image tree.

Both workers own separate temporary state/index/catalogs and disable decoding
and analysis. No source files are created, modified, or removed. Alternating
order shares filesystem cache/load conditions instead of comparing two trees.
"""
import argparse
import importlib.util
import json
import math
import os
from pathlib import Path
import statistics
import subprocess
import sys
import tempfile
import time


def worker(root, source):
    sys.path.insert(0, str(root))
    import pytest
    spec = importlib.util.spec_from_file_location("comparison_fixture", root / "tests/conftest.py")
    fixtures = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fixtures)
    with tempfile.TemporaryDirectory(prefix="ue-refresh-worker-") as temporary, pytest.MonkeyPatch.context() as patch:
        fixture = fixtures.isolated_gallery_env.__wrapped__(Path(temporary), patch)
        env = next(fixture)
        try:
            import folder_paths
            patch.setattr(folder_paths, "get_output_directory", lambda: str(source))
            service = env.service
            patch.setattr(service, "_schedule_color_index_backfill", lambda *args, **kwargs: None)
            patch.setattr(service, "_schedule_dimension_backfill", lambda *args, **kwargs: None)
            patch.setattr(service, "_extract_image_color_profile", lambda *args: dict(service.COLOR_PROFILE_DEFAULT))
            patch.setattr(service, "_read_image_dimensions", lambda *args: (64, 64))
            count = service.list_images_page()["total"]
            counts = {"observed_assets": 0, "directory_visits": 0}
            catalog = service.get_runtime().catalog
            observe, scandir = catalog.observe_many, os.scandir
            def observed(source, records):
                counts["observed_assets"] += len(records)
                return observe(source, records)
            def scanned(path):
                counts["directory_visits"] += 1
                return scandir(path)
            patch.setattr(catalog, "observe_many", observed)
            patch.setattr(os, "scandir", scanned)
            print("@@" + json.dumps({"ready": True, "images": count}), flush=True)
            from py.gallery.execution import QUERY_ONLY
            for line in sys.stdin:
                action = line.strip()
                if action == "quit":
                    break
                counts.update(observed_assets=0, directory_visits=0)
                start = time.perf_counter()
                if action == "all":
                    service.ensure_image_index_db_current(force_refresh=True)
                elif action == "folder":
                    service.ensure_image_index_db_current(force_refresh=True, scope="default_output::folder-0000")
                elif action in {"list", "context"}:
                    token = QUERY_ONLY.set(True)
                    try:
                        if action == "list":
                            service.list_images_page()
                        else:
                            service.get_gallery_context()
                    finally:
                        QUERY_ONLY.reset(token)
                else:
                    raise ValueError(action)
                print("@@" + json.dumps({"ms": (time.perf_counter()-start)*1000, **counts}), flush=True)
        finally:
            try:
                next(fixture)
            except StopIteration:
                pass


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--worker", action="store_true")
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--baseline-root", type=Path)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--samples", type=int, default=30)
    args = parser.parse_args()
    if args.worker:
        return worker(args.root.resolve(), args.source.resolve())
    assert args.baseline_root and args.output and args.samples >= 3
    workers = []
    def receive(process):
        while True:
            line = process.stdout.readline()
            if line.startswith("@@"):
                return json.loads(line[2:])
            if not line:
                raise RuntimeError(f"Benchmark worker exited: {process.returncode}")
    report = {"source": str(args.source.resolve()), "samples": args.samples, "warmups": 5,
              "method": "alternating A/B then B/A on one read-only generated file tree; separate temporary indexes; decoding/analysis disabled", "results": {}}
    try:
        for name, root in (("before", args.baseline_root), ("after", args.root)):
            process = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), "--worker", "--root", str(root.resolve()), "--source", str(args.source.resolve())],
                                       stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True, encoding="utf-8", bufsize=1)
            workers.append(process)
            ready = receive(process)
            print(name, ready, flush=True)
            report.setdefault("images", ready["images"])
            assert report["images"] == ready["images"]
        for action in ("all", "folder", "list", "context"):
            samples = [[], []]
            last = [{}, {}]
            for index in range(5 + args.samples):
                for number in ([0, 1] if index % 2 == 0 else [1, 0]):
                    process = workers[number]
                    process.stdin.write(action + "\n")
                    process.stdin.flush()
                    last[number] = receive(process)
                    if index >= 5:
                        samples[number].append(last[number]["ms"])
            report["results"][action] = {name: {"p50_ms": statistics.median(values), "p95_ms": sorted(values)[math.ceil(.95*len(values))-1],
                                                  "samples_ms": values, "counts": last[number]} for number, (name, values) in enumerate(zip(("before", "after"), samples))}
            print(action, {name: data["p95_ms"] for name, data in report["results"][action].items()}, flush=True)
            args.output.parent.mkdir(parents=True, exist_ok=True)
            args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    finally:
        for process in workers:
            if process.poll() is None:
                process.stdin.write("quit\n")
                process.stdin.flush()
        for process in workers:
            process.wait(timeout=120)


if __name__ == "__main__":
    main()
