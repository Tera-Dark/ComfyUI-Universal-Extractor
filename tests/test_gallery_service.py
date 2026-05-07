from __future__ import annotations

import json

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
