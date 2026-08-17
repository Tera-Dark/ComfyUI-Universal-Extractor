from __future__ import annotations

import sys
import types
from pathlib import Path
from types import SimpleNamespace

import pytest


ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))


folder_paths = types.ModuleType("folder_paths")
folder_paths.base_path = str(ROOT_DIR)
folder_paths.get_output_directory = lambda: str(ROOT_DIR / "output")
folder_paths.get_input_directory = lambda: str(ROOT_DIR / "input")
sys.modules.setdefault("folder_paths", folder_paths)


@pytest.fixture()
def isolated_gallery_env(tmp_path, monkeypatch):
    comfy_base = tmp_path / "comfy"
    output_dir = comfy_base / "output"
    input_dir = comfy_base / "input"
    data_dir = tmp_path / "plugin-data"
    trash_dir = data_dir / "trash"
    thumb_cache_dir = data_dir / "thumb_cache"
    for directory in (output_dir, input_dir, data_dir, trash_dir, thumb_cache_dir):
        directory.mkdir(parents=True, exist_ok=True)

    monkeypatch.setattr(folder_paths, "base_path", str(comfy_base), raising=False)
    monkeypatch.setattr(folder_paths, "get_output_directory", lambda: str(output_dir), raising=False)
    monkeypatch.setattr(folder_paths, "get_input_directory", lambda: str(input_dir), raising=False)

    from py import constants, paths
    from py.gallery import service, state_store
    from py.nodes import extractor_node

    monkeypatch.setattr(constants, "DATA_DIR", str(data_dir))
    monkeypatch.setattr(constants, "GALLERY_STATE_FILE", str(data_dir / "gallery_state.json"))
    monkeypatch.setattr(constants, "GALLERY_SOURCES_FILE", str(data_dir / "gallery_sources.json"))
    monkeypatch.setattr(constants, "THUMB_CACHE_DIR", str(thumb_cache_dir))
    monkeypatch.setattr(constants, "TRASH_DIR", str(trash_dir))
    monkeypatch.setattr(constants, "TRASH_STATE_FILE", str(data_dir / "trash_state.json"))

    monkeypatch.setattr(paths, "DATA_DIR", str(data_dir))
    monkeypatch.setattr(paths, "GALLERY_STATE_FILE", str(data_dir / "gallery_state.json"))
    monkeypatch.setattr(paths, "TRASH_DIR", str(trash_dir))
    monkeypatch.setattr(paths, "TRASH_STATE_FILE", str(data_dir / "trash_state.json"))

    monkeypatch.setattr(extractor_node, "DATA_DIR", str(data_dir))

    monkeypatch.setattr(service, "DATA_DIR", str(data_dir))
    monkeypatch.setattr(service, "GALLERY_SOURCES_FILE", str(data_dir / "gallery_sources.json"))
    monkeypatch.setattr(service, "THUMB_CACHE_DIR", str(thumb_cache_dir))
    monkeypatch.setattr(service, "TRASH_DIR", str(trash_dir))
    monkeypatch.setattr(service, "GALLERY_INDEX_DB_FILE", str(data_dir / "gallery_index.sqlite3"))
    monkeypatch.setattr(service, "LIBRARY_SUMMARY_CACHE_FILE", str(data_dir / "library_summary_cache.json"))

    service.LIBRARY_CACHE.clear()
    service.LIBRARY_SUMMARY_CACHE.clear()
    service.LIBRARY_SUMMARY_CACHE_LOADED = False
    service.LIBRARY_SUMMARY_CACHE_DIRTY = False
    service.IMAGE_FRESHNESS_CACHE.clear()
    service.IMAGE_INDEX_CACHE.update(
        {
            "signature": None,
            "output_dir": None,
            "built_at": 0.0,
            "images": [],
            "subfolders": [],
            "sources": [],
            "dirty": False,
        }
    )

    return SimpleNamespace(
        data_dir=data_dir,
        output_dir=output_dir,
        input_dir=input_dir,
        service=service,
        state_store=state_store,
        extractor=extractor_node,
    )
