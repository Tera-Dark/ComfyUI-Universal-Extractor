from __future__ import annotations

from py.gallery.refs import (
    DEFAULT_INPUT_SOURCE_ID,
    DEFAULT_OUTPUT_SOURCE_ID,
    IMAGE_REF_SEPARATOR,
    make_folder_ref,
    make_image_ref,
    parse_folder_ref,
    parse_image_ref,
    sanitize_source_id,
)


def test_source_refs_keep_legacy_output_paths_compact():
    assert make_image_ref(DEFAULT_OUTPUT_SOURCE_ID, "folder\\image.png") == "folder/image.png"
    assert parse_image_ref("folder/image.png") == (DEFAULT_OUTPUT_SOURCE_ID, "folder/image.png")
    assert make_folder_ref(DEFAULT_OUTPUT_SOURCE_ID, "folder\\child") == "default_output::folder/child"


def test_source_refs_round_trip_input_and_custom_sources():
    image_ref = make_image_ref(DEFAULT_INPUT_SOURCE_ID, "clips/pasted.png")
    assert image_ref == f"{DEFAULT_INPUT_SOURCE_ID}{IMAGE_REF_SEPARATOR}clips/pasted.png"
    assert parse_image_ref(image_ref) == (DEFAULT_INPUT_SOURCE_ID, "clips/pasted.png")
    assert parse_folder_ref("My Source::nested/path") == ("my_source", "nested/path")
    assert sanitize_source_id(" My Source! ") == "my_source"
