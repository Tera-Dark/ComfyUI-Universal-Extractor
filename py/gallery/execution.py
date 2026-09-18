"""Bounded, serialized service execution outside ComfyUI's HTTP event loop.

A disconnected HTTP client does not cancel an in-flight file mutation. The slot
is held until the worker actually finishes, not until the request disappears.
Thumbnail decoding has its own existing executor/locks.
"""
from __future__ import annotations

import asyncio
from concurrent.futures import ThreadPoolExecutor
from functools import partial
from threading import BoundedSemaphore

from aiohttp import web

_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ue-gallery-service")
_SLOTS = BoundedSemaphore(16)


async def run_gallery_task(function, *args, **kwargs):
    if not _SLOTS.acquire(blocking=False):
        raise web.HTTPServiceUnavailable(
            text='{"error":"Gallery is busy. Retry shortly."}',
            content_type="application/json",
            headers={"Retry-After": "2"},
        )
    try:
        future = _EXECUTOR.submit(partial(function, *args, **kwargs))
    except BaseException:
        _SLOTS.release()
        raise
    future.add_done_callback(lambda _: _SLOTS.release())
    wrapped = asyncio.wrap_future(future)
    # Consume a late exception even if the HTTP request was cancelled.
    wrapped.add_done_callback(lambda result: result.exception() if not result.cancelled() else None)
    return await asyncio.shield(wrapped)
