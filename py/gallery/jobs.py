"""Bounded persistent local jobs. Analysis never runs on HTTP read workers."""
from __future__ import annotations

import hashlib
import json
import time
import uuid
from concurrent.futures import Future
from contextvars import ContextVar
from threading import Condition, Thread

CURRENT_JOB = ContextVar("gallery_job", default=None)
TERMINAL = {"succeeded", "failed", "cancelled"}


class JobCancelled(Exception):
    pass


class QueueFull(RuntimeError):
    pass


class JobContext:
    def __init__(self, scheduler, job_id):
        self.scheduler, self.id = scheduler, job_id

    def checkpoint(self, completed=None, total=None):
        scheduler = self.scheduler
        if scheduler.stopping:
            raise JobCancelled()
        row = scheduler.get(self.id)
        if row["cancel_requested"]:
            raise JobCancelled()
        if completed is not None:
            with scheduler.catalog.connect() as db:
                db.execute("UPDATE jobs SET completed=?,total=?,updated_at=? WHERE id=?", (completed, total or 0, time.time(), self.id))


class JobScheduler:
    def __init__(self, catalog, scan_executor, analysis_executor, handlers):
        self.catalog = catalog
        self.executors = {"scan": scan_executor, "analysis": analysis_executor}
        self.handlers = handlers
        self.condition = Condition()
        self.active = {}
        self.waiters = {}
        self.stopping = False
        with catalog.connect() as db:
            db.execute("UPDATE jobs SET state=CASE WHEN cancel_requested=1 THEN 'cancelled' ELSE 'queued' END,updated_at=? WHERE state IN ('running','cancelling')", (time.time(),))
        self.thread = Thread(target=self._dispatch, daemon=True, name="ue-job-dispatch")
        self.thread.start()

    def enqueue(self, kind, payload=None, version="1"):
        if kind not in self.handlers:
            raise ValueError("unsupported job kind")
        payload = payload or {}
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"))
        key = hashlib.sha256(f"{kind}|{version}|{encoded}".encode()).hexdigest()
        now = time.time()
        with self.condition, self.catalog.lock, self.catalog.connect() as db:
            if self.stopping:
                raise RuntimeError("gallery is stopping")
            existing = db.execute("SELECT * FROM jobs WHERE dedupe_key=? AND state IN ('queued','running','cancelling')", (key,)).fetchone()
            if existing:
                return self._public(existing)
            if db.execute("SELECT COUNT(*) FROM jobs WHERE state='queued'").fetchone()[0] >= 256:
                raise QueueFull("Gallery task queue is full. Retry shortly.")
            job_id = uuid.uuid4().hex
            db.execute("INSERT INTO jobs(id,kind,dedupe_key,payload,state,created_at,updated_at) VALUES(?,?,?,?,'queued',?,?)", (job_id, kind, key, encoded, now, now))
            db.commit()
            self.condition.notify_all()
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
        with self.catalog.connect() as db:
            total = db.execute(f"SELECT COUNT(*) FROM jobs {where}").fetchone()[0]
            rows = db.execute(f"SELECT * FROM jobs {where} ORDER BY created_at DESC,id LIMIT ? OFFSET ?", (limit, (page-1)*limit)).fetchall()
        return {"jobs": [self._public(row) for row in rows], "total": total, "page": page, "limit": limit}

    def cancel(self, job_id):
        with self.condition, self.catalog.connect() as db:
            db.execute("UPDATE jobs SET cancel_requested=1,state=CASE WHEN state='queued' THEN 'cancelled' ELSE 'cancelling' END,updated_at=? WHERE id=? AND state IN ('queued','running')", (time.time(), job_id))
            db.commit()
            self.condition.notify_all()
        self._resolve(job_id)
        return self.get(job_id)

    def future(self, job_id):
        with self.condition:
            future = self.waiters.setdefault(job_id, Future())
            self._resolve(job_id)
            return future

    def _resolve(self, job_id):
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
                    with self.catalog.connect() as db:
                        changed = db.execute("UPDATE jobs SET state='running',attempts=attempts+1,updated_at=? WHERE id=? AND state='queued'", (time.time(), row["id"])).rowcount
                    if changed:
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

    def close(self):
        with self.condition:
            self.stopping = True
            self.condition.notify_all()
        self.thread.join()


def checkpoint(completed=None, total=None):
    job = CURRENT_JOB.get()
    if job:
        job.checkpoint(completed, total)
