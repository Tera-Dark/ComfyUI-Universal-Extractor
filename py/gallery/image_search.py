"""Local reverse image retrieval. Query uploads are decoded in memory, never imported."""
from __future__ import annotations

import hashlib
import heapq
import io
import json
import math
import os
from statistics import median

from .image_safety import guarded_image_open, extract_grayscale_pixels


_COS = tuple(tuple(math.cos(math.pi * (2 * x + 1) * u / 64) for x in range(32)) for u in range(8))


def describe_image(path):
    from PIL import Image, ImageOps

    with guarded_image_open(path) as original:
        aspect = original.width / original.height
        if original.getexif().get(274) in {5, 6, 7, 8}:
            aspect = 1 / aspect
        # Reduce before copying/compositing: large PNGs should not allocate
        # another full-resolution RGBA buffer for a 32px descriptor.
        original.thumbnail((256, 256), Image.Resampling.LANCZOS)
        with ImageOps.exif_transpose(original) as oriented:
            # Composite transparency consistently; platform exports usually flatten it.
            with oriented.convert("RGBA") as rgba:
                with Image.new("RGBA", rgba.size, "white") as background:
                    background.alpha_composite(rgba)
                    with background.convert("RGB") as rgb:
                        with rgb.resize((8, 8), Image.Resampling.LANCZOS) as small:
                            colors = small.tobytes().hex()
                        with rgb.convert("L") as gray:
                            with gray.resize((32, 32), Image.Resampling.LANCZOS) as sample:
                                pixels = extract_grayscale_pixels(sample)
                            with gray.resize((9, 8), Image.Resampling.LANCZOS) as sample:
                                diff = extract_grayscale_pixels(sample)
    # Separable low-frequency DCT, no numpy/model/runtime dependency.
    horizontal = [[sum(pixels[y * 32 + x] * _COS[u][x] for x in range(32)) for u in range(8)] for y in range(32)]
    coefficients = [sum(horizontal[y][u] * _COS[v][y] for y in range(32)) for v in range(8) for u in range(8)][1:]
    coefficients = [0 if abs(value) < 1e-7 else value for value in coefficients]
    center = median(coefficients)
    phash = 0
    for value in coefficients:
        phash = (phash << 1) | int(value > center)
    dhash = 0
    for y in range(8):
        for x in range(8):
            dhash = (dhash << 1) | int(diff[y * 9 + x] > diff[y * 9 + x + 1])
    return {"phash": f"{phash:016x}", "dhash": f"{dhash:016x}", "colors": colors, "aspect": aspect}


def describe_upload(payload):
    try:
        descriptor = describe_image(io.BytesIO(payload))
    except Exception as error:
        raise ValueError("Cannot decode reference image (unsupported, damaged or exceeds pixel limit)") from error
    return {**descriptor, "file_hash": hashlib.sha256(payload).hexdigest()}


def match_score(query, candidate):
    try:
        p = (int(query["phash"], 16) ^ int(candidate["phash"], 16)).bit_count()
        d = (int(query["dhash"], 16) ^ int(candidate["dhash"], 16)).bit_count()
        left, right = bytes.fromhex(query["colors"]), bytes.fromhex(candidate["colors"])
        if len(left) != 192 or len(right) != 192:
            return 0
        color = sum(abs(a - b) for a, b in zip(left, right)) / (192 * 255)
        aspect = abs(math.log(query["aspect"] / candidate["aspect"]))
        # A hash collision on flat shapes should not outweigh different colors.
        score = 100 * (1 - .5 * p / 63 - .25 * d / 64 - .25 * min(1, color * 3))
        score -= min(18, aspect * 20)
        if p > 28 or d > 34 or color > .4:
            return 0
        return round(max(0, min(99.9, score)), 1)
    except (KeyError, TypeError, ValueError, ZeroDivisionError):
        return 0


def build_search_index(env, context):
    """Keyset batches cover the entire committed library, including > 360/12000 rows."""
    with env._connect_gallery_index_db() as db:
        total = db.execute("SELECT COUNT(*) FROM gallery_images").fetchone()[0]
    sources = {source["id"]: source for source in env.list_gallery_sources() if source.get("enabled")}
    last, completed, failed = "", 0, 0
    while True:
        context.checkpoint(completed, total)
        with env._connect_gallery_index_db() as db:
            rows = db.execute("SELECT * FROM gallery_images WHERE relative_path>? ORDER BY relative_path LIMIT 100", (last,)).fetchall()
            if not rows:
                break
            result = env._sync_fingerprints_for_rows(db, rows, sources, limit=100, progress_offset=completed, progress_total=total)
            failed += result["failed"]
            last = rows[-1]["relative_path"]
            completed += len(rows)
    context.checkpoint(completed, total)
    return {"ok": True, "completed": completed, "failed": failed}


def find_images(env, query, minimum=70):
    sources = {source["id"]: source for source in env.list_gallery_sources() if source.get("enabled")}
    ready, failed, total = 0, 0, 0
    best = []
    with env._connect_gallery_index_db() as db:
        cursor = db.execute("""SELECT image.*, fp.file_hash AS search_file_hash,
            fp.search_descriptor, fp.version AS fp_version, fp.error AS fp_error,
            fp.asset_id AS fp_asset, fp.content_revision AS fp_revision,
            fp.file_mtime_ns AS fp_mtime_ns,
            fp.file_size AS fp_size, fp.modified_at AS fp_modified
            FROM gallery_images image LEFT JOIN gallery_image_fingerprints fp USING(relative_path)""")
        for row in cursor:
            source = sources.get(row["source_id"])
            if not source:
                continue
            total += 1
            if (row["fp_version"] != env.FINGERPRINT_VERSION or row["fp_asset"] != row["asset_id"]
                    or row["fp_revision"] != row["content_revision"] or row["fp_size"] != row["size"]
                    or row["fp_modified"] != row["modified_at"] or not row["fp_mtime_ns"]):
                continue
            ready += 1
            try:
                descriptor = json.loads(row["search_descriptor"] or "{}")
            except (ValueError, TypeError):
                descriptor = {}
            if not descriptor:
                failed += 1
            exact = bool(row["search_file_hash"] and row["search_file_hash"] == query["file_hash"])
            score = 100 if exact else match_score(query, descriptor)
            if score < minimum:
                continue
            # Keep memory bounded independently of the size of the library.
            item = (score, row["relative_path"], dict(row), exact)
            if len(best) < 50:
                heapq.heappush(best, item)
            elif item[:2] > best[0][:2]:
                heapq.heapreplace(best, item)
        matches = []
        for score, _, row, exact in sorted(best, key=lambda item: (-item[0], item[1])):
            source = sources[row["source_id"]]
            try:
                # Resolve only shortlisted candidates; reject symlinks/escapes/offline files.
                _, full_path = env.resolve_image_path(row["relative_path"])
                stat = os.stat(full_path)
                if stat.st_size != row["size"] or stat.st_mtime_ns != row["fp_mtime_ns"]:
                    continue
            except (OSError, ValueError):
                continue
            image = {**env._image_row_to_payload(row, source), **env._image_row_state(row)}
            matches.append({"image": image, "score": score, "match_type": "exact" if exact else "similar", "full_path": full_path})
    return {"matches": matches, "indexed": ready, "total": total, "pending": total - ready, "failed": failed}
