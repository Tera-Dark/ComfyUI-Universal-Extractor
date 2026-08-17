from __future__ import annotations

try:
    from PIL import Image

    HAS_PIL = True
except ImportError:
    HAS_PIL = False
    print("[Universal Extractor] Warning: Pillow not found, metadata extraction disabled.")

from .image_safety import DecompressionBombError, guarded_image_open


def read_image_metadata(image_path: str) -> dict:
    if not HAS_PIL:
        return {}

    try:
        import json

        with guarded_image_open(image_path) as image:
            info = image.info or {}
            metadata = {}
            for key in ("prompt", "workflow"):
                if key in info:
                    try:
                        metadata[key] = json.loads(info[key])
                    except Exception:
                        metadata[key] = info[key]
            return metadata
    except DecompressionBombError as error:
        print(f"[Universal Extractor] metadata skipped ({image_path}): {error}")
        return {}
    except Exception as error:
        print(f"[Universal Extractor] metadata read error ({image_path}): {error}")
        return {}
