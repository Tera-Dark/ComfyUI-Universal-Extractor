import { useEffect, useRef } from "react";
import { useOperationStatus } from "../components/shared/OperationStatusCenter";
import { useI18n } from "../i18n/I18nProvider";
import { galleryApi } from "../services/galleryApi";
import { refreshGalleryJobs, subscribeGalleryJobs } from "../services/galleryJobMonitor";
import type { GalleryJob } from "../types/universal-gallery";

const active = (job: GalleryJob) => ["queued", "running", "cancelling"].includes(job.state);

export const useGalleryJobs = (enabled: boolean) => {
  const { syncTask, notify } = useOperationStatus();
  const { t } = useI18n();
  const observed = useRef(new Map<string, string>());
  useEffect(() => {
    if (!enabled || typeof galleryApi.listJobs !== "function" || !syncTask) return;
    const retry = async (job: GalleryJob) => {
      if (job.kind !== "refresh_index" && job.kind !== "fingerprint_assets") return;
      const payload = Object.fromEntries(Object.entries(job.payload).filter(([key]) => !key.startsWith("_")));
      try {
        await galleryApi.createJob(job.kind, payload);
        void refreshGalleryJobs();
      } catch (error) {
        notify(error instanceof Error ? error.message : t("jobFailed"), "error");
      }
    };
    return subscribeGalleryJobs((jobs) => {
        const latestRefresh = new Map<string, GalleryJob>();
        for (const job of jobs) {
          if (job.kind !== "refresh_index") continue;
          const scope = String(job.payload.subfolder ?? "");
          const latest = latestRefresh.get(scope);
          if (!latest || Number(active(job)) > Number(active(latest)) || active(job) === active(latest) && (job.created_at > latest.created_at || job.created_at === latest.created_at && job.id > latest.id)) latestRefresh.set(scope, job);
        }
        for (const job of jobs) {
          const relevant = job.kind === "refresh_index" || job.kind === "fingerprint_assets";
          const previous = observed.current.get(job.id);
          if (!relevant || (!active(job) && !previous && (job.state !== "failed" || Date.now() / 1000 - job.updated_at > 86400))) continue;
          const signature = `${job.state}:${job.completed}:${job.total}:${job.error}`;
          if (previous === signature) continue;
          observed.current.set(job.id, signature);
          const scope = String(job.payload.subfolder ?? "");
          if (job.kind === "refresh_index" && latestRefresh.get(scope)?.id !== job.id) continue;
          const label = t(job.kind === "refresh_index" ? "jobRefresh" : "jobFingerprints");
          const tone = active(job) ? "pending" : job.state === "failed" ? "error" : job.state === "succeeded" ? "success" : "info";
          syncTask(job.kind === "refresh_index" ? `refresh:${scope}` : job.id, `${label} · ${t(active(job) ? "jobRunning" : job.state === "failed" ? "jobFailed" : job.state === "cancelled" ? "jobCancelled" : "jobCompleted")}`,
            tone, job.error || `${job.completed} / ${job.total}`, job.state === "failed" ? () => { void retry(job); } : undefined,
            { taskKind: job.kind, source: "gallery", phase: job.state, completed: job.completed, total: job.total, jobId: job.id,
              quiet: job.kind === "refresh_index",
              cancel: active(job) && job.state !== "cancelling" ? () => { void galleryApi.cancelJob(job.id).then(() => refreshGalleryJobs()).catch((error) => notify(error instanceof Error ? error.message : t("jobFailed"), "error")); } : undefined });
        }
    });
  }, [enabled, notify, syncTask, t]);
};
