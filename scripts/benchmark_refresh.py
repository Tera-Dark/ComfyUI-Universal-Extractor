"""Compare real directory refreshes in isolated, generated PNG trees.

--root may point to an archived baseline checkout. No user source is read or
modified. Hard links share a small generated PNG; this measures traversal,
identity and SQLite work, not full-size image decoding or SSD throughput.
"""
import argparse
import importlib.util
import json
import math
import os
from pathlib import Path
import platform
import statistics
import shutil
import sys
import tempfile
import time


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1])
    parser.add_argument("--files", type=int, default=14317)
    parser.add_argument("--samples", type=int, default=30)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    assert 1 <= args.files <= 50000 and args.samples >= 3
    root = args.root.resolve()
    sys.path.insert(0, str(root))
    import pytest
    from PIL import Image
    spec = importlib.util.spec_from_file_location("refresh_fixtures", root / "tests/conftest.py")
    fixtures = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(fixtures)
    report = {"python": sys.version, "platform": platform.platform(), "root": str(root),
              "files": args.files, "samples": args.samples, "warmups": 5,
              "dataset": "isolated physical tree, one generated 64x64 PNG shared via hard links; analysis disabled"}
    with tempfile.TemporaryDirectory(prefix="ue-refresh-benchmark-") as temporary, pytest.MonkeyPatch.context() as patch:
        fixture = fixtures.isolated_gallery_env.__wrapped__(Path(temporary), patch)
        env = next(fixture)
        try:
            service = env.service
            patch.setattr(service, "_schedule_color_index_backfill", lambda *args, **kwargs: None)
            patch.setattr(service, "_schedule_dimension_backfill", lambda *args, **kwargs: None)
            patch.setattr(service, "_read_image_dimensions", lambda *args: (64, 64))
            patch.setattr(service, "_extract_image_color_profile", lambda *args: dict(service.COLOR_PROFILE_DEFAULT))
            sample = Path(temporary) / "generated.png"
            Image.new("RGB", (64, 64), "#80a050").save(sample)
            for index in range(args.files):
                directory = env.output_dir / f"folder-{index // 50:04d}"
                directory.mkdir(exist_ok=True)
                target = directory / f"{index:06d}.png"
                if index % 50 == 0:
                    seed = target
                    shutil.copyfile(sample, seed)
                else:
                    os.link(seed, target)
            service.list_images_page()
            for _ in range(5):
                service.ensure_image_index_db_current(force_refresh=True)
            times = []
            for _ in range(args.samples):
                start = time.perf_counter()
                service.ensure_image_index_db_current(force_refresh=True)
                times.append((time.perf_counter()-start)*1000)
            counts = {"observed_assets": 0, "directory_visits": 0}
            catalog = service.get_runtime().catalog
            observe, scandir = catalog.observe_many, os.scandir
            def counted_observe(source, records):
                counts["observed_assets"] += len(records)
                return observe(source, records)
            def counted_scan(path):
                counts["directory_visits"] += 1
                return scandir(path)
            patch.setattr(catalog, "observe_many", counted_observe)
            patch.setattr(os, "scandir", counted_scan)
            service.ensure_image_index_db_current(force_refresh=True)
            report["unchanged_refresh"] = {"p50_ms": statistics.median(times),
                "p95_ms": sorted(times)[math.ceil(.95*len(times))-1], "samples_ms": times, **counts}
            counts.update(observed_assets=0, directory_visits=0)
            os.link(sample, env.output_dir / "folder-0000/new.png")
            start = time.perf_counter()
            service.ensure_image_index_db_current(force_refresh=True, scope="default_output::folder-0000")
            report["one_added_scoped"] = {"ms": (time.perf_counter()-start)*1000, **counts}
            assert service.list_images_page()["total"] == args.files + 1
        finally:
            try:
                next(fixture)
            except StopIteration:
                pass
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
