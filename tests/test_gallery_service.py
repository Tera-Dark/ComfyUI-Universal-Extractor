from __future__ import annotations

import json
import os
import time

import pytest


def test_gallery_paths_stay_within_registered_sources(isolated_gallery_env):
    service = isolated_gallery_env.service
    image_path = isolated_gallery_env.output_dir / "safe.png"
    image_path.write_bytes(b"not a real png, but path validation does not decode it")

    source_root, full_path = service.resolve_image_path("safe.png")
    assert source_root == str(isolated_gallery_env.output_dir)
    assert full_path == str(image_path)

    with pytest.raises(ValueError, match="within ComfyUI Output directory"):
        service.resolve_image_path("../outside.png")


def test_custom_sources_are_hardened_and_import_targets_are_validated(isolated_gallery_env, tmp_path):
    service = isolated_gallery_env.service
    external_source = tmp_path / "external"
    external_source.mkdir()

    diagnostic = service.test_gallery_source_path(str(external_source))
    assert diagnostic["exists"] is True
    assert diagnostic["ok"] is False
    assert diagnostic["security_error"] == "source path is outside the allowed ComfyUI directory"

    with pytest.raises(ValueError, match="custom source path must stay within"):
        service.save_gallery_source(
            {
                "id": "external",
                "name": "External",
                "path": str(external_source),
                "enabled": True,
                "writable": True,
                "import_target": True,
            }
        )

    kind, target_path, skipped = service.get_import_target_for_filename("image.png")
    assert kind == "image"
    assert skipped is None
    assert target_path.startswith(str(isolated_gallery_env.output_dir))
    assert "universal_gallery_imports" in target_path

    kind, target_path, skipped = service.get_import_target_for_filename("library.json")
    assert kind == "library"
    assert skipped is None
    assert target_path.startswith(str(isolated_gallery_env.data_dir))

    kind, target_path, skipped = service.get_import_target_for_filename("notes.txt")
    assert kind is None
    assert target_path is None
    assert skipped == {"filename": "notes.txt", "reason": "unsupported file type"}


def test_library_validation_and_import_modes_use_isolated_data_dir(isolated_gallery_env):
    service = isolated_gallery_env.service

    create_result = service.import_library_data(
        "artists.json",
        json.dumps([{"name": "Artist A", "tags": ["tag"]}]).encode("utf-8"),
    )
    assert create_result == {"ok": True, "name": "artists.json", "count": 1, "mode": "create"}
    assert (isolated_gallery_env.data_dir / "artists.json").exists()

    merge_result = service.import_library_data(
        "more.json",
        json.dumps([{"name": "Artist B"}]).encode("utf-8"),
        mode="merge",
        target_name="artists.json",
    )
    assert merge_result == {"ok": True, "name": "artists.json", "count": 2, "mode": "merge"}

    with pytest.raises(service.LibraryValidationError) as error:
        service.save_library("bad.json", [{"name": "Broken", "tags": [1]}])
    assert error.value.issues == [
        {"index": 0, "field": "tags", "message": "'tags' must be an array of strings."}
    ]


def test_image_freshness_fingerprint_tracks_current_view_without_rebuilding_index(isolated_gallery_env, monkeypatch):
    service = isolated_gallery_env.service
    monkeypatch.setattr(service, "IMAGE_FRESHNESS_CACHE_TTL_SECONDS", 0)

    def fail_build_index(*_args, **_kwargs):
        raise AssertionError("freshness scan must not rebuild the gallery index")

    monkeypatch.setattr(service, "_build_image_index", fail_build_index)

    initial = service.get_image_freshness()
    assert initial["image_count"] == 0
    assert initial["changed"] is False
    assert service.get_image_freshness(known=initial["fingerprint"])["changed"] is False

    image_path = isolated_gallery_env.output_dir / "fresh.png"
    image_path.write_bytes(b"first")
    added = service.get_image_freshness(known=initial["fingerprint"])
    assert added["changed"] is True
    assert added["image_count"] == 1
    assert added["latest_relative_path"] == "fresh.png"

    image_path.write_bytes(b"second version")
    future = time.time() + 10
    os.utime(image_path, (future, future))
    overwritten = service.get_image_freshness(known=added["fingerprint"])
    assert overwritten["changed"] is True

    image_path.unlink()
    removed = service.get_image_freshness(known=overwritten["fingerprint"])
    assert removed["changed"] is True
    assert removed["image_count"] == 0


def test_image_freshness_scope_ignores_sibling_folders_and_disabled_sources(isolated_gallery_env, monkeypatch):
    service = isolated_gallery_env.service
    monkeypatch.setattr(service, "IMAGE_FRESHNESS_CACHE_TTL_SECONDS", 0)

    current_dir = isolated_gallery_env.output_dir / "current"
    sibling_dir = isolated_gallery_env.output_dir / "sibling"
    disabled_dir = isolated_gallery_env.output_dir / "disabled"
    current_dir.mkdir()
    sibling_dir.mkdir()
    disabled_dir.mkdir()
    (current_dir / "one.png").write_bytes(b"current")

    current = service.get_image_freshness(subfolder="current")
    assert current["image_count"] == 1

    (sibling_dir / "two.png").write_bytes(b"sibling")
    sibling_change = service.get_image_freshness(subfolder="current", known=current["fingerprint"])
    assert sibling_change["changed"] is False
    assert sibling_change["image_count"] == 1

    service.save_gallery_source(
        {
            "id": "disabled",
            "name": "Disabled",
            "path": str(disabled_dir),
            "enabled": False,
            "writable": False,
            "import_target": False,
        }
    )
    (disabled_dir / "hidden.png").write_bytes(b"hidden")
    disabled_scope = service.get_image_freshness(subfolder="disabled::")
    assert disabled_scope["image_count"] == 0

    escaped = service.get_image_freshness(subfolder="../outside")
    assert escaped["image_count"] == 0


def test_gallery_index_schema_migration_adds_query_indexes(isolated_gallery_env):
    service = isolated_gallery_env.service
    (isolated_gallery_env.output_dir / "indexed.png").write_bytes(b"image")

    service.list_images_page(force_refresh=True)

    with service._connect_gallery_index_db() as connection:
        user_version = int(connection.execute("PRAGMA user_version").fetchone()[0])
        index_names = {row["name"] for row in connection.execute("PRAGMA index_list(gallery_images)").fetchall()}
        tables = {row["name"] for row in connection.execute("SELECT name FROM sqlite_master WHERE type IN ('table', 'view')")}

    assert user_version >= service.GALLERY_INDEX_SCHEMA_VERSION
    assert "idx_gallery_images_source_dir_created" in index_names
    assert "idx_gallery_images_pinned_created" in index_names
    assert "idx_gallery_images_category_created" in index_names
    assert "gallery_image_color_family" in tables


def test_gallery_index_records_real_image_dimensions(isolated_gallery_env):
    pil = pytest.importorskip("PIL.Image")
    service = isolated_gallery_env.service
    image_path = isolated_gallery_env.output_dir / "sized.png"
    pil.new("RGB", (96, 64), color=(255, 0, 0)).save(image_path)

    page = service.list_images_page(force_refresh=True)

    assert page["images"][0]["width"] == 96
    assert page["images"][0]["height"] == 64
    with service._connect_gallery_index_db() as connection:
        row = connection.execute(
            "SELECT image_width, image_height FROM gallery_images WHERE relative_path = ?",
            ("sized.png",),
        ).fetchone()
    assert row["image_width"] == 96
    assert row["image_height"] == 64


def test_incremental_dimension_read_only_for_changed_files(isolated_gallery_env, monkeypatch):
    service = isolated_gallery_env.service
    unchanged = isolated_gallery_env.output_dir / "unchanged.png"
    changed = isolated_gallery_env.output_dir / "changed.png"
    unchanged.write_bytes(b"unchanged")
    changed.write_bytes(b"changed")
    service.list_images_page(force_refresh=True)

    calls: list[str] = []

    def fake_dimensions(full_path: str):
        calls.append(os.path.basename(full_path))
        return (320, 240)

    monkeypatch.setattr(service, "_read_image_dimensions", fake_dimensions)
    future = time.time() + 10
    changed.write_bytes(b"changed again")
    os.utime(changed, (future, future))

    page = service.list_images_page(force_refresh=True)

    assert calls == ["changed.png"]
    changed_payload = next(image for image in page["images"] if image["relative_path"] == "changed.png")
    assert changed_payload["width"] == 320
    assert changed_payload["height"] == 240


def test_context_uses_database_aggregates_without_full_index_load(isolated_gallery_env, monkeypatch):
    service = isolated_gallery_env.service
    folder = isolated_gallery_env.output_dir / "month"
    folder.mkdir()
    (folder / "one.png").write_bytes(b"one")
    (isolated_gallery_env.output_dir / "two.png").write_bytes(b"two")
    service.persist_image_state("two.png", {"pinned": True})
    service.list_images_page(force_refresh=True)

    monkeypatch.setattr(service, "_build_image_index", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("context must not rebuild")))
    monkeypatch.setattr(service, "_load_image_index_from_db", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("context must not load every image")))

    context = service.get_gallery_context()

    assert context["pinned_count"] == 1
    assert f"{service.DEFAULT_OUTPUT_SOURCE_ID}{service.IMAGE_REF_SEPARATOR}month" in context["subfolders"]
    assert any(
        item["path"] == f"{service.DEFAULT_OUTPUT_SOURCE_ID}{service.IMAGE_REF_SEPARATOR}month"
        and item["source_id"] == service.DEFAULT_OUTPUT_SOURCE_ID
        and item["modified_at"] > 0
        for item in context["subfolder_details"]
    )
    assert context["sources"][0]["image_count"] == 2
    assert any(target["subfolder"] == "month" for target in context["move_targets"])


def test_context_deduplicates_legacy_lowercase_folder_rows(isolated_gallery_env):
    service = isolated_gallery_env.service
    folder = isolated_gallery_env.output_dir / "Aaalice工作流存档"
    folder.mkdir()
    (folder / "one.png").write_bytes(b"one")
    service.list_images_page(force_refresh=True)

    with service._connect_gallery_index_db() as connection:
        connection.execute(
            """
            UPDATE gallery_images
            SET relative_dir = 'aaalice工作流存档',
                subfolder = 'aaalice工作流存档',
                display_subfolder = 'aaalice工作流存档'
            WHERE relative_path = 'Aaalice工作流存档/one.png'
            """
        )
        connection.commit()

    context = service.get_gallery_context()

    assert f"{service.DEFAULT_OUTPUT_SOURCE_ID}{service.IMAGE_REF_SEPARATOR}Aaalice工作流存档" in context["subfolders"]
    assert f"{service.DEFAULT_OUTPUT_SOURCE_ID}{service.IMAGE_REF_SEPARATOR}aaalice工作流存档" not in context["subfolders"]


def test_input_source_root_and_subfolders_stay_distinct(isolated_gallery_env):
    service = isolated_gallery_env.service
    input_folder = isolated_gallery_env.input_dir / "clips"
    input_folder.mkdir()
    (input_folder / "input.png").write_bytes(b"input")

    context = service.get_gallery_context(force_refresh=True)
    input_source = next(source for source in context["sources"] if source["id"] == service.DEFAULT_INPUT_SOURCE_ID)
    input_page = service.list_images_page(subfolder=f"{service.DEFAULT_INPUT_SOURCE_ID}{service.IMAGE_REF_SEPARATOR}", force_refresh=True)

    assert input_source["kind"] == "input"
    assert f"{service.DEFAULT_INPUT_SOURCE_ID}{service.IMAGE_REF_SEPARATOR}clips" in context["subfolders"]
    assert input_page["total"] == 1
    assert input_page["images"][0]["source_kind"] == "input"


def test_output_source_root_filters_to_output_images(isolated_gallery_env):
    service = isolated_gallery_env.service
    (isolated_gallery_env.output_dir / "output.png").write_bytes(b"output")
    (isolated_gallery_env.input_dir / "input.png").write_bytes(b"input")

    output_page = service.list_images_page(
        subfolder=f"{service.DEFAULT_OUTPUT_SOURCE_ID}{service.IMAGE_REF_SEPARATOR}",
        force_refresh=True,
    )
    input_page = service.list_images_page(
        subfolder=f"{service.DEFAULT_INPUT_SOURCE_ID}{service.IMAGE_REF_SEPARATOR}",
        force_refresh=True,
    )

    assert output_page["total"] == 1
    assert output_page["images"][0]["source_kind"] == "output"
    assert input_page["total"] == 1
    assert input_page["images"][0]["source_kind"] == "input"


def test_folder_mutations_accept_source_root_refs_and_block_read_only_sources(isolated_gallery_env):
    service = isolated_gallery_env.service

    created = service.create_folder(f"{service.DEFAULT_OUTPUT_SOURCE_ID}{service.IMAGE_REF_SEPARATOR}scoped")
    assert created["path"] == f"{service.DEFAULT_OUTPUT_SOURCE_ID}{service.IMAGE_REF_SEPARATOR}scoped"
    assert (isolated_gallery_env.output_dir / "scoped").is_dir()

    renamed = service.rename_folder(
        f"{service.DEFAULT_OUTPUT_SOURCE_ID}{service.IMAGE_REF_SEPARATOR}scoped",
        "renamed",
    )
    assert renamed["target_path"] == f"{service.DEFAULT_OUTPUT_SOURCE_ID}{service.IMAGE_REF_SEPARATOR}renamed"
    assert (isolated_gallery_env.output_dir / "renamed").is_dir()

    with pytest.raises(ValueError, match="read-only"):
        service.create_folder(f"{service.DEFAULT_INPUT_SOURCE_ID}{service.IMAGE_REF_SEPARATOR}blocked")


def test_state_sync_skips_unchanged_gallery_state(isolated_gallery_env, monkeypatch):
    service = isolated_gallery_env.service
    (isolated_gallery_env.output_dir / "stateful.png").write_bytes(b"image")
    service.persist_image_state("stateful.png", {"title": "Stateful"})

    first_page = service.list_images_page(force_refresh=True)
    assert first_page["images"][0]["title"] == "Stateful"
    second_page = service.list_images_page()
    assert second_page["images"][0]["title"] == "Stateful"

    monkeypatch.setattr(service, "get_image_state_map", lambda: (_ for _ in ()).throw(AssertionError("unchanged state should not reload JSON")))

    third_page = service.list_images_page()
    assert third_page["images"][0]["title"] == "Stateful"


def test_force_refresh_incrementally_updates_changed_files(isolated_gallery_env, monkeypatch):
    service = isolated_gallery_env.service
    monkeypatch.setattr(service, "_schedule_color_index_backfill", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(service, "_schedule_dimension_backfill", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(service, "_read_image_dimensions", lambda *_args, **_kwargs: (0, 0))

    first = isolated_gallery_env.output_dir / "first.png"
    removed = isolated_gallery_env.output_dir / "removed.png"
    first.write_bytes(b"first")
    removed.write_bytes(b"removed")
    initial = service.list_images_page(force_refresh=True)
    assert initial["total"] == 2

    monkeypatch.setattr(service, "_build_image_index", lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("force refresh should use incremental sync when the DB is current")))

    removed.unlink()
    added = isolated_gallery_env.output_dir / "added.png"
    added.write_bytes(b"added")
    future = time.time() + 10
    os.utime(added, (future, future))

    refreshed = service.list_images_page(force_refresh=True)
    paths = {image["relative_path"] for image in refreshed["images"]}

    assert refreshed["total"] == 2
    assert "first.png" in paths
    assert "added.png" in paths
    assert "removed.png" not in paths


def test_search_and_color_auxiliary_tables_preserve_filters(isolated_gallery_env, monkeypatch):
    service = isolated_gallery_env.service
    monkeypatch.setattr(service, "_schedule_color_index_backfill", lambda *_args, **_kwargs: None)
    (isolated_gallery_env.output_dir / "auxiliary.png").write_bytes(b"image")
    service.persist_image_state("auxiliary.png", {"title": "Crimson Study"})
    service.list_images_page(force_refresh=True)

    search_result = service.list_images_page(search="Crimson")
    assert search_result["total"] == 1
    assert search_result["images"][0]["relative_path"] == "auxiliary.png"

    with service._connect_gallery_index_db() as connection:
        connection.execute(
            """
            UPDATE gallery_images
            SET color_family = 'red',
                color_families_text = '\nred\nwarm\n',
                color_family_scores_json = '{"red": 0.7, "warm": 0.8}'
            WHERE relative_path = 'auxiliary.png'
            """
        )
        rows = connection.execute(
            """
            SELECT relative_path, filename, title, category, notes, color_family, color_families_text,
                   color_family_scores_json, created_at
            FROM gallery_images
            WHERE relative_path = 'auxiliary.png'
            """
        ).fetchall()
        service._sync_auxiliary_rows(connection, rows)
        connection.commit()

    color_result = service.list_images_page(color_family="red")
    assert color_result["total"] == 1
    assert color_result["images"][0]["color_family"] == "red"


def test_trash_restore_and_purge_contracts_use_isolated_storage(isolated_gallery_env):
    service = isolated_gallery_env.service
    image_path = isolated_gallery_env.output_dir / "trash-me.png"
    image_path.write_bytes(b"image")

    trashed = service.move_path_to_trash(
        full_path=str(image_path),
        kind="image",
        original_path="trash-me.png",
        state_snapshot={"trash-me.png": {"title": "Trash Me"}},
        image_count=1,
    )
    assert not image_path.exists()
    assert service.list_trash_items()[0]["id"] == trashed["id"]

    restored = service.restore_trash_item(trashed["id"])
    assert restored["ok"] is True
    assert image_path.exists()
    assert service.list_trash_items() == []

    second_path = isolated_gallery_env.output_dir / "purge-me.png"
    second_path.write_bytes(b"image")
    purged_item = service.move_path_to_trash(
        full_path=str(second_path),
        kind="image",
        original_path="purge-me.png",
        image_count=1,
    )
    purged = service.purge_trash_item(purged_item["id"])
    assert purged["ok"] is True
    assert not os.path.exists(purged_item["storage_path"])
    assert service.list_trash_items() == []
