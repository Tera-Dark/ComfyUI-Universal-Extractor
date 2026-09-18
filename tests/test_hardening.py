from __future__ import annotations

import asyncio
import json
import random
import threading
from pathlib import Path

import pytest
from aiohttp import web

from py.gallery import execution, file_transactions, variant_fingerprints
from py.gallery.recipe import build_prompt_summary, extract_generation_recipe
from py.gallery.similarity import near_hash_pairs
from py.nodes.extractor_node import UniversalJsonSegmentRandomizer, select_items


@pytest.fixture()
def anyio_backend():
    return "asyncio"


@pytest.mark.parametrize("mode", ["random", "sequential", "polling"])
def test_unique_means_unique_values(mode):
    selected = select_items(["same", "same", "other"], 10, mode, 123, "unique_only", "test-unique")
    assert len(selected) == 2 and set(selected) == {"same", "other"}


def test_executor_fingerprint_changes_with_library_content(isolated_gallery_env):
    library = isolated_gallery_env.data_dir / "words.json"
    library.write_text('["a"]')
    first = UniversalJsonSegmentRandomizer.IS_CHANGED("words.json")
    assert first == UniversalJsonSegmentRandomizer.IS_CHANGED("words.json")
    library.write_text('["b"]')  # Same byte length; mtime granularity must not matter.
    assert first != UniversalJsonSegmentRandomizer.IS_CHANGED("words.json")
    polling = UniversalJsonSegmentRandomizer.IS_CHANGED("words.json", mode="polling")
    assert polling != polling


def test_missing_library_changes_when_created(isolated_gallery_env):
    first = UniversalJsonSegmentRandomizer.IS_CHANGED("new.json")
    (isolated_gallery_env.data_dir / "new.json").write_text("[]")
    assert first != UniversalJsonSegmentRandomizer.IS_CHANGED("new.json")


def test_library_symlink_cannot_escape(isolated_gallery_env, tmp_path):
    source = tmp_path / "secret.json"
    source.write_text('["secret"]')
    try:
        (isolated_gallery_env.data_dir / "escape.json").symlink_to(source)
    except OSError:
        pytest.skip("symlink privileges unavailable")
    assert isolated_gallery_env.extractor.resolve_library_path("escape.json") is None


def test_unknown_prompts_do_not_share_fingerprint(monkeypatch):
    monkeypatch.setattr(variant_fingerprints, "read_image_metadata", lambda _: {"comment": "hello"})
    assert variant_fingerprints.build_metadata_hashes("unused")[0] == ""


def test_multi_sampler_is_explicitly_ambiguous():
    sampler = {"class_type": "KSampler", "inputs": {"steps": 20, "cfg": 7, "positive": ["text", 0]}}
    metadata = {"prompt": {"a": sampler, "b": sampler, "text": {"inputs": {"text": "wrong guess"}}}}
    assert build_prompt_summary(metadata)["positive_prompt"] == ""
    assert "multiple_samplers" in extract_generation_recipe(metadata)["warnings"]


def test_literal_link_resolution_does_not_execute_dynamic_nodes():
    graph = {
        "sampler": {"inputs": {"steps": 20, "cfg": 7, "positive": ["encode", 0]}},
        "encode": {"class_type": "CLIPTextEncode", "inputs": {"text": ["literal", 0]}},
        "literal": {"class_type": "PrimitiveString", "inputs": {"value": "verified text"}},
    }
    assert build_prompt_summary({"prompt": graph})["positive_prompt"] == "verified text"
    graph["literal"]["class_type"] = "UniversalJsonSegmentRandomizer"
    assert build_prompt_summary({"prompt": graph})["positive_prompt"] == ""


@pytest.mark.parametrize("distance", [0, 1, 5, 12])
def test_hamming_index_matches_brute_force(distance):
    rng = random.Random(123)
    numbers = [rng.getrandbits(64) for _ in range(120)]
    numbers += [numbers[0], numbers[1] ^ 31, numbers[2] ^ 1]
    expected = {(i, j) for j in range(len(numbers)) for i in range(j)
                if (numbers[i] ^ numbers[j]).bit_count() <= distance}
    assert set(near_hash_pairs([f"{n:016x}" for n in numbers], distance)) == expected


@pytest.mark.parametrize("failure_stage", ["staging", "destination", "state"])
def test_move_failure_restores_files_and_state(tmp_path, monkeypatch, failure_stage):
    first, second = tmp_path / "one.png", tmp_path / "two.png"
    first.write_bytes(b"one")
    second.write_bytes(b"two")
    state = {"value": "before"}
    original_rename, original_move = file_transactions.os.rename, file_transactions._transfer_file
    calls = {"rename": 0, "move": 0}

    def rename(a, b):
        calls["rename"] += 1
        if failure_stage == "staging" and calls["rename"] == 2:
            raise OSError("injected staging failure")
        return original_rename(a, b)

    def move(a, b):
        calls["move"] += 1
        if failure_stage == "destination" and calls["move"] == 2:
            raise OSError("injected destination failure")
        return original_move(a, b)

    def commit():
        state["value"] = "after"
        if failure_stage == "state":
            raise OSError("injected state failure")

    monkeypatch.setattr(file_transactions.os, "rename", rename)
    monkeypatch.setattr(file_transactions, "_transfer_file", move)
    with pytest.raises(RuntimeError, match="journal"):
        file_transactions.execute_moves([(str(first), str(second)), (str(second), str(first))],
            str(tmp_path / "journal"), commit, lambda: state.update(value="before"), {"value": "before"})
    assert first.read_bytes() == b"one"
    assert second.read_bytes() == b"two"
    assert state["value"] == "before"
    assert not list(tmp_path.glob(".ue-move*"))
    journal = json.loads(next((tmp_path / "journal").glob("*.json")).read_text())
    assert journal["status"] == "rolled_back"


def test_transaction_handles_successful_swap(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    a.write_bytes(b"a")
    b.write_bytes(b"b")
    assert file_transactions.execute_moves([(str(a), str(b)), (str(b), str(a))],
        str(tmp_path / "journal"), lambda: "done", lambda: None, {}) == "done"
    assert a.read_bytes() == b"b" and b.read_bytes() == b"a"
    assert not list((tmp_path / "journal").glob("*.json"))


def test_move_state_failure_rolls_back_service(isolated_gallery_env, monkeypatch):
    env = isolated_gallery_env
    path = env.output_dir / "a.png"
    path.write_bytes(b"image")
    env.service.persist_image_state("a.png", {"title": "Keep me", "pinned": True})
    monkeypatch.setattr(env.service, "move_image_states", lambda _: (_ for _ in ()).throw(OSError("disk full")))
    with pytest.raises(RuntimeError):
        env.service.move_images(["a.png"], "destination")
    assert path.exists() and not (env.output_dir / "destination" / "a.png").exists()
    assert env.service.get_image_state("a.png")["title"] == "Keep me"


def test_restore_does_not_overwrite_new_file(isolated_gallery_env):
    env = isolated_gallery_env
    path = env.output_dir / "same.png"
    path.write_bytes(b"old")
    item = env.service.move_path_to_trash(full_path=str(path), kind="image", original_path="same.png")
    path.write_bytes(b"new")
    with pytest.raises(FileExistsError):
        env.service.restore_trash_item(item["id"])
    assert path.read_bytes() == b"new"
    assert env.service.get_trash_item(item["id"]) is not None


def test_recycle_failure_retains_plugin_trash(isolated_gallery_env, monkeypatch):
    env = isolated_gallery_env
    path = env.output_dir / "a.png"
    path.write_bytes(b"a")
    item = env.service.move_path_to_trash(full_path=str(path), kind="image", original_path="a.png")
    monkeypatch.setattr(env.service, "send_to_system_recycle_bin", lambda _: (_ for _ in ()).throw(OSError("no trash")))
    with pytest.raises(OSError):
        env.service.purge_trash_item(item["id"])
    assert Path(env.service.resolve_trash_storage_path(item)).read_bytes() == b"a"
    assert env.service.get_trash_item(item["id"]) is not None


@pytest.mark.anyio
async def test_worker_does_not_block_event_loop_and_holds_slot_after_cancel(monkeypatch):
    slots = threading.BoundedSemaphore(1)
    monkeypatch.setattr(execution, "_SLOTS", slots)
    started, finish = threading.Event(), threading.Event()

    def work():
        started.set()
        finish.wait(5)
        return True

    task = asyncio.create_task(execution.run_gallery_task(work))
    try:
        assert await asyncio.to_thread(started.wait, 2)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        with pytest.raises(web.HTTPServiceUnavailable):
            await execution.run_gallery_task(lambda: None)
    finally:
        finish.set()
        # Wait for the executor, not a timing-based sleep.
        await asyncio.wrap_future(execution._EXECUTOR.submit(lambda: None))
    assert await execution.run_gallery_task(lambda: 42) == 42


def test_snapshot_records_resolved_text_and_recipe_uses_node_identity():
    from py.nodes.prompt_snapshot import UniversalPromptSnapshot
    metadata = {}
    node = UniversalPromptSnapshot()
    assert node.capture("resolved actual text", "positive", metadata, "snap") == ("resolved actual text",)
    metadata["prompt"] = {
        "sampler": {"inputs": {"steps": 20, "cfg": 7, "positive": ["encode", 0]}},
        "encode": {"class_type": "CLIPTextEncode", "inputs": {"text": ["snap", 0]}},
        "snap": {"class_type": "UniversalPromptSnapshot", "inputs": {"text": ["dynamic", 0]}},
    }
    # Pillow may expose extra PNG metadata as a JSON string.
    metadata["universal_prompt_snapshots"] = json.dumps(metadata["universal_prompt_snapshots"])
    assert build_prompt_summary(metadata)["positive_prompt"] == "resolved actual text"
    changed = node.IS_CHANGED()
    assert changed != changed


def test_cross_device_copy_failure_cleans_partial_target(tmp_path, monkeypatch):
    import errno
    source, target = tmp_path / "source", tmp_path / "target"
    source.write_bytes(b"valuable")
    monkeypatch.setattr(file_transactions.os, "link", lambda *args: (_ for _ in ()).throw(OSError(errno.EXDEV, "cross-device")))
    def partial_copy(incoming, outgoing, length):
        outgoing.write(b"partial")
        raise OSError("disk full")
    monkeypatch.setattr(file_transactions.shutil, "copyfileobj", partial_copy)
    with pytest.raises(OSError):
        file_transactions._transfer_file(str(source), str(target))
    assert source.read_bytes() == b"valuable" and not target.exists()


def test_trash_batch_ledger_failure_rolls_back_all_files(isolated_gallery_env, monkeypatch):
    env = isolated_gallery_env
    for name in ("a.png", "b.png"):
        (env.output_dir / name).write_bytes(name.encode())
        env.service.persist_image_state(name, {"pinned": True})
    original, count = env.service.add_trash_item, [0]
    def fail_second(**kwargs):
        count[0] += 1
        if count[0] == 2:
            raise OSError("ledger failed")
        return original(**kwargs)
    monkeypatch.setattr(env.service, "add_trash_item", fail_second)
    with pytest.raises(RuntimeError):
        env.service.delete_images(["a.png", "b.png"])
    assert not env.service.list_trash_items()
    for name in ("a.png", "b.png"):
        assert (env.output_dir / name).read_bytes() == name.encode()
        assert env.service.get_image_state(name)["pinned"]


def test_merge_into_descendant_is_rejected(isolated_gallery_env):
    folder = isolated_gallery_env.output_dir / "folder"
    folder.mkdir()
    with pytest.raises(ValueError, match="inside"):
        isolated_gallery_env.service.merge_folder("folder", "folder/nested")


def test_folder_trash_and_restore_preserve_state(isolated_gallery_env):
    env = isolated_gallery_env
    folder = env.output_dir / "folder"
    folder.mkdir()
    (folder / "a.png").write_bytes(b"a")
    env.service.persist_image_state("folder/a.png", {"title": "Keep"})
    env.service.delete_folder("folder")
    assert not folder.exists()
    item = env.service.list_trash_items()[0]
    env.service.restore_trash_item(item["id"])
    assert (folder / "a.png").read_bytes() == b"a"
    assert env.service.get_image_state("folder/a.png")["title"] == "Keep"


def test_input_source_trash_restores_to_input_not_output(isolated_gallery_env):
    env = isolated_gallery_env
    path = env.input_dir / "a.png"
    path.write_bytes(b"input")
    env.service.save_gallery_source({"id": "default_input", "writable": True})
    item = env.service.move_path_to_trash(full_path=str(path), kind="image", original_path="default_input::a.png")
    env.service.restore_trash_item(item["id"])
    assert path.read_bytes() == b"input"
    assert not (env.output_dir / "a.png").exists()


def test_snapshot_survives_png_round_trip(tmp_path):
    from PIL import Image, PngImagePlugin
    from py.gallery.metadata import read_image_metadata
    info = PngImagePlugin.PngInfo()
    info.add_text("universal_prompt_snapshots", json.dumps({"n": {"text": "actual"}}))
    path = tmp_path / "snapshot.png"
    Image.new("RGB", (8, 8)).save(path, pnginfo=info)
    assert read_image_metadata(str(path))["universal_prompt_snapshots"]["n"]["text"] == "actual"


def test_incomplete_positive_prompt_does_not_group_by_negative(monkeypatch):
    metadata = {"prompt": {
        "s": {"inputs": {"steps": 20, "cfg": 7, "positive": ["unknown", 0], "negative": ["n", 0]}},
        "n": {"inputs": {"text": "low quality"}},
    }}
    monkeypatch.setattr(variant_fingerprints, "read_image_metadata", lambda _: metadata)
    assert variant_fingerprints.build_metadata_hashes("unused")[0] == ""


def test_transaction_does_not_overwrite_existing_destination(tmp_path):
    a, b = tmp_path / "a", tmp_path / "b"
    a.write_bytes(b"old")
    b.write_bytes(b"important")
    with pytest.raises(FileExistsError):
        file_transactions.execute_moves([(str(a), str(b))], str(tmp_path / "journal"), lambda: None, lambda: None, {})
    assert a.read_bytes() == b"old" and b.read_bytes() == b"important"


def test_failed_rollback_keeps_recovery_journal(tmp_path, monkeypatch):
    source, target = tmp_path / "a", tmp_path / "b"
    source.write_bytes(b"valuable")
    original = file_transactions._transfer_file
    def move(a, b):
        if a == str(target):
            raise OSError("rollback unavailable")
        return original(a, b)
    monkeypatch.setattr(file_transactions, "_transfer_file", move)
    with pytest.raises(RuntimeError):
        file_transactions.execute_moves([(str(source), str(target))], str(tmp_path / "journal"),
            lambda: (_ for _ in ()).throw(OSError("state failed")), lambda: None, {})
    assert target.read_bytes() == b"valuable"
    journal = json.loads(next((tmp_path / "journal").glob("*.json")).read_text())
    assert journal["status"] == "needs_recovery" and journal["rollback_errors"]


def test_pending_journal_blocks_new_mutations(tmp_path):
    folder = tmp_path / "journal"
    folder.mkdir()
    (folder / "pending.json").write_text('{"status":"pending"}')
    with pytest.raises(RuntimeError, match="Unresolved"):
        file_transactions.execute_moves([], str(folder), lambda: None, lambda: None, {})


def test_stable_update_is_newer_than_local_candidate():
    from py.gallery.update_checker import _compare_versions
    assert _compare_versions("1.3.0", "1.3.0-rc.1") > 0
    assert _compare_versions("1.3.0-rc.10", "1.3.0-rc.2") > 0
    assert _compare_versions("1.2.10", "1.3.0-rc.1") < 0
