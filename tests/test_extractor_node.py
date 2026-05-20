from __future__ import annotations

import json
import random


def test_load_entries_supports_common_json_shapes(isolated_gallery_env):
    extractor = isolated_gallery_env.extractor
    library_path = isolated_gallery_env.data_dir / "prompts.json"
    library_path.write_text(
        json.dumps(
            [
                "plain text",
                {"prompt": "prompt field"},
                {"name": "name field"},
                {"title": "title field"},
                ["first list item", "ignored"],
                {"prompt": ""},
                42,
            ],
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    assert extractor.load_entries("prompts.json") == [
        "plain text",
        "prompt field",
        "name field",
        "title field",
        "first list item",
    ]


def test_load_segments_supports_nested_paths_lists_and_filters(isolated_gallery_env):
    extractor = isolated_gallery_env.extractor
    library = [
        {
            "name": "artist_a",
            "other_names": ["alias_a", "alias_b"],
            "meta": {"style": ["sketch", "line art"], "group": "ink"},
            "post_count": 120,
        },
        {
            "name": "artist_b",
            "other_names": ["alias_c"],
            "meta": {"style": ["watercolor"], "group": "paint"},
            "post_count": 20,
        },
    ]
    (isolated_gallery_env.data_dir / "segments.json").write_text(json.dumps(library), encoding="utf-8")

    assert extractor.load_segments("segments.json", "other_names") == ["alias_a", "alias_b", "alias_c"]
    assert extractor.load_segments("segments.json", "meta.style") == ["sketch", "line art", "watercolor"]
    assert extractor.load_segments("segments.json", "name, meta.group", "meta.group", "ink", "equals") == ["artist_a", "ink"]


def test_load_segments_accepts_plain_string_lists_for_tag_libraries(isolated_gallery_env):
    extractor = isolated_gallery_env.extractor
    (isolated_gallery_env.data_dir / "tags.json").write_text(json.dumps(["solo", "duo"]), encoding="utf-8")

    assert extractor.load_segments("tags.json", "name") == ["solo", "duo"]


def test_universal_json_segment_randomizer_is_seed_deterministic(isolated_gallery_env):
    extractor = isolated_gallery_env.extractor
    library = [
        {"name": "artist_a", "other_names": ["alias_a", "alias_b"]},
        {"name": "artist_b", "other_names": ["alias_c"]},
    ]
    (isolated_gallery_env.data_dir / "segments.json").write_text(json.dumps(library), encoding="utf-8")

    prompt, selected_json = extractor.UniversalJsonSegmentRandomizer().extract_segments(
        "segments.json",
        "other_names",
        2,
        "random",
        "auto",
        "tags",
        "<",
        ">",
        "|",
        11,
        "",
        "",
        "contains",
        1.0,
        1.0,
        "{tag}",
    )

    expected_items = random.Random(11).sample(["alias_a", "alias_b", "alias_c"], 2)
    assert prompt == "|".join(f"<{item}>" for item in expected_items)
    assert json.loads(selected_json) == expected_items


def test_universal_json_segment_randomizer_keeps_legacy_widget_order(isolated_gallery_env):
    extractor = isolated_gallery_env.extractor
    required_keys = list(extractor.UniversalJsonSegmentRandomizer.INPUT_TYPES()["required"])

    assert required_keys[:13] == [
        "file_name",
        "field_paths",
        "extract_count",
        "mode",
        "duplicate_policy",
        "output_format",
        "prefix",
        "suffix",
        "separator",
        "seed",
        "filter_path",
        "filter_value",
        "filter_mode",
    ]
    assert required_keys[-3:] == ["weight_min", "weight_max", "custom_template"]


def test_universal_json_segment_randomizer_unique_only_caps_count(isolated_gallery_env):
    extractor = isolated_gallery_env.extractor
    (isolated_gallery_env.data_dir / "segments.json").write_text(json.dumps([{"tags": ["a", "b"]}]), encoding="utf-8")

    prompt, selected_json = extractor.UniversalJsonSegmentRandomizer().extract_segments(
        "segments.json",
        "tags",
        5,
        "sequential",
        "unique_only",
        "tags",
        "",
        "",
        ",",
        1,
        "",
        "",
        "contains",
        1.0,
        1.0,
        "{tag}",
    )

    assert prompt == "b,a"
    assert json.loads(selected_json) == ["b", "a"]


def test_universal_json_segment_randomizer_formats_artist_outputs(isolated_gallery_env):
    extractor = isolated_gallery_env.extractor
    library = [{"name": "artist:kiyo_(kiyo_mariari)"}, {"name": "foo_bar"}]
    (isolated_gallery_env.data_dir / "artists.json").write_text(json.dumps(library), encoding="utf-8")

    node = extractor.UniversalJsonSegmentRandomizer()

    anima_prompt, _ = node.extract_segments(
        "artists.json",
        "name",
        1,
        "sequential",
        "auto",
        "anima",
        "",
        "",
        ", ",
        0,
        "",
        "",
        "contains",
        1.0,
        1.0,
        "{tag}",
    )
    assert anima_prompt == "@kiyo \\(kiyo mariari\\)"

    artist_prompt, _ = node.extract_segments(
        "artists.json",
        "name",
        1,
        "sequential",
        "auto",
        "artist",
        "",
        "",
        ", ",
        1,
        "",
        "",
        "contains",
        1.0,
        1.0,
        "{tag}",
    )
    assert artist_prompt == "artist:foo bar"

    weighted_prompt, _ = node.extract_segments(
        "artists.json",
        "name",
        1,
        "sequential",
        "auto",
        "weighted_artist",
        "",
        "",
        ", ",
        1,
        "",
        "",
        "contains",
        1.2,
        1.2,
        "{tag}",
    )
    assert weighted_prompt == "(foo bar:1.2)"


def test_universal_json_segment_randomizer_custom_template(isolated_gallery_env):
    extractor = isolated_gallery_env.extractor
    (isolated_gallery_env.data_dir / "segments.json").write_text(json.dumps([{"name": "foo_bar"}]), encoding="utf-8")

    prompt, selected_json = extractor.UniversalJsonSegmentRandomizer().extract_segments(
        "segments.json",
        "name",
        1,
        "sequential",
        "auto",
        "custom",
        "",
        "",
        ",",
        0,
        "",
        "",
        "contains",
        1.0,
        1.0,
        "{index}:{clean}:{anima}",
    )

    assert prompt == "1:foo bar:@foo bar"
    assert json.loads(selected_json) == ["foo_bar"]


def test_universal_json_segment_randomizer_polling_advances_per_node(isolated_gallery_env):
    extractor = isolated_gallery_env.extractor
    extractor.POLLING_STATE.clear()
    (isolated_gallery_env.data_dir / "segments.json").write_text(json.dumps([{"tags": ["a", "b", "c"]}]), encoding="utf-8")

    node = extractor.UniversalJsonSegmentRandomizer()
    first_prompt, first_json = node.extract_segments(
        "segments.json",
        "tags",
        2,
        "polling",
        "auto",
        "tags",
        "",
        "",
        ",",
        0,
        "",
        "",
        "contains",
        1.0,
        1.0,
        "{tag}",
        unique_id="node-1",
    )
    second_prompt, second_json = node.extract_segments(
        "segments.json",
        "tags",
        2,
        "polling",
        "auto",
        "tags",
        "",
        "",
        ",",
        0,
        "",
        "",
        "contains",
        1.0,
        1.0,
        "{tag}",
        unique_id="node-1",
    )

    assert first_prompt == "a,b"
    assert json.loads(first_json) == ["a", "b"]
    assert second_prompt == "c,a"
    assert json.loads(second_json) == ["c", "a"]


def test_old_text_extractor_node_is_not_registered():
    from py import plugin

    node_classes = plugin.load_node_classes()

    assert list(node_classes) == ["UniversalJsonSegmentRandomizer"]
    assert "UniversalTextExtractor" not in node_classes


def test_runtime_gallery_state_files_are_hidden_from_node_choices(isolated_gallery_env):
    extractor = isolated_gallery_env.extractor
    (isolated_gallery_env.data_dir / "gallery_state.json").write_text("{}", encoding="utf-8")
    (isolated_gallery_env.data_dir / "trash_state.json").write_text("{}", encoding="utf-8")
    (isolated_gallery_env.data_dir / "usable.json").write_text("[]", encoding="utf-8")

    assert extractor.list_json_files() == ["usable.json"]


def test_node_library_loader_rejects_runtime_and_path_escape_inputs(isolated_gallery_env):
    extractor = isolated_gallery_env.extractor
    (isolated_gallery_env.data_dir / "usable.json").write_text(json.dumps(["ok"]), encoding="utf-8")
    (isolated_gallery_env.data_dir / "gallery_state.json").write_text(json.dumps(["hidden"]), encoding="utf-8")

    assert extractor.load_entries("usable.json") == ["ok"]
    assert extractor.load_entries("gallery_state.json") == []
    assert extractor.load_entries("../usable.json") == []
    assert extractor.load_entries("../gallery_state.json") == []
    assert extractor.load_entries("not-json.txt") == []
