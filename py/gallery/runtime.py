"""Host-owned infrastructure and lifecycle for a gallery instance."""
from __future__ import annotations

import os
from concurrent.futures import ThreadPoolExecutor

from .catalog import Catalog, CatalogUnavailable
from .media import ImageProcessor


class GalleryRuntime:
    def __init__(self, env):
        self.env = env
        self.closed = False
        self.catalog_error = ""
        self.processor = ImageProcessor(lambda path: env.read_image_metadata(path), lambda path, filename: env.build_image_fingerprint(path, filename))
        self.analysis_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ue-analysis")
        self.scan_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ue-scan")
        self.read_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ue-read")
        self.write_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ue-write")
        self.upload_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ue-upload")
        self.thumb_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ue-thumb")
        self.index_initialized = set()
        try:
            self.catalog = Catalog(env.DATA_DIR)
        except CatalogUnavailable as error:
            self.catalog = None
            self.catalog_error = str(error)
        self.jobs = None

    def require_catalog(self):
        if self.catalog is None:
            raise CatalogUnavailable(self.catalog_error)
        return self.catalog

    def sync_identities(self, connection, sources):
        catalog = self.require_catalog()
        for source in sources:
            if not source.get("enabled") or not source.get("exists"):
                continue
            cursor = connection.execute("SELECT relative_path,source_relative_path,size,modified_at,asset_id,content_revision FROM gallery_images WHERE source_id=?", (source["id"],))
            while rows := cursor.fetchmany(500):
                records = []
                for row in rows:
                    # First registration uses the existing index, without decoding
                    # or hashing the originals. Nanosecond stat is opportunistic.
                    try:
                        stat = os.stat(os.path.join(source["path"], row["source_relative_path"]))
                        records.append((row["source_relative_path"], stat.st_size, stat.st_mtime_ns))
                    except OSError:
                        records.append((row["source_relative_path"], row["size"], int(row["modified_at"]) * 1_000_000_000))
                identities = catalog.observe_many(source, records)
                changed = [(identity["asset_id"], identity["content_revision"], row["relative_path"]) for row, identity in zip(rows, identities) if row["asset_id"] != identity["asset_id"] or row["content_revision"] != identity["content_revision"]]
                if changed:
                    connection.executemany("UPDATE gallery_images SET asset_id=?,content_revision=? WHERE relative_path=?", changed)

    def close(self):
        if self.closed:
            return
        self.closed = True
        if self.jobs:
            self.jobs.close()
        for executor in (self.scan_executor, self.analysis_executor, self.thumb_executor, self.read_executor, self.write_executor, self.upload_executor):
            executor.shutdown(wait=True, cancel_futures=True)
