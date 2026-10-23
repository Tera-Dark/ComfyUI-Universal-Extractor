"""Validated public task API. No caller-provided code or commands are accepted."""
from __future__ import annotations

from aiohttp import web
from .execution import execute

PUBLIC_KINDS = {"refresh_index", "fingerprint_assets"}


def handlers(service):
    def scheduler():
        return service.get_runtime().get_jobs()

    def create_task(body):
        if not isinstance(body, dict) or body.get("kind") not in PUBLIC_KINDS:
            raise ValueError("unsupported job kind")
        kind = body["kind"]
        payload = body.get("payload", {})
        if not isinstance(payload, dict):
            raise ValueError("payload must be an object")
        allowed = {"subfolder", "force"} if kind == "refresh_index" else {"subfolder", "relative_paths", "limit", "search", "category", "board_id", "date_from", "date_to", "favorites_only", "color_family", "whole_library"}
        if set(payload) - allowed:
            raise ValueError("unsupported task parameter")
        payload = dict(payload)
        for key, value in payload.items():
            if key in {"force", "favorites_only", "whole_library"}:
                if not isinstance(value, bool):
                    raise ValueError(f"{key} must be boolean")
            elif key == "limit":
                if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 2000:
                    raise ValueError("limit must be between 1 and 2000")
            elif key != "relative_paths" and (not isinstance(value, str) or len(value) > 2000):
                raise ValueError(f"invalid {key}")
        if payload.get("whole_library") and set(payload) != {"whole_library"}:
            raise ValueError("whole_library cannot be combined with scoped parameters")
        subfolder = payload.get("subfolder", "")
        if subfolder:
            source_id, relative = service.parse_folder_ref(subfolder)
            service.resolve_source_subfolder_path(source_id, relative)
        if "relative_paths" in payload:
            paths = payload["relative_paths"]
            if not isinstance(paths, list) or len(paths) > 2000 or any(not isinstance(path, str) for path in paths):
                raise ValueError("relative_paths must be an array of at most 2000 paths")
            for path in paths:
                service.resolve_image_path(path)
            payload["relative_paths"] = list(dict.fromkeys(paths))
        payload["_generation"] = service.get_runtime().require_catalog().generation()
        if kind == "refresh_index":
            payload["_output_sequence"] = service.get_runtime().output_signals.sequence
            payload["_output_instance"] = service.get_runtime().output_signals.instance
        job = service.get_runtime().enqueue_fingerprints(payload) if kind == "fingerprint_assets" else scheduler().enqueue(kind, payload)
        return web.json_response({"job": job}, status=202)

    async def create(request):
        body = await request.json()
        return await execute(service.get_runtime(), create_task, body, lane="write")

    async def listing(request):
        try:
            page, limit = int(request.query.get("page", "1")), int(request.query.get("limit", "50"))
        except ValueError:
            raise ValueError("invalid pagination") from None
        if page < 1 or not 1 <= limit <= 120:
            raise ValueError("invalid pagination")
        if "after" in request.query:
            try:
                after = int(request.query["after"])
                wait_ms = int(request.query.get("wait_ms", "15000"))
            except ValueError:
                raise ValueError("invalid task subscription") from None
            if not 0 <= after <= 2**53 - 1 or not 0 <= wait_ms <= 20000:
                raise ValueError("invalid task subscription")
            # Waiting is asynchronous: it holds no read worker or SQLite transaction.
            await scheduler().wait_for_change(after, wait_ms / 1000)
        return web.json_response(await execute(service.get_runtime(), scheduler().list, page, limit, request.query.get("active") == "true"),
                                 headers={"Cache-Control": "no-store"})

    async def get(request):
        return web.json_response({"job": await execute(service.get_runtime(), scheduler().get, request.match_info["id"])})

    async def cancel(request):
        return web.json_response({"job": await execute(service.get_runtime(), scheduler().cancel, request.match_info["id"], lane="write")})

    return create, listing, get, cancel
