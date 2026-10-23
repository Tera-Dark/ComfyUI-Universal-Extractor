from __future__ import annotations

from pathlib import Path

import pytest
from aiohttp import FormData, web
from aiohttp.test_utils import TestClient, TestServer
import asyncio


@pytest.mark.anyio
async def test_completion_relay_is_bounded_read_only_and_source_scoped(gallery_client):
    client, _ = gallery_client
    body = {"version": 1, "prompt_id": "real-round", "outputs": [{"type": "output", "subfolder": ""}]}
    response = await client.post("/universal_gallery/api/sync-notifications", json=body)
    assert response.status == 200
    event = (await response.json())["event"]
    assert event["scopes"] == ["default_output::"]
    again = await client.post("/universal_gallery/api/sync-notifications", json=body)
    assert (await again.json())["event"]["sequence"] == event["sequence"]
    status = await client.get("/universal_gallery/api/sync-status?since=0")
    assert (await status.json())["events"] == [event]
    jobs = await client.get("/universal_gallery/api/jobs")
    assert (await jobs.json())["jobs"] == []  # a hint never silently starts work
    foreign = await client.post("/universal_gallery/api/sync-notifications", json=body, headers={"Origin": "https://evil.example"})
    assert foreign.status == 403
    for invalid in ({**body, "outputs": [{"type": "output", "subfolder": "../outside"}]},
                    {**body, "outputs": [{}] * 129}, {**body, "prompt_id": "x" * 201}):
        assert (await client.post("/universal_gallery/api/sync-notifications", json=invalid)).status == 400
    assert (await client.get("/universal_gallery/api/sync-status?since=-1")).status == 400


@pytest.mark.anyio
async def test_task_long_poll_wakes_without_holding_query_workers(gallery_client, isolated_gallery_env, monkeypatch):
    client, _ = gallery_client
    service = isolated_gallery_env.service
    monkeypatch.setattr(service, "_schedule_dimension_backfill", lambda *args: None)
    monkeypatch.setattr(service, "_schedule_color_index_backfill", lambda *args: None)
    first = await client.get("/universal_gallery/api/jobs")
    revision = (await first.json())["revision"]
    waiting = asyncio.create_task(client.get(f"/universal_gallery/api/jobs?after={revision}&wait_ms=2000"))
    await asyncio.sleep(.02)
    assert not waiting.done()
    # Both read workers remain free while the async subscription is waiting.
    one, two = await asyncio.gather(client.get("/universal_gallery/api/jobs"), client.get("/universal_gallery/api/sync-status"))
    assert one.status == two.status == 200
    job = await client.post("/universal_gallery/api/jobs", json={"kind": "refresh_index", "payload": {"force": False}})
    assert job.status == 202
    response = await asyncio.wait_for(waiting, 1)
    assert (await response.json())["revision"] > revision
    assert (await client.get("/universal_gallery/api/jobs?after=-1")).status == 400
    assert (await client.get("/universal_gallery/api/jobs?after=0&wait_ms=999999")).status == 400
    scheduler = isolated_gallery_env.service.get_runtime().get_jobs()
    await asyncio.wrap_future(scheduler.future((await job.json())["job"]["id"]))
    task = asyncio.create_task(scheduler.wait_for_change(scheduler.change_version, 10))
    await asyncio.sleep(.01)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert scheduler.change_waiters == set()


@pytest.mark.anyio
async def test_locate_reuses_list_order_and_validates_sources(gallery_client, isolated_gallery_env):
    from PIL import Image
    env = isolated_gallery_env
    folder = env.output_dir / "old"
    folder.mkdir()
    for index in range(7):
        Image.new("RGB", (16, 16), "red").save(folder / f"image_{index}.png")
    listed = env.service.list_images_page(subfolder="default_output::old", limit=2, page=3, sort_by="filename", sort_order="asc", force_refresh=True)
    image = listed["images"][0]
    client, _ = gallery_client
    response = await client.get("/universal_gallery/api/images/locate", params={"asset_id": image["asset_id"], "limit": "2", "sort_by": "filename", "sort_order": "asc"})
    assert response.status == 200
    located = await response.json()
    assert located["page"] == 3 and located["index"] == 0
    assert located["subfolder"] == "default_output::old"
    assert located["relative_path"] == image["relative_path"]
    for params in ({"relative_path": "../escape.png"}, {"asset_id": image["asset_id"], "limit": "0"}, {"asset_id": "x" * 201}, {}):
        assert (await client.get("/universal_gallery/api/images/locate", params=params)).status == 400
    assert (await client.get("/universal_gallery/api/images/locate", params={"asset_id": image["asset_id"]}, headers={"Origin": "https://evil.example"})).status == 403
    (folder / image["filename"]).unlink()
    assert (await client.get("/universal_gallery/api/images/locate", params={"asset_id": image["asset_id"]})).status == 404


@pytest.mark.anyio
async def test_release_notes_route_is_local_and_bounded(gallery_client):
    client, _ = gallery_client
    response = await client.get("/universal_gallery/api/release-notes?locale=en")
    assert response.status == 200
    notes = await response.json()
    assert notes["releases"][0]["version"] == notes["current_version"]
    assert 1 <= len(notes["releases"]) <= 5
    # Check installed content rather than a phrase tied to an older release.
    from py.gallery.release_notes import NOTES_DIR
    import json
    installed = json.loads((NOTES_DIR / f"{notes['current_version']}.json").read_text(encoding="utf-8"))
    assert notes["source"] == "local"
    assert installed["locales"]["en"][0]["title"] in notes["releases"][0]["body"]
    assert installed["locales"]["en"][0]["items"][0] in notes["releases"][0]["body"]


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
async def test_jobs_validate_input_and_origin(gallery_client):
    client, _ = gallery_client
    response = await client.post("/universal_gallery/api/jobs", json={"kind": "arbitrary_command"})
    assert response.status == 400
    response = await client.post("/universal_gallery/api/jobs", json={"kind": "refresh_index", "payload": {"subfolder": "../escape"}})
    assert response.status == 400
    response = await client.post("/universal_gallery/api/jobs", json={"kind": "refresh_index"}, headers={"Origin": "https://evil.example"})
    assert response.status == 403
    response = await client.post("/universal_gallery/api/jobs", json={"kind": "refresh_index", "payload": {"force": False}})
    assert response.status == 202
    job = (await response.json())["job"]
    import json
    contract = json.loads((Path(__file__).parent / "fixtures/gallery-contracts.json").read_text())
    assert set(contract["job"]).issubset(job)
    assert job["kind"] == "refresh_index"
    response = await client.get(f"/universal_gallery/api/jobs/{job['id']}")
    assert response.status == 200
    assert (await response.json())["job"]["id"] == job["id"]
    response = await client.get("/universal_gallery/api/jobs/not-found")
    assert response.status == 404


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


@pytest.mark.anyio
async def test_json_arrays_and_invalid_bulk_paths_are_rejected(gallery_client):
    client, _ = gallery_client
    response = await client.post("/universal_gallery/api/images/move", json=[])
    assert response.status == 400
    response = await client.post("/universal_gallery/api/images/move", json={"relative_paths": [None]})
    assert response.status == 400


@pytest.mark.anyio
async def test_catalog_failure_keeps_snapshot_browsable_and_blocks_mutations(gallery_client, isolated_gallery_env):
    import asyncio
    client, _ = gallery_client
    env = isolated_gallery_env
    (env.output_dir / "a.png").write_bytes(b"one")
    first = await client.get("/universal_gallery/api/images")
    assert first.status == 200
    original = (await first.json())["images"][0]["asset_id"]
    runtime = env.service.get_runtime()
    await asyncio.to_thread(runtime.close)
    (env.data_dir / "catalog.sqlite3").write_bytes(b"unavailable authoritative data")
    response = await client.get("/universal_gallery/api/images")
    assert response.status == 200
    assert (await response.json())["images"][0]["asset_id"] == original
    context = await client.get("/universal_gallery/api/context")
    assert (await context.json())["read_only"] is True
    mutation = await client.post("/universal_gallery/api/images/rename", json={"relative_path": "a.png", "new_filename": "b.png"})
    assert mutation.status == 503
    assert (env.output_dir / "a.png").exists()
