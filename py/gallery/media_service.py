"""media service domain. Dependencies are injected by the host."""
from __future__ import annotations

import os
import json
import uuid
import time
import shutil
import sqlite3
import hashlib
import colorsys
from threading import Lock, BoundedSemaphore
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from typing import Any

def _read_image_dimensions(env, full_path: str) -> tuple[int, int]:
    if not env.HAS_PIL:
        return 0, 0
    try:
        with env.guarded_image_open(full_path) as image:
            width, height = image.size
            return int(width or 0), int(height or 0)
    except env.DecompressionBombError as error:
        print(f"[Universal Extractor] image dimensions skipped ({full_path}): {error}")
        return 0, 0
    except Exception:
        return 0, 0


def _rgb_to_hex(env, red: int, green: int, blue: int) -> str:
    return f"#{max(0, min(255, red)):02x}{max(0, min(255, green)):02x}{max(0, min(255, blue)):02x}"


def _color_family_from_rgb(env, red: int, green: int, blue: int) -> str:
    hue, saturation, value = colorsys.rgb_to_hsv(red / 255, green / 255, blue / 255)
    hue_degrees = hue * 360
    luma = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255

    if value < 0.16:
        return "black"
    if value > 0.92 and saturation < 0.14:
        return "white"
    if saturation < 0.16:
        return "gray"
    if 18 <= hue_degrees < 48 and saturation > 0.26 and luma < 0.52:
        return "brown"
    if hue_degrees < 15 or hue_degrees >= 345:
        return "red"
    if hue_degrees < 42:
        return "orange"
    if hue_degrees < 68:
        return "yellow"
    if hue_degrees < 155:
        return "green"
    if hue_degrees < 190:
        return "cyan"
    if hue_degrees < 250:
        return "blue"
    if hue_degrees < 292:
        return "purple"
    if hue_degrees < 345:
        return "pink"
    return "gray"


def _encode_color_families(env, families: list[str]) -> str:
    unique_families: list[str] = []
    for family in families:
        if family and family not in unique_families:
            unique_families.append(family)
    return "\n" + "\n".join(unique_families) + "\n" if unique_families else ""


def _thumb_cache_path_if_exists(env, relative_path: str, size: int = 480) -> str:
    source_id, source_relative_path = env.parse_image_ref(relative_path)
    cache_key = hashlib.sha1(f"{source_id}:{source_relative_path}:{size}".encode("utf-8")).hexdigest()
    thumb_path = os.path.join(env.THUMB_CACHE_DIR, f"{cache_key}.webp")
    return thumb_path if os.path.exists(thumb_path) else ""


def _extract_image_color_profile(env, full_path: str, relative_path: str = "") -> dict[str, Any]:
    if not env.HAS_PIL:
        return dict(env.COLOR_PROFILE_DEFAULT)

    sample_path = env._thumb_cache_path_if_exists(relative_path) if relative_path else ""
    if not sample_path:
        sample_path = full_path

    try:
        with env.guarded_image_open(sample_path) as image:
            image.thumbnail((96, 96))
            rgba_image = image.convert("RGBA")
            try:
                pixels = env.extract_rgba_pixels(rgba_image)
            finally:
                rgba_image.close()
    except env.DecompressionBombError as error:
        print(f"[Universal Extractor] color profile skipped ({sample_path}): {error}")
        return dict(env.COLOR_PROFILE_DEFAULT)
    except Exception:
        if sample_path != full_path:
            return env._extract_image_color_profile(full_path, "")
        return dict(env.COLOR_PROFILE_DEFAULT)

    visible_pixels: list[tuple[int, int, int]] = [
        (int(red), int(green), int(blue))
        for red, green, blue, alpha in pixels
        if int(alpha) >= 24
    ]
    if not visible_pixels:
        return dict(env.COLOR_PROFILE_DEFAULT)

    bucket_map: dict[tuple[int, int, int], list[int]] = {}
    family_pixel_counts: dict[str, int] = {}
    saturation_sum = 0.0
    luma_sum = 0.0

    for red, green, blue in visible_pixels:
        _hue, saturation, value = colorsys.rgb_to_hsv(red / 255, green / 255, blue / 255)
        luma = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255
        saturation_sum += saturation
        luma_sum += luma
        bucket = (red // 32, green // 32, blue // 32)
        if bucket not in bucket_map:
            bucket_map[bucket] = [0, 0, 0, 0]
        bucket_map[bucket][0] += 1
        bucket_map[bucket][1] += red
        bucket_map[bucket][2] += green
        bucket_map[bucket][3] += blue
        family = env._color_family_from_rgb(red, green, blue)
        family_pixel_counts[family] = family_pixel_counts.get(family, 0) + 1

    if not bucket_map:
        return dict(env.COLOR_PROFILE_DEFAULT)

    total_pixels = len(visible_pixels)

    def bucket_score(bucket: list[int]) -> float:
        count, red_sum, green_sum, blue_sum = bucket
        red = round(red_sum / count)
        green = round(green_sum / count)
        blue = round(blue_sum / count)
        _hue, saturation, value = colorsys.rgb_to_hsv(red / 255, green / 255, blue / 255)
        family = env._color_family_from_rgb(red, green, blue)
        neutral_penalty = 0.26 if family in {"white", "gray"} else 0.72 if family == "black" else 1.0
        highlight_bonus = 1.0 + min(0.85, saturation * 1.35)
        value_penalty = 0.68 if value > 0.95 and saturation < 0.2 else 1.0
        return count * neutral_penalty * highlight_bonus * value_penalty

    ranked_buckets = sorted(bucket_map.values(), key=bucket_score, reverse=True)
    dominant_count, dominant_red, dominant_green, dominant_blue = ranked_buckets[0]
    dominant_rgb = (
        round(dominant_red / dominant_count),
        round(dominant_green / dominant_count),
        round(dominant_blue / dominant_count),
    )
    palette = []
    seen_colors: set[str] = set()
    color_family_scores = {
        family: round(count / total_pixels, 4)
        for family, count in sorted(family_pixel_counts.items(), key=lambda item: item[1], reverse=True)
    }
    base_color_families = [
        family
        for family, score in color_family_scores.items()
        if score >= env.COLOR_FAMILY_MIN_RATIO
    ]
    color_families = list(base_color_families)
    warm_score = sum(color_family_scores.get(family, 0) for family in ["red", "orange", "yellow", "pink", "brown"])
    cool_score = sum(color_family_scores.get(family, 0) for family in ["green", "cyan", "blue", "purple"])
    if warm_score >= env.COLOR_FAMILY_MIN_RATIO:
        color_families.append("warm")
    if cool_score >= env.COLOR_FAMILY_MIN_RATIO:
        color_families.append("cool")
    if (saturation_sum / len(visible_pixels)) < 0.18:
        color_families.append("low_saturation")
    for count, red_sum, green_sum, blue_sum in ranked_buckets[:10]:
        red = round(red_sum / count)
        green = round(green_sum / count)
        blue = round(blue_sum / count)
        color = env._rgb_to_hex(red, green, blue)
        if color not in seen_colors:
            palette.append(color)
            seen_colors.add(color)
        if len(palette) >= 6:
            break

    dominant_family = env._color_family_from_rgb(*dominant_rgb)
    primary_family = base_color_families[0] if base_color_families else dominant_family

    return {
        "dominant_color": env._rgb_to_hex(*dominant_rgb),
        "color_family": primary_family,
        "color_families_text": env._encode_color_families(color_families),
        "color_family_scores_json": json.dumps(
            {
                **color_family_scores,
                "warm": round(warm_score, 4),
                "cool": round(cool_score, 4),
                "low_saturation": round(1.0 if (saturation_sum / len(visible_pixels)) < 0.18 else 0.0, 4),
            },
            ensure_ascii=False,
        ),
        "palette_json": json.dumps(palette, ensure_ascii=False),
        "color_saturation": round(saturation_sum / len(visible_pixels), 4),
        "color_luma": round(luma_sum / len(visible_pixels), 4),
    }


def _color_index_is_current(env, connection: sqlite3.Connection) -> bool:
    if env._index_meta_get(connection, "color_index_version") != env.COLOR_INDEX_VERSION:
        return False
    missing_count = int(
        connection.execute(
            """
            SELECT COUNT(*) AS total
            FROM gallery_images
            WHERE dominant_color = '' OR color_family_scores_json = '{}'
            """
        ).fetchone()["total"]
    )
    return missing_count == 0


def _schedule_dimension_backfill(env, sources: list[dict[str, Any]], signature: str):
    pass  # state belongs to the injected environment
    if not env.HAS_PIL:
        return
    with env.DIMENSION_BACKFILL_LOCK:
        if env.DIMENSION_BACKFILL_RUNNING:
            return
        env.DIMENSION_BACKFILL_RUNNING = True

    source_snapshot = [
        {
            "id": str(source.get("id", "")),
            "path": str(source.get("path", "")),
            "enabled": bool(source.get("enabled", True)),
            "exists": bool(source.get("exists", False)),
        }
        for source in sources
    ]

    def run_backfill():
        pass  # state belongs to the injected environment
        try:
            source_by_id = {
                source["id"]: source
                for source in source_snapshot
                if source["id"] and source["enabled"] and source["exists"] and source["path"]
            }
            with env._connect_gallery_index_db() as connection:
                if env._index_meta_get(connection, "source_signature") != signature:
                    return
                rows = connection.execute(
                    """
                    SELECT relative_path, source_id, source_relative_path
                    FROM gallery_images
                    WHERE image_width <= 0 OR image_height <= 0
                    LIMIT 500
                    """
                ).fetchall()
                for row in rows:
                    source = source_by_id.get(str(row["source_id"]))
                    if not source:
                        continue
                    try:
                        full_path = env._ensure_within_directory(
                            source["path"],
                            os.path.join(source["path"], str(row["source_relative_path"])),
                            str(row["relative_path"]),
                        )
                    except ValueError:
                        continue
                    width, height = env._read_image_dimensions(full_path)
                    if width > 0 and height > 0:
                        connection.execute(
                            """
                            UPDATE gallery_images
                            SET image_width = ?, image_height = ?
                            WHERE relative_path = ?
                            """,
                            (width, height, str(row["relative_path"])),
                        )
                env._index_meta_set(connection, "dimension_index_version", env.DIMENSION_INDEX_VERSION)
                connection.commit()
        finally:
            with env.DIMENSION_BACKFILL_LOCK:
                env.DIMENSION_BACKFILL_RUNNING = False

    env.DIMENSION_BACKFILL_EXECUTOR.submit(run_backfill)


def _schedule_dimension_backfill_if_needed(env, connection: sqlite3.Connection, sources: list[dict[str, Any]], signature: str):
    if env._index_meta_get(connection, "dimension_index_version") == env.DIMENSION_INDEX_VERSION:
        return
    missing_count = int(
        connection.execute(
            """
            SELECT COUNT(*) AS total
            FROM gallery_images
            WHERE image_width <= 0 OR image_height <= 0
            """
        ).fetchone()["total"]
    )
    if missing_count > 0:
        env._schedule_dimension_backfill(sources, signature)
    else:
        env._index_meta_set(connection, "dimension_index_version", env.DIMENSION_INDEX_VERSION)


def _schedule_color_index_backfill(env, 
    sources: list[dict[str, Any]],
    signature: str,
    priority_paths: list[str] | None = None,
):
    pass  # state belongs to the injected environment
    if not env.HAS_PIL:
        return

    normalized_priority_paths = [
        env.normalize_relative_path(path)
        for path in (priority_paths or [])
        if env.normalize_relative_path(path)
    ]
    with env.COLOR_INDEX_BACKFILL_LOCK:
        env.COLOR_INDEX_QUEUED_PATHS.update(normalized_priority_paths)
        if env.COLOR_INDEX_BACKFILL_RUNNING:
            return
        env.COLOR_INDEX_BACKFILL_RUNNING = True

    source_snapshot = [
        {
            "id": str(source.get("id", "")),
            "path": str(source.get("path", "")),
            "enabled": bool(source.get("enabled", True)),
            "exists": bool(source.get("exists", False)),
        }
        for source in sources
    ]

    def run_backfill():
        pass  # state belongs to the injected environment
        try:
            source_by_id = {
                source["id"]: source
                for source in source_snapshot
                if source["id"] and source["enabled"] and source["exists"] and source["path"]
            }
            processed = 0
            with env._connect_gallery_index_db() as connection:
                while True:
                    if env._index_meta_get(connection, "source_signature") != signature:
                        return

                    with env.COLOR_INDEX_BACKFILL_LOCK:
                        priority_batch = list(env.COLOR_INDEX_QUEUED_PATHS)[:80]
                        for path in priority_batch:
                            env.COLOR_INDEX_QUEUED_PATHS.discard(path)

                    rows = []
                    if priority_batch:
                        placeholders = ",".join("?" for _ in priority_batch)
                        rows = connection.execute(
                            f"""
                            SELECT relative_path, source_id, source_relative_path
                            FROM gallery_images
                            WHERE relative_path IN ({placeholders})
                              AND (dominant_color = '' OR color_family_scores_json = '{{}}')
                            LIMIT 80
                            """,
                            priority_batch,
                        ).fetchall()

                    if not rows:
                        rows = connection.execute(
                            """
                            SELECT relative_path, source_id, source_relative_path
                            FROM gallery_images
                            WHERE dominant_color = '' OR color_family_scores_json = '{}'
                            LIMIT 80
                            """
                        ).fetchall()
                    if not rows:
                        env._index_meta_set(connection, "color_index_version", env.COLOR_INDEX_VERSION)
                        connection.commit()
                        return

                    updates = []
                    failed_paths = []
                    for row in rows:
                        source = source_by_id.get(str(row["source_id"]))
                        if not source:
                            continue
                        full_path = os.path.join(source["path"], str(row["source_relative_path"]))
                        if not os.path.isfile(full_path) or not full_path.lower().endswith(env.SUPPORTED_IMAGE_EXTENSIONS):
                            continue
                        color_profile = env._extract_image_color_profile(full_path, str(row["relative_path"]))
                        if (
                            color_profile["dominant_color"] == env.COLOR_PROFILE_DEFAULT["dominant_color"]
                            and color_profile["color_family_scores_json"] == env.COLOR_PROFILE_DEFAULT["color_family_scores_json"]
                        ):
                            failed_paths.append(str(row["relative_path"]))
                            continue
                        updates.append(
                            (
                                color_profile["dominant_color"],
                                color_profile["color_family"],
                                color_profile["color_families_text"],
                                color_profile["color_family_scores_json"],
                                color_profile["palette_json"],
                                color_profile["color_saturation"],
                                color_profile["color_luma"],
                                str(row["relative_path"]),
                            )
                        )

                    if updates:
                        connection.executemany(
                            """
                            UPDATE gallery_images
                            SET dominant_color = ?,
                                color_family = ?,
                                color_families_text = ?,
                                color_family_scores_json = ?,
                                palette_json = ?,
                                color_saturation = ?,
                                color_luma = ?
                            WHERE relative_path = ?
                            """,
                            updates,
                        )
                        updated_paths = [path for *_color_fields, path in updates]
                        placeholders = ",".join("?" for _ in updated_paths)
                        updated_rows = connection.execute(
                            f"""
                            SELECT relative_path, filename, title, category, notes, color_family, color_families_text,
                                   color_family_scores_json, created_at
                            FROM gallery_images
                            WHERE relative_path IN ({placeholders})
                            """,
                            updated_paths,
                        ).fetchall()
                        env._sync_auxiliary_rows(connection, updated_rows)
                        processed += len(updates)
                    skipped_paths = failed_paths if failed_paths else ([] if updates else [str(row["relative_path"]) for row in rows])
                    if skipped_paths:
                        connection.executemany(
                            """
                            UPDATE gallery_images
                            SET dominant_color = '#000000',
                                color_family = 'black',
                                color_families_text = '\nblack\n',
                                color_family_scores_json = '{"black": 1.0}',
                                palette_json = '["#000000"]'
                            WHERE relative_path = ?
                            """,
                            [(path,) for path in skipped_paths],
                        )
                        placeholders = ",".join("?" for _ in skipped_paths)
                        skipped_rows = connection.execute(
                            f"""
                            SELECT relative_path, filename, title, category, notes, color_family, color_families_text,
                                   color_family_scores_json, created_at
                            FROM gallery_images
                            WHERE relative_path IN ({placeholders})
                            """,
                            skipped_paths,
                        ).fetchall()
                        env._sync_auxiliary_rows(connection, skipped_rows)
                    connection.commit()

                    if processed and processed % 800 == 0:
                        env.invalidate_image_index_cache()
        finally:
            with env.COLOR_INDEX_BACKFILL_LOCK:
                env.COLOR_INDEX_BACKFILL_RUNNING = False

    env.COLOR_INDEX_EXECUTOR.submit(run_backfill)


def _full_path_for_index_row(env, row: sqlite3.Row | dict[str, Any], source: dict[str, Any]) -> str:
    source_root = str(source.get("path") or "")
    source_relative_path = env.normalize_relative_path(str(row["source_relative_path"] or row["filename"]))
    return os.path.join(source_root, *[part for part in source_relative_path.split("/") if part])


def _fingerprint_row_current(env, row: sqlite3.Row, fingerprint: sqlite3.Row | None) -> bool:
    if not fingerprint:
        return False
    return (
        str(fingerprint["version"] or "") == env.FINGERPRINT_VERSION
        and int(fingerprint["file_size"] or 0) == int(row["size"] or 0)
        and int(fingerprint["modified_at"] or 0) == int(row["modified_at"] or 0)
    )


def _lookup_fingerprint_rows(env, connection: sqlite3.Connection, paths: list[str]) -> dict[str, sqlite3.Row]:
    fingerprints: dict[str, sqlite3.Row] = {}
    for batch in env.iter_sqlite_batches(paths):
        placeholders = ",".join("?" for _ in batch)
        fingerprints.update({
            str(row["relative_path"]): row
            for row in connection.execute(
                f"SELECT * FROM gallery_image_fingerprints WHERE relative_path IN ({placeholders})",
                batch,
            )
        })
    return fingerprints


def _sync_fingerprints_for_rows(env, 
    connection: sqlite3.Connection,
    rows: list[sqlite3.Row],
    source_by_id: dict[str, dict[str, Any]],
    *,
    limit: int = 360,
) -> dict[str, Any]:
    if not rows:
        return {"queued": 0, "completed": 0, "failed": 0, "last_error": ""}

    paths = [str(row["relative_path"]) for row in rows]
    existing = env._lookup_fingerprint_rows(connection, paths)
    stale_rows = [row for row in rows if not env._fingerprint_row_current(row, existing.get(str(row["relative_path"])))]
    queued = len(stale_rows)
    completed = 0
    failed = 0
    last_error = ""

    for row in stale_rows[: max(1, int(limit or env.FINGERPRINT_SYNC_LIMIT))]:
        relative_path = str(row["relative_path"])
        source = source_by_id.get(str(row["source_id"]))
        if not source:
            continue
        full_path = env._full_path_for_index_row(row, source)
        try:
            fingerprint = env.build_image_fingerprint(full_path, str(row["filename"]))
        except Exception as error:
            fingerprint = {
                "visual_hash": "",
                "file_hash": "",
                "prompt_hash": "",
                "workflow_hash": "",
                "filename_group_key": "",
                "error": str(error),
                "version": env.FINGERPRINT_VERSION,
            }
        if fingerprint.get("error"):
            failed += 1
            last_error = str(fingerprint["error"])
        else:
            completed += 1
        connection.execute(
            """
            INSERT INTO gallery_image_fingerprints(
                relative_path, source_id, file_size, modified_at, file_hash, visual_hash,
                prompt_hash, workflow_hash, filename_group_key, error, indexed_at, version
            )
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(relative_path) DO UPDATE SET
                source_id = excluded.source_id,
                file_size = excluded.file_size,
                modified_at = excluded.modified_at,
                file_hash = excluded.file_hash,
                visual_hash = excluded.visual_hash,
                prompt_hash = excluded.prompt_hash,
                workflow_hash = excluded.workflow_hash,
                filename_group_key = excluded.filename_group_key,
                error = excluded.error,
                indexed_at = excluded.indexed_at,
                version = excluded.version
            """,
            (
                relative_path,
                str(row["source_id"]),
                int(row["size"] or 0),
                int(row["modified_at"] or 0),
                str(fingerprint.get("file_hash") or ""),
                str(fingerprint.get("visual_hash") or ""),
                str(fingerprint.get("prompt_hash") or ""),
                str(fingerprint.get("workflow_hash") or ""),
                str(fingerprint.get("filename_group_key") or ""),
                str(fingerprint.get("error") or ""),
                time.time(),
                env.FINGERPRINT_VERSION,
            ),
        )

    return {"queued": queued, "completed": completed, "failed": failed, "last_error": last_error}


def _rows_with_fingerprints(env, connection: sqlite3.Connection, rows: list[sqlite3.Row]) -> list[dict[str, Any]]:
    if not rows:
        return []
    by_path = {str(row["relative_path"]): row for row in rows}
    paths = list(by_path)
    fingerprints = env._lookup_fingerprint_rows(connection, paths)
    return [
        {
            "row": row,
            "fingerprint": fingerprints.get(path),
        }
        for path, row in by_path.items()
    ]


def _variant_group_id(env, group_type: str, key: str) -> str:
    digest = hashlib.sha1(f"{group_type}:{key}".encode("utf-8", errors="ignore")).hexdigest()[:16]
    return f"{group_type}:{digest}"


def _variant_group_title(env, group_type: str, key: str, items: list[dict[str, Any]]) -> str:
    first = items[0]["image"]["filename"] if items else key
    if group_type == "filename_series":
        return key or first
    if group_type == "same_prompt":
        return f"Prompt: {first}"
    if group_type == "same_workflow":
        return f"Workflow: {first}"
    if group_type == "near_duplicate":
        return f"Near duplicate: {first}"
    return f"Duplicate: {first}"


def _build_variant_groups_from_items(env, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    groups: list[tuple[str, str, list[dict[str, Any]], float]] = []

    def add_hash_groups(group_type: str, field: str, confidence: float):
        buckets: dict[str, list[dict[str, Any]]] = {}
        for item in items:
            value = str(item.get(field) or "")
            if value:
                buckets.setdefault(value, []).append(item)
        for key, bucket in buckets.items():
            if len(bucket) > 1:
                groups.append((group_type, key, sorted(bucket, key=lambda item: item["image"]["created_at"], reverse=True), confidence))

    add_hash_groups("exact_duplicate", "exact_key", 1.0)
    add_hash_groups("same_workflow", "workflow_hash", 0.96)
    add_hash_groups("same_prompt", "prompt_hash", 0.88)
    add_hash_groups("filename_series", "filename_group_key", 0.72)

    visual_items = [item for item in items if item.get("visual_hash")]
    parent = list(range(len(visual_items)))

    def find(index: int) -> int:
        while parent[index] != index:
            parent[index] = parent[parent[index]]
            index = parent[index]
        return index

    def union(left: int, right: int):
        left_root = find(left)
        right_root = find(right)
        if left_root != right_root:
            parent[right_root] = left_root

    for left_index, right_index in env.near_hash_pairs(
        [str(item["visual_hash"]) for item in visual_items], env.NEAR_DUPLICATE_HASH_DISTANCE
    ):
        left, right = visual_items[left_index], visual_items[right_index]
        if left.get("exact_key") and left.get("exact_key") == right.get("exact_key"):
            continue
        union(left_index, right_index)

    near_buckets: dict[int, list[dict[str, Any]]] = {}
    for index, item in enumerate(visual_items):
        near_buckets.setdefault(find(index), []).append(item)
    for key, bucket in near_buckets.items():
        if len(bucket) > 1:
            groups.append(
                (
                    "near_duplicate",
                    "|".join(sorted(str(item["visual_hash"]) for item in bucket))[:160] or str(key),
                    sorted(bucket, key=lambda item: item["image"]["created_at"], reverse=True),
                    0.82,
                )
            )

    deduped: dict[str, dict[str, Any]] = {}
    for group_type, key, bucket, confidence in groups:
        paths = sorted(item["image"]["relative_path"] for item in bucket)
        if len(paths) < 2:
            continue
        group_id = env._variant_group_id(group_type, key + "|" + "|".join(paths))
        if group_id in deduped:
            continue
        latest = max(int(item["image"]["created_at"]) for item in bucket)
        cover = bucket[0]["image"]
        deduped[group_id] = {
            "id": group_id,
            "type": group_type,
            "title": env._variant_group_title(group_type, key, bucket),
            "count": len(bucket),
            "cover_image": cover,
            "latest_created_at": latest,
            "confidence": confidence,
            "images_preview": [item["image"] for item in bucket[:4]],
            "_images": [item["image"] for item in bucket],
        }

    return sorted(deduped.values(), key=lambda group: (group["latest_created_at"], group["count"]), reverse=True)


def _variant_items_for_rows(env, rows: list[sqlite3.Row], fingerprint_rows: list[dict[str, Any]], source_by_id: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for item in fingerprint_rows:
        row = item["row"]
        fingerprint = item.get("fingerprint")
        source = source_by_id.get(str(row["source_id"]))
        if not source or not fingerprint:
            continue
        image = {**env._image_row_to_payload(row, source), **env._image_row_state(row)}
        visual_hash = str(fingerprint["visual_hash"] or "")
        file_hash = str(fingerprint["file_hash"] or "")
        exact_key = ""
        if file_hash:
            exact_key = file_hash
        items.append(
            {
                "image": image,
                "visual_hash": visual_hash,
                "exact_key": exact_key,
                "prompt_hash": str(fingerprint["prompt_hash"] or ""),
                "workflow_hash": str(fingerprint["workflow_hash"] or ""),
                "filename_group_key": str(fingerprint["filename_group_key"] or ""),
            }
        )
    return items


def list_variant_groups(env, 
    *,
    search: str = "",
    category: str = "",
    subfolder: str = "",
    board_id: str = "",
    date_from: str = "",
    date_to: str = "",
    favorites_only: bool = False,
    color_family: str = "",
    sort_by: str = "created_at",
    sort_order: str = "desc",
    group_type: str = "",
    limit: int = 80,
    force_refresh: bool = False,
) -> dict[str, Any]:
    sources, signature = env.ensure_image_index_db_current(force_refresh=force_refresh, scope=subfolder)
    source_by_id = {source["id"]: source for source in sources}
    with env._connect_gallery_index_db() as connection:
        env._ensure_auxiliary_tables_current(connection)
        env._sync_image_state_to_index_db(connection)
        rows = env._query_filtered_image_rows(
            connection,
            search=search,
            category=category,
            subfolder=subfolder,
            board_id=board_id,
            date_from=date_from,
            date_to=date_to,
            favorites_only=favorites_only,
            color_family=color_family,
            sort_by=sort_by,
            sort_order=sort_order,
        )
        sync_status = env._sync_fingerprints_for_rows(connection, rows, source_by_id)
        fingerprint_rows = env._rows_with_fingerprints(connection, rows)
        connection.commit()

    items = env._variant_items_for_rows(rows, fingerprint_rows, source_by_id)
    groups = env._build_variant_groups_from_items(items)
    if group_type:
        groups = [group for group in groups if group["type"] == group_type]
    public_groups = [{key: value for key, value in group.items() if key != "_images"} for group in groups[: max(1, min(200, int(limit or 80)))]]
    return {
        "groups": public_groups,
        "total": len(groups),
        "scanned": len(rows),
        "scan_limit": env.VARIANT_GROUP_SCAN_LIMIT,
        "scan_limit_reached": len(rows) >= env.VARIANT_GROUP_SCAN_LIMIT,
        "score_kind": "heuristic_not_probability",
        "fingerprint_status": env.get_fingerprint_index_status(),
        "sync_status": sync_status,
        "source_signature": signature,
    }


def get_variant_group_images(env, 
    *,
    group_id: str,
    group_type: str = "",
    page: int = 1,
    limit: int = 60,
    search: str = "",
    category: str = "",
    subfolder: str = "",
    board_id: str = "",
    date_from: str = "",
    date_to: str = "",
    favorites_only: bool = False,
    color_family: str = "",
    sort_by: str = "created_at",
    sort_order: str = "desc",
) -> dict[str, Any]:
    result = env.list_variant_groups(
        search=search,
        category=category,
        subfolder=subfolder,
        board_id=board_id,
        date_from=date_from,
        date_to=date_to,
        favorites_only=favorites_only,
        color_family=color_family,
        sort_by=sort_by,
        sort_order=sort_order,
        group_type=group_type,
        limit=200,
    )
    groups = result.get("groups", [])
    source_groups = env._build_variant_groups_from_items([])
    # Recompute with private images only when needed for the selected group.
    sources, _ = env.ensure_image_index_db_current(scope=subfolder)
    source_by_id = {source["id"]: source for source in sources}
    with env._connect_gallery_index_db() as connection:
        rows = env._query_filtered_image_rows(
            connection,
            search=search,
            category=category,
            subfolder=subfolder,
            board_id=board_id,
            date_from=date_from,
            date_to=date_to,
            favorites_only=favorites_only,
            color_family=color_family,
            sort_by=sort_by,
            sort_order=sort_order,
        )
        fingerprint_rows = env._rows_with_fingerprints(connection, rows)
    source_groups = env._build_variant_groups_from_items(env._variant_items_for_rows(rows, fingerprint_rows, source_by_id))
    selected = next((group for group in source_groups if group["id"] == group_id), None)
    if selected is None and groups:
        selected_public = next((group for group in groups if group["id"] == group_id), None)
        if selected_public:
            selected = {**selected_public, "_images": selected_public.get("images_preview", [])}
    images = list(selected.get("_images", [])) if selected else []
    safe_page = max(1, int(page or 1))
    safe_limit = max(1, min(120, int(limit or 60)))
    offset = (safe_page - 1) * safe_limit
    public_group = {key: value for key, value in selected.items() if key != "_images"} if selected else None
    return {
        "group": public_group,
        "images": images[offset : offset + safe_limit],
        "total": len(images),
        "page": safe_page,
        "limit": safe_limit,
    }


def prewarm_image_fingerprints(env, 
    *,
    relative_paths: list[str] | None = None,
    subfolder: str = "",
    search: str = "",
    category: str = "",
    board_id: str = "",
    date_from: str = "",
    date_to: str = "",
    favorites_only: bool = False,
    color_family: str = "",
    limit: int = 360,
) -> dict[str, Any]:
    sources, _ = env.ensure_image_index_db_current(scope=subfolder)
    source_by_id = {source["id"]: source for source in sources}
    with env._connect_gallery_index_db() as connection:
        if relative_paths:
            normalized_paths = list(dict.fromkeys(
                env.normalize_relative_path(path) for path in relative_paths if env.normalize_relative_path(path)
            ))
            rows = []
            for batch in env.iter_sqlite_batches(normalized_paths):
                placeholders = ",".join("?" for _ in batch)
                rows.extend(connection.execute(
                    f"""
                    SELECT {env._image_row_select_sql()}
                    FROM gallery_images
                    WHERE relative_path IN ({placeholders})
                    """,
                    batch,
                ).fetchall())
            rows.sort(key=lambda row: int(row["created_at"]), reverse=True)
        else:
            rows = env._query_filtered_image_rows(
                connection,
                search=search,
                category=category,
                subfolder=subfolder,
                board_id=board_id,
                date_from=date_from,
                date_to=date_to,
                favorites_only=favorites_only,
                color_family=color_family,
                limit=max(1, min(env.VARIANT_GROUP_SCAN_LIMIT, int(limit or env.FINGERPRINT_SYNC_LIMIT))),
            )
        status = env._sync_fingerprints_for_rows(connection, rows, source_by_id, limit=limit)
        connection.commit()
    return {"ok": True, **status, "status": env.get_fingerprint_index_status()}


def get_fingerprint_index_status(env) -> dict[str, Any]:
    if not os.path.exists(env.GALLERY_INDEX_DB_FILE):
        return {"total": 0, "indexed": 0, "pending": 0, "failed": 0, "last_error": "", "version": env.FINGERPRINT_VERSION}
    with env._connect_gallery_index_db() as connection:
        total = int(connection.execute("SELECT COUNT(*) AS total FROM gallery_images").fetchone()["total"])
        indexed = int(
            connection.execute(
                """
                SELECT COUNT(*) AS total
                FROM gallery_images image
                JOIN gallery_image_fingerprints fingerprint ON fingerprint.relative_path = image.relative_path
                WHERE fingerprint.version = ?
                  AND fingerprint.file_size = image.size
                  AND fingerprint.modified_at = image.modified_at
                """,
                (env.FINGERPRINT_VERSION,),
            ).fetchone()["total"]
        )
        failed_row = connection.execute(
            """
            SELECT COUNT(*) AS total
            FROM gallery_image_fingerprints
            WHERE version = ? AND error <> ''
            """,
            (env.FINGERPRINT_VERSION,),
        ).fetchone()
        last_error_row = connection.execute(
            """
            SELECT error
            FROM gallery_image_fingerprints
            WHERE version = ? AND error <> ''
            ORDER BY indexed_at DESC
            LIMIT 1
            """,
            (env.FINGERPRINT_VERSION,),
        ).fetchone()
    return {
        "total": total,
        "indexed": indexed,
        "pending": max(0, total - indexed),
        "failed": int(failed_row["total"] if failed_row else 0),
        "last_error": str(last_error_row["error"] if last_error_row else ""),
        "version": env.FINGERPRINT_VERSION,
    }


def get_image_metadata(env, relative_path: str) -> dict:
    source_id, source_relative_path = env.parse_image_ref(relative_path)
    normalized = env.make_image_ref(source_id, source_relative_path)
    _, full_path = env.resolve_image_path(normalized)
    metadata = env.read_image_metadata(full_path)
    workflow = metadata.get("workflow")
    return {
        "filename": os.path.basename(source_relative_path),
        "relative_path": normalized,
        "source_id": source_id,
        "source_relative_path": source_relative_path,
        "metadata": metadata,
        "workflow": workflow if isinstance(workflow, dict) else None,
        "artist_prompts": env.extract_artist_prompts(metadata),
        "summary": env.build_prompt_summary(metadata),
        "recipe": env.extract_generation_recipe(metadata),
        "state": env.get_image_state(normalized),
    }


def ensure_thumb_cache_dir(env):
    env.ensure_data_dir()
    os.makedirs(env.THUMB_CACHE_DIR, exist_ok=True)


def _get_thumb_generation_lock(env, cache_key: str) -> Lock:
    with env.THUMB_LOCKS_GUARD:
        thumb_lock = env.THUMB_LOCKS.get(cache_key)
        if thumb_lock is None:
            thumb_lock = Lock()
            env.THUMB_LOCKS[cache_key] = thumb_lock
        return thumb_lock


def get_thumbnail_path(env, relative_path: str, size: int = 480) -> tuple[str, str]:
    source_id, source_relative_path = env.parse_image_ref(relative_path)
    normalized = env.make_image_ref(source_id, source_relative_path)
    _, full_path = env.resolve_image_path(normalized)
    if not os.path.exists(full_path):
        raise FileNotFoundError("image not found")

    env.ensure_thumb_cache_dir()
    stat = os.stat(full_path)
    cache_key = hashlib.sha1(f"{normalized}|{int(stat.st_mtime)}|{size}".encode("utf-8")).hexdigest()
    thumb_path = os.path.join(env.THUMB_CACHE_DIR, f"{cache_key}.webp")

    if not os.path.exists(thumb_path):
        if not env.HAS_PIL:
            raise RuntimeError("Pillow is required for thumbnail generation")
        thumb_lock = env._get_thumb_generation_lock(cache_key)
        with thumb_lock:
            if not os.path.exists(thumb_path):
                with env.THUMB_GENERATION_SEMAPHORE:
                    if not os.path.exists(thumb_path):
                        temp_path = f"{thumb_path}.{uuid.uuid4().hex}.tmp"
                        try:
                            with env.guarded_image_open(full_path) as image:
                                image = image.convert("RGB")
                                image.thumbnail((size, size))
                                image.save(temp_path, format="WEBP", quality=80, method=2)
                            os.replace(temp_path, thumb_path)
                        except env.DecompressionBombError as error:
                            raise ValueError(f"image exceeds configured pixel limit: {relative_path}") from error
                        finally:
                            if os.path.exists(temp_path):
                                try:
                                    os.remove(temp_path)
                                except OSError:
                                    pass
        with env.THUMB_LOCKS_GUARD:
            if env.THUMB_LOCKS.get(cache_key) is thumb_lock:
                env.THUMB_LOCKS.pop(cache_key, None)

    return full_path, thumb_path


def _thumbnail_prewarm_key(env, relative_path: str, size: int) -> str:
    source_id, source_relative_path = env.parse_image_ref(relative_path)
    return f"{env.make_image_ref(source_id, source_relative_path)}|{int(size)}"


def _run_thumbnail_prewarm(env, relative_path: str, size: int, queue_key: str):
    try:
        env.get_thumbnail_path(relative_path, size=size)
    except Exception as error:
        with env.THUMB_PREWARM_LOCK:
            env.THUMB_PREWARM_STATS["failed"] = int(env.THUMB_PREWARM_STATS.get("failed", 0)) + 1
            env.THUMB_PREWARM_STATS["last_error"] = str(error)
            env.THUMB_PREWARM_STATS["updated_at"] = time.time()
    else:
        with env.THUMB_PREWARM_LOCK:
            env.THUMB_PREWARM_STATS["completed"] = int(env.THUMB_PREWARM_STATS.get("completed", 0)) + 1
            env.THUMB_PREWARM_STATS["updated_at"] = time.time()
    finally:
        with env.THUMB_PREWARM_LOCK:
            env.THUMB_PREWARM_PENDING.discard(queue_key)


def enqueue_thumbnail_prewarm(env, relative_paths: list[str], size: int = 480, limit: int = 80) -> dict[str, Any]:
    queued: list[str] = []
    skipped: list[str] = []
    for relative_path in relative_paths[:limit]:
        try:
            source_id, source_relative_path = env.parse_image_ref(relative_path)
            normalized = env.make_image_ref(source_id, source_relative_path)
            queue_key = env._thumbnail_prewarm_key(normalized, size)
        except ValueError:
            skipped.append(relative_path)
            continue

        with env.THUMB_PREWARM_LOCK:
            if queue_key in env.THUMB_PREWARM_PENDING:
                skipped.append(normalized)
                continue
            env.THUMB_PREWARM_PENDING.add(queue_key)
            env.THUMB_PREWARM_STATS["queued"] = int(env.THUMB_PREWARM_STATS.get("queued", 0)) + 1
            env.THUMB_PREWARM_STATS["updated_at"] = time.time()

        queued.append(normalized)
        env.THUMB_PREWARM_EXECUTOR.submit(env._run_thumbnail_prewarm, normalized, size, queue_key)

    return {"ok": True, "queued": queued, "skipped": skipped, "status": env.get_thumbnail_prewarm_status()}


def get_thumbnail_prewarm_status(env) -> dict[str, Any]:
    with env.THUMB_PREWARM_LOCK:
        return {
            "pending": len(env.THUMB_PREWARM_PENDING),
            "queued": int(env.THUMB_PREWARM_STATS.get("queued", 0)),
            "completed": int(env.THUMB_PREWARM_STATS.get("completed", 0)),
            "failed": int(env.THUMB_PREWARM_STATS.get("failed", 0)),
            "last_error": str(env.THUMB_PREWARM_STATS.get("last_error", "")),
            "updated_at": float(env.THUMB_PREWARM_STATS.get("updated_at", 0.0)),
        }
