"""Bounded persistent local jobs. Analysis never runs on HTTP read workers."""
from __future__ import annotations

import hashlib
import json
import time
import uuid
import asyncio
from concurrent.futures import Future
from contextvars import ContextVar
from threading import Condition, Thread

CURRENT_JOB = ContextVar("gallery_job", default=None)
TERMINAL = {"succeeded", "failed", "cancelled"}


class JobCancelled(Exception):
    pass


class QueueFull(RuntimeError):
    pass


def _dedupe_key(kind, payload, version):
    # A scan validates the generation captured at execution, not enqueue time.
    relevant = {k: v for k, v in payload.items() if kind != "refresh_index" or k != "_generation"}
    if kind == "refresh_index":
        relevant.setdefault("_output_sequence", 0)
        relevant.setdefault("_output_instance", "")
    encoded = json.dumps(relevant, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(f"{kind}|{version}|{encoded}".encode()).hexdigest()


class JobContext:
    def __init__(self, scheduler, job_id):
        self.scheduler, self.id = scheduler, job_id
        self.last_checked = 0.0

    def checkpoint(self, completed=None, total=None):
        scheduler = self.scheduler
        if scheduler.stopping:
            raise JobCancelled()
        now = time.monotonic()
        if completed is None and now - self.last_checked < .25:
            return
        self.last_checked = now
        row = scheduler.get(self.id)
        if row["cancel_requested"]:
            raise JobCancelled()
        if completed is not None:
            with scheduler.catalog.connect() as db:
                db.execute("UPDATE jobs SET completed=?,total=?,updated_at=? WHERE id=?", (completed, total or 0, time.time(), self.id))
            scheduler.changed()


class JobScheduler:
    def __init__(self, catalog, scan_executor, analysis_executor, handlers):
        self.catalog = catalog
        self.executors = {"scan": scan_executor, "analysis": analysis_executor}
        self.handlers = handlers
        self.condition = Condition()
        self.active = {}
        self.waiters = {}
        self.stopping = False
        self.change_version = 0
        self.change_waiters = set()
        with catalog.connect() as db:
            db.execute("UPDATE jobs SET state=CASE WHEN cancel_requested=1 THEN 'cancelled' ELSE 'queued' END,updated_at=? WHERE state IN ('running','cancelling')", (time.time(),))
            # Older clients could persist one refresh per file mutation. Keep
            # their records as superseded evidence, but replay only the newest
            # equivalent request after restart. File-operation journals and
            # versioned analysis jobs are never consolidated here.
            keepers = {}
            for row in db.execute("SELECT * FROM jobs WHERE kind='refresh_index' AND state='queued' ORDER BY created_at DESC,id DESC").fetchall():
                try:
                    payload = json.loads(row["payload"])
                    key = _dedupe_key("refresh_index", payload, payload.get("_processor_version", "1"))
                except (ValueError, TypeError, AttributeError):
                    continue  # The normal dispatcher reports malformed stored work.
                if key in keepers:
                    db.execute("UPDATE jobs SET state='cancelled',error='',result=?,updated_at=? WHERE id=?", (json.dumps({"superseded_by": keepers[key]}), time.time(), row["id"]))
                else:
                    keepers[key] = row["id"]
            for key, job_id in keepers.items():
                db.execute("UPDATE jobs SET dedupe_key=? WHERE id=?", (key, job_id))
        self.thread = Thread(target=self._dispatch, daemon=True, name="ue-job-dispatch")
        self.thread.start()

    def changed(self):
        with self.condition:
            self.change_version += 1
            waiters = list(self.change_waiters)
            self.change_waiters.clear()
        for loop, future in waiters:
            def wake(target=future):
                if not target.done():
                    target.set_result(None)
            try:
                loop.call_soon_threadsafe(wake)
            except RuntimeError:
                pass  # A disconnected event loop owns its cancelled waiter.

    async def wait_for_change(self, version, timeout):
        loop = asyncio.get_running_loop()
        future = loop.create_future()
        waiter = (loop, future)
        with self.condition:
            if version != self.change_version or self.stopping:
                return
            if len(self.change_waiters) >= 32:
                raise QueueFull("Too many task subscriptions. Retry shortly.")
            self.change_waiters.add(waiter)
        try:
            await asyncio.wait_for(future, timeout)
        except asyncio.TimeoutError:
            pass
        finally:
            with self.condition:
                self.change_waiters.discard(waiter)

    def enqueue(self, kind, payload=None, version="1"):
        if kind not in self.handlers:
            raise ValueError("unsupported job kind")
        payload = {**(payload or {}), "_processor_version": str(version)}
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        # A scan takes its generation when it starts and validates at commit.
        # File mutations must not turn identical refresh requests into hundreds
        # of queued scans. Analysis still deduplicates by resource version.
        key = _dedupe_key(kind, payload, version)
        now = time.time()
        with self.condition, self.catalog.lock, self.catalog.connect() as db:
            if self.stopping:
                raise RuntimeError("gallery is stopping")
            existing = db.execute("SELECT * FROM jobs WHERE dedupe_key=? AND state IN ('queued','running','cancelling')", (key,)).fetchone()
            refresh_fields = {"subfolder", "force", "_generation", "_processor_version", "_folder_snapshot", "_output_sequence", "_output_instance"}
            if existing is None and kind == "refresh_index" and not set(payload) - refresh_fields:
                from .refs import parse_folder_ref
                scope = payload.get("subfolder", "")
                source, relative = parse_folder_ref(scope)
                for candidate in db.execute("SELECT * FROM jobs WHERE kind='refresh_index' AND state IN ('queued','running') ORDER BY created_at,id"):
                    other = json.loads(candidate["payload"])
                    if set(other) - refresh_fields or other.get("_folder_snapshot") != payload.get("_folder_snapshot"):
                        continue
                    other_scope = other.get("subfolder", "")
                    other_source, other_relative = parse_folder_ref(other_scope)
                    covers = not other_scope or (source == other_source and (not other_relative or relative == other_relative or relative.startswith(other_relative + "/")))
                    if covers and (other.get("force", True) or not payload.get("force", True)):
                        requested_sequence = payload.get("_output_sequence", 0)
                        if other.get("_output_instance", "") != payload.get("_output_instance", "") or other.get("_output_sequence", 0) < requested_sequence:
                            if candidate["state"] == "running":
                                continue  # It may already have visited the new output's folder.
                            other["_output_sequence"] = requested_sequence
                            other["_output_instance"] = payload.get("_output_instance", "")
                            upgraded_key = _dedupe_key(kind, other, other.get("_processor_version", "1"))
                            db.execute("UPDATE jobs SET payload=?,dedupe_key=? WHERE id=?", (json.dumps(other), upgraded_key, candidate["id"]))
                            db.commit()
                            return self.get(candidate["id"])
                        existing = candidate
                        break
            if existing:
                return self._public(existing)
            if kind in {"colors", "dimensions"}:
                for queued in db.execute("SELECT * FROM jobs WHERE kind=? AND state='queued' ORDER BY created_at,id", (kind,)):
                    previous = json.loads(queued["payload"])
                    if (previous.get("_signature"), previous.get("_processor_version")) == (payload.get("_signature"), payload.get("_processor_version")):
                        # A running backfill can need one follow-up for newly
                        # indexed files; repeated refreshes update that queued
                        # follow-up instead of creating a whole-library backlog.
                        db.execute("UPDATE jobs SET payload=?,dedupe_key=?,updated_at=? WHERE id=?", (encoded, key, now, queued["id"]))
                        db.commit()
                        self.condition.notify_all()
                        self.changed()
                        return self.get(queued["id"])
            if db.execute("SELECT COUNT(*) FROM jobs WHERE state='queued'").fetchone()[0] >= 256:
                raise QueueFull("Gallery task queue is full. Retry shortly.")
            job_id = uuid.uuid4().hex
            db.execute("INSERT INTO jobs(id,kind,dedupe_key,payload,state,created_at,updated_at) VALUES(?,?,?,?,'queued',?,?)", (job_id, kind, key, encoded, now, now))
            db.commit()
            self.condition.notify_all()
            self.changed()
        return self.get(job_id)

    @staticmethod
    def _public(row):
        result = dict(row)
        result.pop("dedupe_key", None)
        result["payload"] = json.loads(result["payload"])
        result["result"] = json.loads(result["result"]) if result["result"] else None
        return result

    def get(self, job_id):
        with self.catalog.connect() as db:
            row = db.execute("SELECT * FROM jobs WHERE id=?", (job_id,)).fetchone()
        if row is None:
            raise FileNotFoundError("job not found")
        return self._public(row)

    def list(self, page=1, limit=50, active_only=False):
        where = "WHERE state IN ('queued','running','cancelling')" if active_only else ""
        with self.condition, self.catalog.connect() as db:
            total = db.execute(f"SELECT COUNT(*) FROM jobs {where}").fetchone()[0]
            rows = db.execute(f"SELECT * FROM jobs {where} ORDER BY CASE WHEN state IN ('queued','running','cancelling') THEN 0 ELSE 1 END,created_at DESC,id LIMIT ? OFFSET ?", (limit, (page-1)*limit)).fetchall()
            version = self.change_version
        return {"jobs": [self._public(row) for row in rows], "total": total, "page": page, "limit": limit, "revision": version}

    def cancel(self, job_id):
        with self.condition, self.catalog.connect() as db:
            db.execute("UPDATE jobs SET cancel_requested=1,state=CASE WHEN state='queued' THEN 'cancelled' ELSE 'cancelling' END,updated_at=? WHERE id=? AND state IN ('queued','running')", (time.time(), job_id))
            db.commit()
            self.condition.notify_all()
        self._resolve(job_id)
        self.changed()
        return self.get(job_id)

    def future(self, job_id):
        with self.condition:
            future = self.waiters.setdefault(job_id, Future())
            self._resolve(job_id)
            return future

    def _resolve(self, job_id):
        with self.condition:
            future = self.waiters.get(job_id)
            if future is None or future.done():
                return
            job = self.get(job_id)
            if job["state"] == "succeeded":
                future.set_result(job["result"])
                self.waiters.pop(job_id, None)
            elif job["state"] in {"failed", "cancelled"}:
                future.set_exception(RuntimeError(job["error"] or f"Task {job['state']}"))
                self.waiters.pop(job_id, None)

    def _dispatch(self):
        while True:
            with self.condition:
                if self.stopping:
                    return
                with self.catalog.connect() as db:
                    rows = db.execute("SELECT * FROM jobs WHERE state='queued' AND retry_at<=? ORDER BY created_at,id", (time.time(),)).fetchall()
                for row in rows:
                    lane, _handler = self.handlers.get(row["kind"], (None, None))
                    if lane is None:
                        with self.catalog.connect() as db:
                            db.execute("UPDATE jobs SET state='failed',error='unsupported stored task',updated_at=? WHERE id=?", (time.time(), row["id"]))
                        continue
                    capacity = 1 if lane == "scan" else 2
                    if sum(value == lane for value in self.active.values()) >= capacity:
                        continue
                    if row["kind"] in {"colors", "dimensions"}:
                        with self.catalog.connect() as db:
                            if db.execute("SELECT 1 FROM jobs WHERE kind=? AND state IN ('running','cancelling') LIMIT 1", (row["kind"],)).fetchone():
                                continue
                    with self.catalog.connect() as db:
                        changed = db.execute("UPDATE jobs SET state='running',attempts=attempts+1,updated_at=? WHERE id=? AND state='queued'", (time.time(), row["id"])).rowcount
                    if changed:
                        self.changed()
                        self.active[row["id"]] = lane
                        self.executors[lane].submit(self._run, row["id"])
                self.condition.wait(.25)

    def _run(self, job_id):
        context = JobContext(self, job_id)
        token = CURRENT_JOB.set(context)
        try:
            job = self.get(job_id)
            context.checkpoint()
            result = self.handlers[job["kind"]][1](context, job["payload"])
            context.last_checked = 0.0
            context.checkpoint()
            self._finish(job_id, "succeeded", result=result)
        except JobCancelled:
            self._finish(job_id, "queued" if self.stopping else "cancelled")
        except Exception as error:
            job = self.get(job_id)
            retry = isinstance(error, OSError) and not isinstance(error, (PermissionError, FileNotFoundError)) and job["attempts"] < 3
            self._finish(job_id, "queued" if retry else "failed", error=str(error), retry_at=time.time() + (2 if job["attempts"] == 1 else 10) if retry else 0)
        finally:
            CURRENT_JOB.reset(token)
            with self.condition:
                self.active.pop(job_id, None)
                self._resolve(job_id)
                self.condition.notify_all()

    def _finish(self, job_id, state, result=None, error="", retry_at=0):
        with self.catalog.connect() as db:
            db.execute("UPDATE jobs SET state=?,result=?,error=?,updated_at=?,retry_at=? WHERE id=?", (state, json.dumps(result) if result is not None else None, error[:2000], time.time(), retry_at, job_id))
        self.changed()

    def close(self):
        with self.condition:
            self.stopping = True
            self.condition.notify_all()
        self.changed()
        self.thread.join()


def checkpoint(completed=None, total=None):
    job = CURRENT_JOB.get()
    if job:
        job.checkpoint(completed, total)
