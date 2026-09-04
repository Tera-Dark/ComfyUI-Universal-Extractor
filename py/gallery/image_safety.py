from __future__ import annotations

import os
import warnings
from contextlib import contextmanager
from typing import Any, Iterator

try:
    from PIL import Image
    from PIL.Image import DecompressionBombError, DecompressionBombWarning

    HAS_PIL = True
except ImportError:
    Image = None  # type: ignore[assignment]
    HAS_PIL = False

    class DecompressionBombError(Exception):
        pass

    class DecompressionBombWarning(RuntimeWarning):
        pass


ENV_MAX_IMAGE_PIXELS = "UNIVERSAL_EXTRACTOR_MAX_IMAGE_PIXELS"
DEFAULT_MAX_IMAGE_PIXELS = 160_000_000


def configured_max_image_pixels() -> int | None:
    raw_value = os.environ.get(ENV_MAX_IMAGE_PIXELS)
    if raw_value is None:
        return DEFAULT_MAX_IMAGE_PIXELS

    normalized = raw_value.strip()
    if not normalized or normalized == "0":
        return None

    try:
        value = int(normalized)
    except ValueError:
        return DEFAULT_MAX_IMAGE_PIXELS
    return max(1, value)


def apply_image_pixel_limit() -> None:
    if Image is None:
        return
    pixel_limit = configured_max_image_pixels()
    if pixel_limit is not None:
        Image.MAX_IMAGE_PIXELS = pixel_limit


@contextmanager
def guarded_image_open(path: str) -> Iterator:
    if Image is None:
        raise RuntimeError("Pillow is required for image decoding")

    apply_image_pixel_limit()
    with warnings.catch_warnings():
        warnings.simplefilter("error", DecompressionBombWarning)
        with Image.open(path) as image:
            yield image


def extract_rgba_pixels(image: Any) -> list[tuple[int, int, int, int]]:
    """Safely extract RGBA tuples from an RGBA Pillow image across Pillow 10-14+."""
    if hasattr(image, "get_flattened_data"):
        try:
            flat = list(image.get_flattened_data())
            return [(flat[i], flat[i + 1], flat[i + 2], flat[i + 3]) for i in range(0, len(flat), 4)]
        except Exception:
            pass
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", category=DeprecationWarning)
        return list(image.getdata())


def extract_grayscale_pixels(image: Any) -> list[int]:
    """Safely extract integer grayscale pixels from a 1-channel 'L' Pillow image across Pillow 10-14+."""
    if hasattr(image, "get_flattened_data"):
        try:
            return [int(val) for val in image.get_flattened_data()]
        except Exception:
            pass
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", category=DeprecationWarning)
        return [int(val) for val in image.getdata()]

