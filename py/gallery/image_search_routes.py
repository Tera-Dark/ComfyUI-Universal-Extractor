"""Bounded reference upload for local image retrieval; no uploaded file is persisted."""
from aiohttp import web

from .execution import execute
from .image_search import describe_upload, find_images

MAX_REFERENCE_BYTES = 20 * 1024 * 1024


def handler(env):
    async def search(request):
        runtime = env.get_runtime()
        if not runtime.image_search_sessions.acquire(blocking=False):
            raise web.HTTPServiceUnavailable(headers={"Retry-After": "2"})
        try:
            if request.content_length and request.content_length > MAX_REFERENCE_BYTES + 65536:
                raise web.HTTPRequestEntityTooLarge(max_size=MAX_REFERENCE_BYTES, actual_size=request.content_length)
            try:
                minimum = int(request.query.get("minimum", "70"))
                if not 55 <= minimum <= 95:
                    raise ValueError("minimum must be between 55 and 95")
                reader = await request.multipart()
                data = bytearray()
                count, received = 0, 0
                while True:
                    part = await reader.next()
                    if part is None:
                        break
                    count += 1
                    if count > 1 or part.name != "image" or not part.filename:
                        raise ValueError("Submit exactly one image file")
                    while True:
                        chunk = await part.read_chunk()
                        if not chunk:
                            break
                        received += len(chunk)
                        if received > MAX_REFERENCE_BYTES:
                            raise web.HTTPRequestEntityTooLarge(max_size=MAX_REFERENCE_BYTES, actual_size=received)
                        data.extend(chunk)
                if not data:
                    raise ValueError("Reference image is required")
                descriptor = await execute(runtime, describe_upload, data, lane="analysis")
                await runtime.prepare_index()
                result = await execute(runtime, find_images, runtime.env, descriptor, minimum, lane="analysis")
                if result["pending"]:
                    result["job"] = runtime.enqueue_fingerprints({"whole_library": True})
                return web.json_response(result)
            except (ValueError, AssertionError) as error:
                return web.json_response({"error": str(error)}, status=400)
        finally:
            runtime.image_search_sessions.release()
    return search
