from __future__ import annotations

import json


def test_image_state_boards_and_renames_are_persisted_in_isolated_data_dir(isolated_gallery_env):
    state_store = isolated_gallery_env.state_store

    image_state, categories = state_store.update_image_state(
        "source.png",
        {"category": "Portrait", "title": "First", "pinned": True},
    )
    board = state_store.create_board("Favorites", "Pinned references")
    updated, updated_categories = state_store.set_image_board_membership(["source.png"], board["id"], True)
    renamed_state, renamed_categories = state_store.rename_image_state("source.png", "nested/renamed.png")

    assert image_state["pinned"] is True
    assert categories == ["Portrait"]
    assert updated == ["source.png"]
    assert updated_categories == ["Portrait"]
    assert renamed_state["boards"] == [board["id"]]
    assert renamed_categories == ["Portrait"]
    assert state_store.get_image_state("nested/renamed.png")["title"] == "First"

    state_file = isolated_gallery_env.data_dir / "gallery_state.json"
    persisted = json.loads(state_file.read_text(encoding="utf-8"))
    assert "nested/renamed.png" in persisted["images"]
    assert not (isolated_gallery_env.output_dir / "gallery_state.json").exists()
