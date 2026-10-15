from __future__ import annotations

import asyncio
import io
import os
from types import SimpleNamespace

import pytest
from aiohttp import FormData, web
from aiohttp.test_utils import TestClient, TestServer
from PIL import Image, ImageDraw

from py.gallery.image_search import build_search_index, describe_upload, find_images, match_score


@pytest.fixture()
def anyio_backend():
    return "asyncio"


def picture():
    image = Image.new("RGB", (480, 640), "#cad8a4")
    draw = ImageDraw.Draw(image)
    draw.polygon([(0, 420), (230, 120), (480, 490)], fill="#664788")
    draw.ellipse((80, 70, 220, 230), fill="#ffac32")
    draw.rectangle((210, 410, 435, 530), fill="#2356ab")
    return image


def encoded(image, format="PNG", **options):
    stream = io.BytesIO()
    image.save(stream, format=format, **options)
    return stream.getvalue()


def warm(service):
    service.ensure_image_index_db_current(force_refresh=True)
    return build_search_index(service._environment, SimpleNamespace(checkpoint=lambda *args: None))


def test_compressed_resized_reference_finds_original_and_separate_copies(isolated_gallery_env):
    env = isolated_gallery_env
    image = picture()
    folder = env.output_dir / "2025-01-01"
    folder.mkdir()
    payload = encoded(image)
    (folder / "forgotten.png").write_bytes(payload)
    (env.output_dir / "copy.png").write_bytes(payload)
    Image.new("RGB", (480, 640), "#000030").save(env.output_dir / "unrelated.png")
    warm(env.service)
    exact = find_images(env.service._environment, describe_upload(payload))
    assert {match["image"]["filename"] for match in exact["matches"]} == {"forgotten.png", "copy.png"}
    assert all(match["match_type"] == "exact" for match in exact["matches"])
    assert len({match["image"]["asset_id"] for match in exact["matches"]}) == 2
    reference = encoded(image.resize((180, 240)), "JPEG", quality=55)
    result = find_images(env.service._environment, describe_upload(reference))
    assert result["indexed"] == result["total"] == 3
    assert {match["image"]["filename"] for match in result["matches"]} == {"forgotten.png", "copy.png"}
    assert all(match["score"] > 90 and match["match_type"] == "similar" for match in result["matches"])
    assert str(folder / "forgotten.png") in {match["full_path"] for match in result["matches"]}


def test_exif_orientation_and_small_watermark():
    image = picture()
    original = describe_upload(encoded(image))
    rotated = image.transpose(Image.Transpose.ROTATE_90)
    exif = Image.Exif()
    exif[274] = 6
    assert match_score(original, describe_upload(encoded(rotated, "JPEG", quality=80, exif=exif))) > 90
    marked = image.resize((240, 320))
    ImageDraw.Draw(marked).text((140, 305), "SOCIAL", fill="white")
    assert match_score(original, describe_upload(encoded(marked, "JPEG", quality=50))) > 85
    assert match_score(describe_upload(encoded(Image.new("RGB", (50, 50), "red"))),
                       describe_upload(encoded(Image.new("RGB", (50, 50), "blue")))) < 55


def test_whole_library_index_has_no_recent_items_limit(isolated_gallery_env, monkeypatch):
    env = isolated_gallery_env
    payload = encoded(picture().resize((48, 64)))
    descriptor = describe_upload(payload)
    from py.gallery.variant_fingerprints import FINGERPRINT_VERSION
    fingerprint = {"search_descriptor": descriptor, "file_hash": descriptor["file_hash"], "version": FINGERPRINT_VERSION}
    monkeypatch.setattr(env.service, "build_image_fingerprint", lambda *args: fingerprint)
    for index in range(405):
        (env.output_dir / f"old-{index:04d}.png").write_bytes(payload)
    warm(env.service)
    result = find_images(env.service._environment, descriptor)
    assert result["indexed"] == result["total"] == 405
    assert result["pending"] == 0
    assert len(result["matches"]) == 50


def test_changed_or_deleted_asset_does_not_match_stale_fingerprint(isolated_gallery_env):
    env = isolated_gallery_env
    path = env.output_dir / "old.png"
    payload = encoded(picture())
    path.write_bytes(payload)
    stamp = path.stat()
    fixed_ns = (stamp.st_mtime_ns // 1_000_000_000) * 1_000_000_000 + 100_000_000
    os.utime(path, ns=(stamp.st_atime_ns, fixed_ns))
    warm(env.service)
    query = describe_upload(payload)
    path.write_bytes(encoded(Image.new("RGB", (50, 50), "white")))
    # Reject a candidate whose physical file no longer matches the indexed snapshot.
    assert find_images(env.service._environment, query)["matches"] == []
    env.service.ensure_image_index_db_current(force_refresh=True)
    result = find_images(env.service._environment, query)
    assert result["matches"] == [] and result["pending"] == 1
    path.unlink()
    env.service.ensure_image_index_db_current(force_refresh=True)
    assert find_images(env.service._environment, query)["total"] == 0


def test_same_size_subsecond_external_edit_is_rejected(isolated_gallery_env):
    env = isolated_gallery_env
    path = env.output_dir / "same-size.png"
    payload = encoded(picture())
    path.write_bytes(payload)
    stamp = path.stat()
    fixed_ns = (stamp.st_mtime_ns // 1_000_000_000) * 1_000_000_000 + 100_000_000
    os.utime(path, ns=(stamp.st_atime_ns, fixed_ns))
    warm(env.service)
    observed = path.stat()
    changed = bytearray(payload)
    changed[-1] ^= 1
    path.write_bytes(changed)
    os.utime(path, ns=(observed.st_atime_ns, observed.st_mtime_ns + 1_000_000))
    assert path.stat().st_size == observed.st_size
    assert int(path.stat().st_mtime) == int(observed.st_mtime)
    assert path.stat().st_mtime_ns != observed.st_mtime_ns
    assert find_images(env.service._environment, describe_upload(payload))["matches"] == []


@pytest.mark.anyio
async def test_reference_upload_security_limits_and_no_import(isolated_gallery_env, monkeypatch):
    env = isolated_gallery_env
    from py.gallery import routes, image_search_routes
    (env.output_dir / "original.png").write_bytes(encoded(picture()))
    app = web.Application()
    routes.register_routes(app)
    async with TestClient(TestServer(app)) as client:
        endpoint = "/universal_gallery/api/images/search-by-image"
        before = set(env.output_dir.rglob("*"))
        def upload(payload=b"bad", count=1):
            form = FormData()
            for _ in range(count):
                form.add_field("image", payload, filename="../../reference.png", content_type="image/png")
            return form
        assert (await client.post(endpoint, data=upload(), headers={"Origin": "https://evil.example"})).status == 403
        assert (await client.post(endpoint, data=upload())).status == 400
        assert (await client.post(endpoint, data=upload(count=2))).status == 400
        assert (await client.post(endpoint + "?minimum=0", data=upload())).status == 400
        response = await client.post(endpoint, data=upload(encoded(picture())))
        assert response.status == 200
        initial = await response.json()
        if initial.get("job"):
            await asyncio.wrap_future(env.service.get_runtime().get_jobs().future(initial["job"]["id"]))
        response = await client.post(endpoint, data=upload(encoded(picture())))
        result = await response.json()
        assert result["matches"][0]["match_type"] == "exact"
        assert result["matches"][0]["image"]["asset_id"]
        assert set(env.output_dir.rglob("*")) == before
        monkeypatch.setattr(image_search_routes, "MAX_REFERENCE_BYTES", 32)
        assert (await client.post(endpoint, data=upload(b"x" * 33))).status == 413
        runtime = env.service.get_runtime()
        runtime.image_search_sessions.acquire()
        runtime.image_search_sessions.acquire()
        try:
            assert (await client.post(endpoint, data=upload())).status == 503
            # Saturating search must not occupy ordinary query workers.
            assert (await client.get("/universal_gallery/api/images")).status == 200
        finally:
            runtime.image_search_sessions.release()
            runtime.image_search_sessions.release()


@pytest.mark.anyio
async def test_two_blocked_searches_leave_ordinary_queries_available(isolated_gallery_env, monkeypatch):
    from threading import Barrier, Event
    from py.gallery import routes, image_search_routes

    env = isolated_gallery_env
    payload = encoded(picture())
    (env.output_dir / "original.png").write_bytes(payload)
    warm(env.service)
    arrived, release = Barrier(3), Event()
    original = image_search_routes.find_images
    def blocked(*args):
        arrived.wait(5)
        assert release.wait(5)
        return original(*args)
    monkeypatch.setattr(image_search_routes, "find_images", blocked)
    app = web.Application()
    routes.register_routes(app)
    async with TestClient(TestServer(app)) as client:
        async def query():
            form = FormData()
            form.add_field("image", payload, filename="reference.png", content_type="image/png")
            response = await client.post("/universal_gallery/api/images/search-by-image", data=form)
            assert response.status == 200
        searches = [asyncio.create_task(query()) for _ in range(2)]
        try:
            await asyncio.to_thread(arrived.wait, 5)
            response = await asyncio.wait_for(client.get("/universal_gallery/api/images"), 1)
            assert response.status == 200
            assert not release.is_set()
        finally:
            release.set()
            await asyncio.gather(*searches)
