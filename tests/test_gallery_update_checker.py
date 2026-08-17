from __future__ import annotations

import pytest

from py.gallery import update_checker


@pytest.fixture()
def anyio_backend():
    return "asyncio"


@pytest.mark.anyio
async def test_update_checker_reports_available_release(monkeypatch):
    monkeypatch.setattr(update_checker, "_UPDATE_CACHE", None)
    monkeypatch.setattr(update_checker, "_UPDATE_CACHE_TS", 0.0)
    monkeypatch.setattr(update_checker, "_read_current_version", lambda: "1.2.7")
    monkeypatch.setattr(
        update_checker,
        "_fetch_releases_from_github",
        lambda: [
            {
                "tag_name": "v1.3.0",
                "name": "Version 1.3.0",
                "body": "- Added update center",
                "html_url": "https://github.com/Tera-Dark/ComfyUI-Universal-Extractor/releases/tag/v1.3.0",
                "published_at": "2026-07-01T00:00:00Z",
                "draft": False,
                "prerelease": False,
            }
        ],
    )

    status = await update_checker.check_update_status(force=True)

    assert status["current_version"] == "1.2.7"
    assert status["latest_version"] == "1.3.0"
    assert status["update_available"] is True
    assert status["releases"][0]["body"] == "- Added update center"


@pytest.mark.anyio
async def test_update_checker_fails_softly_when_github_is_unavailable(monkeypatch):
    monkeypatch.setattr(update_checker, "_UPDATE_CACHE", None)
    monkeypatch.setattr(update_checker, "_UPDATE_CACHE_TS", 0.0)
    monkeypatch.setattr(update_checker, "_read_current_version", lambda: "1.2.7")

    def raise_offline():
        raise OSError("offline")

    monkeypatch.setattr(update_checker, "_fetch_releases_from_github", raise_offline)

    status = await update_checker.check_update_status(force=True)

    assert status["current_version"] == "1.2.7"
    assert status["latest_version"] == "1.2.7"
    assert status["update_available"] is False
    assert "offline" in status["error"]


@pytest.mark.anyio
async def test_update_checker_includes_local_notes_when_current_version_is_ahead(monkeypatch):
    monkeypatch.setattr(update_checker, "_UPDATE_CACHE", None)
    monkeypatch.setattr(update_checker, "_UPDATE_CACHE_TS", 0.0)
    monkeypatch.setattr(update_checker, "_read_current_version", lambda: "1.2.8")
    monkeypatch.setattr(update_checker, "_read_local_changelog_body", lambda version: "- Local 1.2.8 notes")
    monkeypatch.setattr(
        update_checker,
        "_fetch_releases_from_github",
        lambda: [
            {
                "tag_name": "v1.2.7",
                "name": "Version 1.2.7",
                "body": "",
                "html_url": "https://github.com/Tera-Dark/ComfyUI-Universal-Extractor/releases/tag/v1.2.7",
                "published_at": "2026-07-01T00:00:00Z",
                "draft": False,
                "prerelease": False,
            }
        ],
    )

    status = await update_checker.check_update_status(force=True)

    assert status["current_version"] == "1.2.8"
    assert status["latest_version"] == "1.2.8"
    assert status["update_available"] is False
    assert status["releases"][0]["version"] == "1.2.8"
    assert status["releases"][0]["body"] == "- Local 1.2.8 notes"
