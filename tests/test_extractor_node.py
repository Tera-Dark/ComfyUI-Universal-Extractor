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


def test_universal_text_extractor_is_seed_deterministic(isolated_gallery_env):
    extractor = isolated_gallery_env.extractor
    items = ["alpha", "bravo", "charlie", "delta"]
    (isolated_gallery_env.data_dir / "prompts.json").write_text(json.dumps(items), encoding="utf-8")

    result = extractor.UniversalTextExtractor().extract(
        "prompts.json",
        3,
        "random",
        "<",
        ">",
        "|",
        7,
    )[0]

    expected = "|".join(f"<{item}>" for item in random.Random(7).sample(items, 3))
    assert result == expected
    assert extractor.UniversalTextExtractor().extract("prompts.json", 3, "sequential", "", "", ",", 5)[0] == "bravo,charlie,delta"


def test_runtime_gallery_state_files_are_hidden_from_node_choices(isolated_gallery_env):
    extractor = isolated_gallery_env.extractor
    (isolated_gallery_env.data_dir / "gallery_state.json").write_text("{}", encoding="utf-8")
    (isolated_gallery_env.data_dir / "trash_state.json").write_text("{}", encoding="utf-8")
    (isolated_gallery_env.data_dir / "usable.json").write_text("[]", encoding="utf-8")

    assert extractor.list_json_files() == ["usable.json"]
