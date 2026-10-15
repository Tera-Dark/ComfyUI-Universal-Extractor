"""Host-owned infrastructure and lifecycle for a gallery instance."""
from __future__ import annotations

import os
import json
import time
from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor
from threading import RLock
from threading import BoundedSemaphore

from .jobs import JobScheduler, checkpoint, CURRENT_JOB

from .catalog import Catalog, CatalogUnavailable
from .media import ImageProcessor


class GalleryRuntime:
    def __init__(self, env):
        self.env = env
        self.closed = False
        self.closing = False
        self.catalog_error = ""
        self.processor = ImageProcessor(lambda path: env.read_image_metadata(path), lambda path, filename: env.build_image_fingerprint(path, filename))
        self.analysis_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ue-analysis")
        self.scan_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ue-scan")
        self.read_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ue-read")
        self.write_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ue-write")
        self.upload_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ue-upload")
        self.thumb_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="ue-thumb")
        self.index_initialized = set()
        self.index_anchor = None
        self.jobs_lock = RLock()
        self.scan_sync_lock = RLock()
        self.read_slots = BoundedSemaphore(32)
        self.write_slots = BoundedSemaphore(16)
        self.scan_slots = BoundedSemaphore(16)
        self.analysis_slots = BoundedSemaphore(16)
        self.thumb_slots = BoundedSemaphore(32)
        self.upload_slots = BoundedSemaphore(16)
        self.upload_sessions = BoundedSemaphore(2)
        try:
            self.catalog = Catalog(env.DATA_DIR)
        except CatalogUnavailable as error:
            self.catalog = None
            self.catalog_error = str(error)
        self.jobs = None

    def get_jobs(self):
        with self.jobs_lock:
            if self.jobs is None:
                self.jobs = JobScheduler(self.require_catalog(), self.scan_executor, self.analysis_executor, {
                    "refresh_index": ("scan", self._refresh),
                    "fingerprint_assets": ("analysis", self._fingerprints),
                    "colors": ("analysis", lambda ctx, payload: self._derive(ctx, "colors")),
                    "dimensions": ("analysis", lambda ctx, payload: self._derive(ctx, "dimensions")),
                })
            return self.jobs

    def _refresh(self, context, payload):
        context.scan_generation = self.require_catalog().generation()
        context.checkpoint(0, 1)
        self.env.ensure_image_index_db_current(force_refresh=payload.get("force", True), scope=payload.get("subfolder", ""))
        with self.env._connect_gallery_index_db() as db:
            folders_ready = self.env._index_meta_get(db, "folder_snapshot_version") == "1"
        if not folders_ready:
            # Upgrade can serve existing image rows first; discover empty
            # directories in the scan lane without blocking the first response.
            self.get_jobs().enqueue("refresh_index", {"force": True, "subfolder": "", "_folder_snapshot": True,
                                                      "_generation": self.require_catalog().generation()})
        sources = self.env.list_gallery_sources()
        signature = self.env._source_signature(sources)
        self.env._schedule_dimension_backfill(sources, signature)
        self.env._schedule_color_index_backfill(sources, signature)
        context.checkpoint(1, 1)
        return {"ok": True}

    @contextmanager
    def scan_commit(self):
        with self.env.FILE_OPERATION_LOCK:
            context = CURRENT_JOB.get()
            expected = getattr(context, "scan_generation", None)
            if expected is not None and self.require_catalog().generation() != expected:
                raise OSError("Source changed during scan; retrying from a fresh snapshot")
            yield

    async def prepare_index(self, scope="", force=False):
        import asyncio
        from .execution import await_task, execute
        env = self.env
        def ready():
            sources = env.list_gallery_sources()
            signature = env._source_signature(sources)
            return (env.IMAGE_INDEX_CACHE.get("signature") == signature
                    and not env.IMAGE_INDEX_CACHE.get("dirty") and os.path.exists(env.GALLERY_INDEX_DB_FILE))
        if not force and await execute(self, ready):
            return
        if self.catalog is None:
            # Already committed index remains readable in catalog failure mode.
            if os.path.exists(env.GALLERY_INDEX_DB_FILE):
                def prepare_derived_schema():
                    with env._connect_gallery_index_db():
                        pass
                await execute(self, prepare_derived_schema, lane="scan")
                return
            self.require_catalog()
        job = self.get_jobs().enqueue("refresh_index", {"subfolder": scope, "force": force, "_generation": self.catalog.generation()})
        await await_task(self.get_jobs().future(job["id"]))

    def _fingerprints(self, context, payload):
        if not self.env.IMAGE_INDEX_CACHE.get("built_at"):
            job = self.get_jobs().enqueue("refresh_index", {"force": False, "subfolder": payload.get("subfolder", "")})
            future = self.get_jobs().future(job["id"])
            while not future.done():
                context.checkpoint()
                try:
                    future.result(.2)
                except TimeoutError:
                    pass
            future.result()
        options = {key: value for key, value in payload.items() if not key.startswith("_")}
        context.checkpoint(0, 1)
        result = self.env.prewarm_image_fingerprints(**options)
        context.checkpoint(result.get("completed", 0), result.get("queued", 0))
        return result

    def enqueue_fingerprints(self, options):
        built = ""
        if os.path.exists(self.env.GALLERY_INDEX_DB_FILE):
            with self.env._connect_gallery_index_db() as db:
                built = self.env._index_meta_get(db, "built_at")
        return self.get_jobs().enqueue("fingerprint_assets", {**options, "_index_version": built,
            "_generation": self.require_catalog().generation()}, version=self.env.FINGERPRINT_VERSION)

    def _derive(self, context, kind):
        env = self.env
        flag = "COLOR_INDEX_BACKFILL_RUNNING" if kind == "colors" else "DIMENSION_BACKFILL_RUNNING"
        setattr(env, flag, True)
        last, completed, failed = "", 0, 0
        diagnostics = []
        condition = "(dominant_color='' OR color_family_scores_json='{}')" if kind == "colors" else "(image_width<=0 OR image_height<=0)"
        try:
            with env._connect_gallery_index_db() as db:
                total = db.execute(f"SELECT COUNT(*) FROM gallery_images WHERE {condition}").fetchone()[0]
            while True:
                context.checkpoint(completed + failed, total)
                with env._connect_gallery_index_db() as db:
                    rows = db.execute(f"SELECT * FROM gallery_images WHERE {condition} AND relative_path>? ORDER BY relative_path LIMIT 100", (last,)).fetchall()
                if not rows:
                    break
                for row in rows:
                    context.checkpoint()
                    last = row["relative_path"]
                    try:
                        _, path = env.resolve_image_path(last)
                        observed = os.stat(path)
                        if kind == "colors":
                            profile = env._extract_image_color_profile(path, last)
                            if not profile.get("dominant_color"):
                                raise ValueError("Image color analysis failed or exceeded the decode safety limit")
                        else:
                            width, height = env._read_image_dimensions(path)
                            if not width or not height:
                                raise ValueError("Image dimensions unavailable or exceeded the decode safety limit")
                        current = os.stat(path)
                        if (observed.st_size, observed.st_mtime_ns) != (current.st_size, current.st_mtime_ns):
                            continue
                        with env.FILE_OPERATION_LOCK, env._connect_gallery_index_db() as db:
                            identity = self.catalog.get(row["asset_id"]) if row["asset_id"] else None
                            if identity and (identity["availability"] != "online" or identity["content_revision"] != row["content_revision"] or identity["relative_path"] != row["source_relative_path"] or identity["source_id"] != row["source_id"]):
                                continue
                            if kind == "colors":
                                db.execute("UPDATE gallery_images SET dominant_color=?,color_family=?,color_families_text=?,color_family_scores_json=?,palette_json=?,color_saturation=?,color_luma=? WHERE relative_path=? AND content_revision=? AND asset_id=?", (*[profile[key] for key in ("dominant_color", "color_family", "color_families_text", "color_family_scores_json", "palette_json", "color_saturation", "color_luma")], last, row["content_revision"], row["asset_id"]))
                                updated = db.execute("SELECT * FROM gallery_images WHERE relative_path=?", (last,)).fetchall()
                                env._sync_auxiliary_rows(db, updated)
                            else:
                                db.execute("UPDATE gallery_images SET image_width=?,image_height=? WHERE relative_path=? AND content_revision=? AND asset_id=?", (width, height, last, row["content_revision"], row["asset_id"]))
                        completed += 1
                    except (FileNotFoundError, ValueError, PermissionError) as error:
                        failed += 1
                        if len(diagnostics) < 50:
                            diagnostics.append({"asset_id": row["asset_id"], "relative_path": last, "error": str(error)})
                        continue
            with env._connect_gallery_index_db() as db:
                env._index_meta_set(db, "color_index_version" if kind == "colors" else "dimension_index_version", env.COLOR_INDEX_VERSION if kind == "colors" else env.DIMENSION_INDEX_VERSION)
            context.checkpoint(completed + failed, total)
            return {"completed": completed, "failed": failed, "diagnostics": diagnostics, "total": total}
        finally:
            setattr(env, flag, False)

    def require_catalog(self):
        if self.catalog is None:
            raise CatalogUnavailable(self.catalog_error)
        return self.catalog

    def require_file_operations_ready(self):
        with self.env.FILE_OPERATION_LOCK:
            self.env.execute_moves([], os.path.join(self.env.DATA_DIR, "operation_journal"),
                                   lambda: None, lambda: None, {})

    def sync_identities(self, connection, sources, dimensions_current=()):
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
                content_changed = [row["relative_path"] for row, identity in zip(rows, identities)
                                   if row["asset_id"] and row["content_revision"] != identity["content_revision"]]
                if content_changed:
                    connection.executemany("UPDATE gallery_images SET dominant_color='',color_family='',color_families_text='',color_family_scores_json='{}',palette_json='[]',color_saturation=0,color_luma=0 WHERE relative_path=?", [(path,) for path in content_changed])
                    connection.executemany("UPDATE gallery_images SET image_width=0,image_height=0 WHERE relative_path=?", [(path,) for path in content_changed if path not in dimensions_current])
                    placeholders = ",".join("?" for _ in content_changed)
                    refreshed = connection.execute(f"SELECT * FROM gallery_images WHERE relative_path IN ({placeholders})", content_changed).fetchall()
                    self.env._sync_auxiliary_rows(connection, refreshed)

    def close(self):
        if self.closed or self.closing:
            return
        # Existing workers may still access the facade while draining. Keep this
        # runtime available until every worker has stopped, then close storage.
        self.closing = True
        if self.jobs:
            self.jobs.close()
        for executor in (self.scan_executor, self.analysis_executor, self.thumb_executor, self.read_executor, self.write_executor, self.upload_executor):
            executor.shutdown(wait=True, cancel_futures=True)
        self.release_index_anchor()
        if self.catalog:
            self.catalog.close()
        self.closed = True

    def release_index_anchor(self):
        if self.index_anchor:
            self.index_anchor.close()
            self.index_anchor = None
        self.index_initialized.clear()
