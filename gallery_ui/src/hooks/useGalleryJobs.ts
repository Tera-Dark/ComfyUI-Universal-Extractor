import { useEffect, useRef } from "react";
import { useOperationStatus } from "../components/shared/OperationStatusCenter";
import { useI18n } from "../i18n/I18nProvider";
import { galleryApi } from "../services/galleryApi";
import { JOB_ACTIVITY_EVENT } from "../services/jobActivity";
import type { GalleryJob } from "../types/universal-gallery";

const active = (job: GalleryJob) => ["queued", "running", "cancelling"].includes(job.state);

export const useGalleryJobs = (enabled: boolean) => {
  const { syncTask, notify } = useOperationStatus();
  const { t } = useI18n();
  const observed = useRef(new Map<string, string>());
  useEffect(() => {
    if (!enabled || typeof galleryApi.listJobs !== "function" || !syncTask) return;
    let timer: number | undefined;
    let controller: AbortController | undefined;
    let disposed = false;
    let requests = 0;
    let inFlight = false;
    let rerun = false;
    const retry = async (job: GalleryJob) => {
      if (job.kind !== "refresh_index" && job.kind !== "fingerprint_assets") return;
      const payload = Object.fromEntries(Object.entries(job.payload).filter(([key]) => !key.startsWith("_")));
      try {
        await galleryApi.createJob(job.kind, payload);
      } catch (error) {
        notify(error instanceof Error ? error.message : t("jobFailed"), "error");
      }
    };
    const poll = async () => {
      window.clearTimeout(timer);
      if (disposed || document.visibilityState === "hidden") return;
      if (inFlight) { rerun = true; return; }
      inFlight = true;
      controller = new AbortController();
      const hasObservedActive = () => [...observed.current.values()].some((signature) =>
        ["queued", "running", "cancelling"].includes(signature.split(":", 1)[0]));
      let pending = hasObservedActive();
      try {
        const response = await galleryApi.listJobs(controller.signal);
        if (disposed || controller.signal.aborted) return;
        const returned = new Set(response.jobs.map((job) => job.id));
        const missing = [...observed.current].filter(([id, signature]) => !returned.has(id)
          && ["queued", "running", "cancelling"].includes(signature.split(":", 1)[0]));
        // Recently completed jobs can fall outside the first list page. Resolve
        // previously displayed tasks explicitly, with bounded HTTP concurrency.
        if (typeof galleryApi.getJob === "function") {
          for (let offset = 0; offset < missing.length; offset += 8) {
            const extra = await Promise.all(missing.slice(offset, offset + 8).map(async ([id]) => {
              try { return (await galleryApi.getJob(id, controller!.signal)).job; }
              catch { return null; }
            }));
            if (disposed || controller.signal.aborted) return;
            response.jobs.push(...extra.filter((job): job is GalleryJob => job !== null));
          }
        }
        for (const job of response.jobs) {
          pending ||= active(job);
          const relevant = job.kind === "refresh_index" || job.kind === "fingerprint_assets";
          const previous = observed.current.get(job.id);
          if (!relevant || (!active(job) && !previous && (job.state !== "failed" || Date.now() / 1000 - job.updated_at > 86400))) continue;
          const signature = `${job.state}:${job.completed}:${job.total}:${job.error}`;
          if (previous === signature) continue;
          observed.current.set(job.id, signature);
          const label = t(job.kind === "refresh_index" ? "jobRefresh" : "jobFingerprints");
          const tone = active(job) ? "pending" : job.state === "failed" ? "error" : job.state === "succeeded" ? "success" : "info";
          syncTask(job.id, `${label} · ${t(active(job) ? "jobRunning" : job.state === "failed" ? "jobFailed" : job.state === "cancelled" ? "jobCancelled" : "jobCompleted")}`,
            tone, job.error || `${job.completed} / ${job.total}`, job.state === "failed" ? () => { void retry(job); } : undefined,
            { source: "gallery", phase: job.state, completed: job.completed, total: job.total, jobId: job.id,
              quiet: job.kind === "refresh_index",
              cancel: active(job) && job.state !== "cancelling" ? () => { void galleryApi.cancelJob(job.id).then(() => poll()).catch((error) => notify(error instanceof Error ? error.message : t("jobFailed"), "error")); } : undefined });
        }
        pending = response.jobs.some(active) || hasObservedActive();
      } catch {
        // Missing task endpoints on an older server must not break the Gallery.
      } finally {
        inFlight = false;
        if (!disposed && (pending || requests > 0 || rerun)) {
          rerun = false;
          timer = window.setTimeout(() => { void poll(); }, 2000);
        }
      }
    };
    const activity = (event: Event) => {
      requests = Math.max(0, requests + Number((event as CustomEvent<number>).detail || 0));
      void poll();
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") { controller?.abort(); window.clearTimeout(timer); }
      else void poll();
    };
    window.addEventListener(JOB_ACTIVITY_EVENT, activity);
    document.addEventListener("visibilitychange", visibility);
    timer = window.setTimeout(() => { void poll(); }, 500);
    return () => {
      disposed = true;
      controller?.abort();
      window.clearTimeout(timer);
      window.removeEventListener(JOB_ACTIVITY_EVENT, activity);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [enabled, notify, syncTask, t]);
};
