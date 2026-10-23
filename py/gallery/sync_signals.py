"""Bounded, ephemeral completion hints. Hints never execute file operations.

The HTTP relay also works when Comfy Desktop and Gallery cannot share a
BroadcastChannel. A restart is repaired by baseline/freshness reconciliation.
"""
from collections import OrderedDict
from threading import RLock
import uuid
import time
import os

from aiohttp import web
from .execution import execute


class OutputSignals:
    def __init__(self, history_reader=None):
        self.lock = RLock()
        self.instance = uuid.uuid4().hex
        self.sequence = 0
        self.events = OrderedDict()
        self.history_reader = history_reader
        self.history_seen = OrderedDict()
        self.history_primed = False
        self.history_checked = 0.0

    def ingest_history(self, service):
        """Observe terminal records, including API clients with private sockets.

        Use ComfyUI's lock-owning history API and copy only compact output
        hints. Never wrap send_sync/task_done or copy workflow/model metadata.
        """
        if self.history_reader is None:
            return
        with self.lock:
            now = time.monotonic()
            if now - self.history_checked < 1:
                return
            self.history_checked = now
        try:
            history = self.history_reader(max_items=256, map_function=_history_outputs)
        except TypeError:
            # Compatibility with older ComfyUI history APIs. Keep the fallback
            # small because they may return full workflow records.
            history = {key: _history_outputs(value) for key, value in self.history_reader(max_items=32).items()}
        with self.lock:
            for prompt_id, outputs in history.items():
                if prompt_id not in self.history_seen and self.history_primed and isinstance(prompt_id, str) and 1 <= len(prompt_id) <= 200:
                    try:
                        scopes = _output_scopes(service, outputs)
                    except (ValueError, OSError):
                        scopes = []  # Unregistered custom-node paths are never scanned.
                    self.publish(prompt_id, scopes)
                self.history_seen[prompt_id] = True
            while len(self.history_seen) > 512:
                self.history_seen.popitem(last=False)
            self.history_primed = True

    def publish(self, prompt_id, scopes):
        with self.lock:
            if prompt_id not in self.events:
                self.sequence += 1
                self.events[prompt_id] = {"version": 1, "type": "outputs-changed", "prompt_id": prompt_id,
                                          "sequence": self.sequence, "scopes": scopes, "created_at": time.time()}
                while len(self.events) > 256:
                    self.events.popitem(last=False)
            return self.events[prompt_id]

    def since(self, sequence):
        with self.lock:
            return {"instance": self.instance, "sequence": self.sequence,
                    "events": [event for event in self.events.values() if event["sequence"] > sequence]}


def handlers(service):
    def publish(body):
        if not isinstance(body, dict) or set(body) - {"version", "prompt_id", "outputs"} or type(body.get("version")) is not int or body["version"] != 1:
            raise ValueError("invalid output notification")
        prompt_id = body.get("prompt_id")
        outputs = body.get("outputs", [])
        if not isinstance(prompt_id, str) or not 1 <= len(prompt_id) <= 200:
            raise ValueError("invalid prompt_id")
        if not isinstance(outputs, list) or len(outputs) > 128:
            raise ValueError("outputs must contain at most 128 entries")
        return service.get_runtime().output_signals.publish(prompt_id, _output_scopes(service, outputs))

    async def notification(request):
        body = await request.json()
        event = await execute(service.get_runtime(), publish, body)
        return web.json_response({"event": event}, headers={"Cache-Control": "no-store"})

    async def status(request):
        try:
            since = int(request.query.get("since", "0"))
        except ValueError:
            raise ValueError("invalid sequence") from None
        if not 0 <= since <= 2**53 - 1:
            raise ValueError("invalid sequence")
        def snapshot():
            signals = service.get_runtime().output_signals
            signals.ingest_history(service)
            return signals.since(since)
        return web.json_response(await execute(service.get_runtime(), snapshot), headers={"Cache-Control": "no-store"})

    return notification, status


def _history_outputs(record):
    result, seen = [], set()
    outputs = record.get("outputs", {}) if isinstance(record, dict) else {}
    if not isinstance(outputs, dict):
        return result
    for output in outputs.values():
        if not isinstance(output, dict) or not isinstance(output.get("images"), list):
            continue
        for image in output["images"]:
            if not isinstance(image, dict):
                continue
            kind, folder = image.get("type"), image.get("subfolder", "")
            if not isinstance(kind, str) or not isinstance(folder, str) or (kind, folder) in seen:
                continue
            seen.add((kind, folder))
            result.append({"type": kind, "subfolder": folder})
            if len(result) >= 32:
                return []  # One bounded full registered-source reconciliation.
    return result


def _output_scopes(service, outputs):
    scopes = set()
    for output in outputs:
        if not isinstance(output, dict):
            raise ValueError("invalid output entry")
        kind, folder = output.get("type", "output"), output.get("subfolder", "")
        if not isinstance(folder, str) or len(folder) > 2000 or kind not in {"output", "input", "temp"}:
            raise ValueError("invalid output scope")
        if kind == "temp":
            continue
        source_id = service.DEFAULT_OUTPUT_SOURCE_ID if kind == "output" else service.DEFAULT_INPUT_SOURCE_ID
        source, _, path = service.resolve_source_subfolder_path(source_id, folder)
        relative = os.path.relpath(path, service._real_abs(source["path"]))
        scopes.add(service.make_folder_ref(source_id, "" if relative == "." else relative))
    if len(scopes) > 32:
        raise ValueError("at most 32 output scopes are supported")
    return sorted(scopes)
