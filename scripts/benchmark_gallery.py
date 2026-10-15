"""Reproducible isolated benchmark; never writes to registered user sources.

python scripts/benchmark_gallery.py --output artifacts/foundation-baseline.json
python scripts/benchmark_gallery.py --output artifacts/foundation-after.json --compare artifacts/foundation-baseline.json
Synthetic index timings are NOT measurements of a real file traversal.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import platform
import statistics
import sys
import tempfile
import time
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
    with tempfile.TemporaryDirectory(prefix="ue-benchmark-") as temporary, pytest.MonkeyPatch.context() as patch:
        env = fixtures.isolated_gallery_env.__wrapped__(Path(temporary), patch)
        service = env.service
        for number in range(20):
            Image.new("RGB", (64, 48), (number, 90, 120)).save(env.output_dir / f"sample_{number}.png")
        start = time.perf_counter()
        service.list_images_page()
        report["cold_real_sample_ms"] = (time.perf_counter() - start) * 1000
        report["freshness_real_20_images"] = measure(lambda: service.get_image_freshness())
        report["batch_real_20_images"] = measure(lambda: service.batch_update_images([f"sample_{n}.png" for n in range(20)], {"notes": str(time.perf_counter())}))
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
            report["datasets"][str(count)] = {"list": measure(service.list_images_page), "context": measure(service.get_gallery_context)}
        runtime = getattr(env, "runtime", None)
        if runtime:
            runtime.close()
    if args.compare:
        baseline = json.loads(args.compare.read_text())
        report["ratios"] = {f"{size}/{kind}": report["datasets"][size][kind]["p95_ms"] / max(.001, baseline["datasets"][size][kind]["p95_ms"]) for size in report["datasets"] for kind in ("list", "context")}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
