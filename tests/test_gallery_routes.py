from __future__ import annotations

from pathlib import Path

import pytest
from aiohttp import FormData, web
from aiohttp.test_utils import TestClient, TestServer


@pytest.fixture()
def anyio_backend():
    return "asyncio"


@pytest.fixture()
async def gallery_client(isolated_gallery_env):
    from py.gallery import routes

    app = web.Application()
    routes.register_routes(app)
    client = TestClient(TestServer(app))
    await client.start_server()
    try:
        yield client, routes
    finally:
        await client.close()


@pytest.mark.anyio
async def test_gallery_api_rejects_cross_site_origin(gallery_client):
    client, _routes = gallery_client
    response = await client.get("/universal_gallery/api/context", headers={"Origin": "https://evil.example"})

    assert response.status == 403
    assert (await response.json())["error"] == "same-origin request required"


@pytest.mark.anyio
async def test_gallery_api_rejects_cross_site_referer_and_fetch_site(gallery_client):
    client, _routes = gallery_client

    referer_response = await client.get(
        "/universal_gallery/api/context",
        headers={"Referer": "https://evil.example/gallery/"},
    )
    fetch_site_response = await client.get(
        "/universal_gallery/api/context",
        headers={"Sec-Fetch-Site": "cross-site"},
    )

    assert referer_response.status == 403
    assert fetch_site_response.status == 403


@pytest.mark.anyio
async def test_fingerprint_prewarm_keeps_same_origin_guard(gallery_client):
    client, _routes = gallery_client
    response = await client.post(
        "/universal_gallery/api/images/fingerprints/prewarm",
        json={"relative_paths": []},
        headers={"Origin": "https://evil.example"},
    )

    assert response.status == 403


@pytest.mark.anyio
async def test_update_status_route_returns_version_payload(gallery_client, monkeypatch):
    client, routes = gallery_client

    async def fake_check_update_status(*, force=False):
        return {
            "current_version": "1.2.7",
            "latest_version": "1.3.0",
            "update_available": True,
            "release_url": "https://example.test/release",
            "repository_url": "https://example.test/repo",
            "checked_at": 1,
            "error": "",
            "releases": [{"version": "1.3.0", "body": "- test"}],
            "force": force,
        }

    monkeypatch.setattr(routes, "check_update_status", fake_check_update_status)

    response = await client.get("/universal_gallery/api/update-status?force=true")
    payload = await response.json()

    assert response.status == 200
    assert payload["update_available"] is True
    assert payload["latest_version"] == "1.3.0"
    assert payload["force"] is True


@pytest.mark.anyio
async def test_gallery_context_returns_diagnostics_when_index_startup_fails(gallery_client, monkeypatch):
    client, routes = gallery_client

    def fail_context(*_args, **_kwargs):
        raise RuntimeError("index startup failed")

    monkeypatch.setattr(routes, "get_gallery_context", fail_context)

    response = await client.get("/universal_gallery/api/context")
    payload = await response.json()

    assert response.status == 200
    assert payload["index_error"] == "index startup failed"
    assert payload["subfolders"] == []
    assert isinstance(payload["diagnostics"], list)


@pytest.mark.anyio
async def test_gallery_images_returns_empty_page_when_index_startup_fails(gallery_client, monkeypatch):
    client, routes = gallery_client

    def fail_images(*_args, **_kwargs):
        raise RuntimeError("index startup failed")

    monkeypatch.setattr(routes, "list_images_page", fail_images)

    response = await client.get("/universal_gallery/api/images?page=2&limit=12")
    payload = await response.json()

    assert response.status == 200
    assert payload["index_error"] == "index startup failed"
    assert payload["images"] == []
    assert payload["total"] == 0
    assert payload["page"] == 2
    assert payload["limit"] == 12


@pytest.mark.anyio
async def test_gallery_import_rejects_file_count_and_size_limits(gallery_client, monkeypatch):
    client, routes = gallery_client
    monkeypatch.setattr(routes, "MAX_IMPORT_FILE_COUNT", 1)

    too_many = FormData()
    too_many.add_field("files", b"a", filename="one.png", content_type="image/png")
    too_many.add_field("files", b"b", filename="two.png", content_type="image/png")
    too_many_response = await client.post("/universal_gallery/api/import", data=too_many)

    monkeypatch.setattr(routes, "MAX_IMPORT_FILE_COUNT", 10)
    monkeypatch.setattr(routes, "MAX_IMPORT_FILE_BYTES", 4)
    too_large = FormData()
    too_large.add_field("files", b"12345", filename="big.png", content_type="image/png")
    too_large_response = await client.post("/universal_gallery/api/import", data=too_large)

    monkeypatch.setattr(routes, "MAX_IMPORT_FILE_BYTES", 100)
    monkeypatch.setattr(routes, "MAX_IMPORT_TOTAL_BYTES", 4)
    total_large = FormData()
    total_large.add_field("files", b"12", filename="a.png", content_type="image/png")
    total_large.add_field("files", b"345", filename="b.png", content_type="image/png")
    total_large_response = await client.post("/universal_gallery/api/import", data=total_large)

    assert too_many_response.status == 413
    assert too_large_response.status == 413
    assert total_large_response.status == 413


@pytest.mark.anyio
async def test_gallery_import_cleans_up_written_files_after_later_limit_failure(gallery_client, isolated_gallery_env, monkeypatch):
    client, routes = gallery_client
    monkeypatch.setattr(routes, "MAX_IMPORT_FILE_COUNT", 1)

    data = FormData()
    data.add_field("files", b"a", filename="one.png", content_type="image/png")
    data.add_field("files", b"b", filename="two.png", content_type="image/png")
    response = await client.post("/universal_gallery/api/import", data=data)

    assert response.status == 413
    assert not (isolated_gallery_env.output_dir / "universal_gallery_imports" / "one.png").exists()


@pytest.mark.anyio
async def test_library_import_rejects_oversized_payload(gallery_client, monkeypatch):
    client, routes = gallery_client
    monkeypatch.setattr(routes, "MAX_LIBRARY_IMPORT_BYTES", 4)

    data = FormData()
    data.add_field("file", b"12345", filename="artists.json", content_type="application/json")
    response = await client.post("/universal_gallery/api/library/import", data=data)

    assert response.status == 413


@pytest.mark.anyio
async def test_library_entry_and_search_limits_are_capped(gallery_client, isolated_gallery_env):
    client, routes = gallery_client
    isolated_gallery_env.service.save_library(
        "artists.json",
        [{"name": f"artist-{index}", "post_count": index} for index in range(600)],
    )

    entries_response = await client.get("/universal_gallery/api/library/entries?name=artists.json&limit=9999")
    search_response = await client.get("/universal_gallery/api/library/artists?name=artists.json&limit=9999")

    assert entries_response.status == 200
    assert search_response.status == 200
    entries_payload = await entries_response.json()
    search_payload = await search_response.json()
    assert entries_payload["limit"] == routes.MAX_LIBRARY_ENTRY_LIMIT
    assert len(entries_payload["data"]) == routes.MAX_LIBRARY_ENTRY_LIMIT
    assert len(search_payload["data"]) == routes.MAX_LIBRARY_SEARCH_LIMIT


@pytest.mark.anyio
async def test_gallery_static_responses_include_security_headers(gallery_client):
    client, routes = gallery_client
    index_response = await client.get("/gallery/")
    asset = next(Path(routes.GALLERY_UI_DIR, "assets").glob("*.js"))
    asset_response = await client.get(f"/gallery/assets/{asset.name}")

    assert index_response.headers["X-Content-Type-Options"] == "nosniff"
    assert "frame-ancestors 'self'" in index_response.headers["Content-Security-Policy"]
    assert asset_response.headers["X-Content-Type-Options"] == "nosniff"


@pytest.mark.anyio
async def test_gallery_asset_path_traversal_returns_not_found(gallery_client):
    client, _routes = gallery_client
    response = await client.get("/gallery/assets/%2e%2e/README.md")

    assert response.status == 404
