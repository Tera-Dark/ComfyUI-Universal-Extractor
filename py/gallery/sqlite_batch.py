"""Small, portable SQLite bind batches for image-index lookups.

Older SQLite builds (including some bundled Python distributions) allow only
999 bound parameters per statement. Keep every variable-length IN query below
that limit, even when a gallery holds tens of thousands of images.
"""
from __future__ import annotations

from collections.abc import Iterator, Sequence
from typing import TypeVar


T = TypeVar("T")
SQLITE_BIND_BATCH_SIZE = 900


def iter_sqlite_batches(values: Sequence[T], batch_size: int = SQLITE_BIND_BATCH_SIZE) -> Iterator[Sequence[T]]:
    if batch_size < 1 or batch_size > SQLITE_BIND_BATCH_SIZE:
        raise ValueError(f"batch_size must be between 1 and {SQLITE_BIND_BATCH_SIZE}")
    for start in range(0, len(values), batch_size):
        yield values[start:start + batch_size]
