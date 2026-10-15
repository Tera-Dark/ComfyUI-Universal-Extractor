"""Media provider contract. Only image support is installed in this release."""
from __future__ import annotations

from typing import Protocol

from .image_safety import guarded_image_open
from .metadata import read_image_metadata
from .variant_fingerprints import build_image_fingerprint


class MediaProcessor(Protocol):
    media_type: str
    version: str
    def probe(self, path: str) -> dict: ...
    def extract_metadata(self, path: str) -> dict: ...
    def build_preview(self, path: str, destination: str, size: int) -> None: ...
    def build_fingerprints(self, path: str, filename: str) -> dict: ...


class ImageProcessor:
    media_type = "image"
    version = "1"

    def __init__(self, metadata_reader=read_image_metadata, fingerprint_builder=build_image_fingerprint):
        self.metadata_reader = metadata_reader
        self.fingerprint_builder = fingerprint_builder

    def probe(self, path):
        with guarded_image_open(path) as image:
            return {"width": image.width, "height": image.height}

    def extract_metadata(self, path):
        return self.metadata_reader(path)

    def build_preview(self, path, destination, size):
        with guarded_image_open(path) as image:
            converted = image.convert("RGB")
            try:
                converted.thumbnail((size, size))
                converted.save(destination, "WEBP", quality=80, method=2)
            finally:
                converted.close()

    def build_fingerprints(self, path, filename):
        return self.fingerprint_builder(path, filename)
