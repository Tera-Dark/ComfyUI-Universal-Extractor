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
from contextvars import ContextVar
from .environment import SOURCE_SNAPSHOT

from aiohttp import web

_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ue-gallery-service")
_SLOTS = BoundedSemaphore(16)
_UPLOAD_EXECUTOR = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ue-upload")
_UPLOAD_SLOTS = BoundedSemaphore(16)
QUERY_ONLY = ContextVar("gallery_query_only", default=False)
DEFER_INDEX_REFRESH = ContextVar("gallery_defer_index_refresh", default=False)
READ_CONNECTIONS = ContextVar("gallery_read_connections", default=None)


async def await_task(future):
    wrapped = asyncio.wrap_future(future)
    wrapped.add_done_callback(lambda done: done.exception() if not done.cancelled() else None)
    return await asyncio.shield(wrapped)


async def execute(runtime, function, *args, lane="read", **kwargs):
    slots = {"read": runtime.read_slots, "write": runtime.write_slots,
             "scan": runtime.scan_slots, "analysis": runtime.analysis_slots, "thumb": runtime.thumb_slots}[lane]
    if not slots.acquire(blocking=False):
        raise web.HTTPServiceUnavailable(text='{"error":"Gallery is busy. Retry shortly."}', content_type="application/json", headers={"Retry-After": "2"})
    def work():
        source_token = SOURCE_SNAPSHOT.set(runtime.source_snapshot() if lane == "read" else None)
        token = QUERY_ONLY.set(lane == "read")
        defer_token = DEFER_INDEX_REFRESH.set(lane == "write")
        read_connections = {} if lane == "read" else None
        read_token = READ_CONNECTIONS.set(read_connections)
        try:
            name = getattr(getattr(function, "func", function), "__name__", "")
            if lane == "write":
                runtime.require_catalog()
                if name not in {"persist_image_state", "batch_update_images", "create_gallery_board", "update_gallery_board", "delete_gallery_board", "update_board_images", "create_task", "cancel"}:
                    runtime.require_file_operations_ready()
            result = function(*args, **kwargs)
            if lane == "write" and name not in {"create_task", "cancel"}:
                runtime.require_catalog().apply([])
            if lane == "write" and runtime.env.IMAGE_INDEX_CACHE.get("built_at"):
                with runtime.env._connect_gallery_index_db() as db:
                    runtime.env._sync_image_state_to_index_db(db)
            return result
        finally:
            if read_connections:
                for connection in read_connections.values():
                    connection.close()
            READ_CONNECTIONS.reset(read_token)
            QUERY_ONLY.reset(token)
            DEFER_INDEX_REFRESH.reset(defer_token)
            SOURCE_SNAPSHOT.reset(source_token)
    executor = {"read": runtime.read_executor, "write": runtime.write_executor,
                "scan": runtime.scan_executor, "analysis": runtime.analysis_executor, "thumb": runtime.thumb_executor}[lane]
    try:
        future = executor.submit(work)
    except BaseException:
        slots.release()
        raise
    future.add_done_callback(lambda _: slots.release())
    wrapped = asyncio.wrap_future(future)
    wrapped.add_done_callback(lambda done: done.exception() if not done.cancelled() else None)
    return await asyncio.shield(wrapped)


async def run_upload_task(function, *args, runtime=None):
    slots = runtime.upload_slots if runtime else _UPLOAD_SLOTS
    executor = runtime.upload_executor if runtime else _UPLOAD_EXECUTOR
    if not slots.acquire(blocking=False):
        raise web.HTTPServiceUnavailable(headers={"Retry-After": "2"})
    try:
        future = executor.submit(function, *args)
    except BaseException:
        slots.release()
        raise
    future.add_done_callback(lambda _: slots.release())
    wrapped = asyncio.wrap_future(future)
    try:
        return await asyncio.shield(wrapped)
    except asyncio.CancelledError:
        # Cleanup must not race a write/commit that is still touching the file.
        await asyncio.shield(wrapped)
        raise


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
