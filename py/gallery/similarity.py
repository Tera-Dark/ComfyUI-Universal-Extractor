"""Exact-radius Hamming candidates using disjoint bands (no false negatives).

For distance d, d+1 bands ensure at least one equal band. Degenerate hashes can
still be quadratic; the service's scan cap remains the hard resource boundary.
"""
from collections import defaultdict


def near_hash_pairs(values: list[str], distance: int):
    if not 0 <= distance < 64:
        raise ValueError("distance must be between 0 and 63")
    bands = distance + 1
    indexes = [defaultdict(list) for _ in range(bands)]
    parsed: list[int | None] = []
    for right, raw in enumerate(values):
        try:
            number = int(raw, 16)
            if not raw or not 0 <= number < (1 << 64):
                raise ValueError("invalid hash")
        except (ValueError, TypeError):
            parsed.append(None)
            continue
        candidates = set()
        keys = []
        for band in range(bands):
            start = 64 * band // bands
            width = 64 * (band + 1) // bands - start
            key = (number >> start) & ((1 << width) - 1)
            keys.append(key)
            candidates.update(indexes[band][key])
        for left in sorted(candidates):
            previous = parsed[left]
            if previous is not None and (previous ^ number).bit_count() <= distance:
                yield left, right
        for band, key in enumerate(keys):
            indexes[band][key].append(right)
        parsed.append(number)
