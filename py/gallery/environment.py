"""Explicit service bindings for domains; no domain imports the legacy facade.

The mapping adapter preserves legacy monkeypatch/export compatibility while the
host owns paths and lifecycle. New infrastructure (catalog/jobs) is owned by the
runtime, not copied into individual domain modules.
"""
from __future__ import annotations

from collections.abc import MutableMapping
from contextvars import ContextVar

SOURCE_SNAPSHOT = ContextVar("gallery_source_snapshot", default=None)


class ServiceEnvironment:
    def __init__(self, bindings: MutableMapping):
        object.__setattr__(self, "_bindings", bindings)

    def __getattr__(self, name):
        try:
            return self._bindings[name]
        except KeyError as error:
            raise AttributeError(name) from error

    def __setattr__(self, name, value):
        self._bindings[name] = value
