from __future__ import annotations

import asyncio
from pathlib import Path

import pytest

from py.gallery.uploads import UploadSession, recover_uploads


def validator(root):
    def validate(path, _kind):
        Path(path).resolve().relative_to(root.resolve())
    return validate


def test_upload_not_visible_until_commit_and_duplicate_names(tmp_path):
    session = UploadSession(tmp_path / "data", validator(tmp_path))
    target = tmp_path / "image.png"
    first = session.add(str(target), "image")
    second = session.add(str(target), "image")
    session.write(first, b"one")
    session.write(second, b"two")
    assert not target.exists()
    entries = session.commit()
    assert [Path(entry["target"]).read_bytes() for entry in entries] == [b"one", b"two"]
    assert not session.journal.exists()


def test_upload_abort_and_crash_recovery(tmp_path):
    session = UploadSession(tmp_path / "data", validator(tmp_path))
    session.write(session.add(str(tmp_path / "a.png"), "image"), b"partial")
    assert recover_uploads(tmp_path / "data", validator(tmp_path)) == []
    assert not Path(session.entries[0]["stage"]).exists()
    assert not (tmp_path / "a.png").exists()


def test_upload_commit_collision_preserves_user_file(tmp_path):
    session = UploadSession(tmp_path / "data", validator(tmp_path))
    session.write(session.add(str(tmp_path / "a.png"), "image"), b"new")
    (tmp_path / "a.png").write_bytes(b"existing")
    with pytest.raises(FileExistsError):
        session.commit()
    assert (tmp_path / "a.png").read_bytes() == b"existing"


def test_batch_saves_once_and_noop_does_not_save(isolated_gallery_env, monkeypatch):
    from py.gallery import state_store
    env = isolated_gallery_env
    for name in ("a.png", "b.png"):
        (env.output_dir / name).write_bytes(b"test")
    original = state_store.save_gallery_state
    calls = []
    def save(state):
        calls.append(True)
        original(state)
    monkeypatch.setattr(state_store, "save_gallery_state", save)
    result = env.service.batch_update_images(["a.png", "b.png", "a.png", "missing.png"], {"notes": "test"})
    assert result["updated"] == ["a.png", "b.png"]
    assert result["missing"] == ["missing.png"]
    assert len(calls) == 1
    env.service.batch_update_images(["a.png", "b.png"], {"notes": "test"})
    assert len(calls) == 1


def test_asset_identity_survives_rebuilt_index_and_tracks_content(isolated_gallery_env):
    env = isolated_gallery_env
    (env.output_dir / "a.png").write_bytes(b"one")
    (env.output_dir / "copy.png").write_bytes(b"one")
    first = env.service.list_images_page()["images"]
    ids = {row["filename"]: row["asset_id"] for row in first}
    assert ids["a.png"] and ids["a.png"] != ids["copy.png"]
    Path(env.service.GALLERY_INDEX_DB_FILE).unlink()
    rebuilt = env.service.list_images_page()["images"]
    assert {row["filename"]: row["asset_id"] for row in rebuilt} == ids
    (env.output_dir / "a.png").write_bytes(b"changed contents")
    changed = env.service.list_images_page(force_refresh=True)["images"]
    row = next(row for row in changed if row["filename"] == "a.png")
    assert row["asset_id"] == ids["a.png"]
    assert row["content_revision"] == 2


def test_corrupt_authoritative_catalog_is_not_rebuilt(isolated_gallery_env):
    env = isolated_gallery_env
    path = env.data_dir / "catalog.sqlite3"
    path.write_bytes(b"broken authoritative data")
    runtime = env.service.get_runtime()
    assert runtime.catalog is None
    assert path.read_bytes() == b"broken authoritative data"
    from py.gallery.catalog import CatalogUnavailable
    with pytest.raises(CatalogUnavailable):
        runtime.require_catalog()


@pytest.mark.anyio
async def test_interrupted_upload_leaves_no_partial(isolated_gallery_env):
    from py.gallery import routes
    class Part:
        filename = "broken.png"
        count = 0
        async def read_chunk(self):
            self.count += 1
            if self.count == 1:
                return b"partial"
            raise ConnectionResetError("disconnected")
    class Reader:
        async def next(self):
            return Part()
    class Request:
        content_length = None
        async def multipart(self):
            return Reader()
    with pytest.raises(ConnectionResetError):
        await routes.api_import_files(Request())
    assert not list(isolated_gallery_env.output_dir.rglob("*.part"))
    assert not list(isolated_gallery_env.output_dir.rglob("broken.png"))


@pytest.fixture
def anyio_backend():
    return "asyncio"
