import { ApiRequestError, galleryApi } from "./galleryApi";
import { JOB_ACTIVITY_EVENT } from "./jobActivity";
import type { GalleryJob } from "../types/universal-gallery";

export const isActiveJob = (job: GalleryJob) => ["queued", "running", "cancelling"].includes(job.state);
type Listener = (jobs: GalleryJob[], errors?: Map<string, unknown>) => void;
const listeners = new Set<Listener>();
const watched = new Map<string, GalleryJob>();
let timer: number | undefined;
let controller: AbortController | undefined;
let inFlight: Promise<void> | undefined;
let requests = 0;
let epoch = 0;
let revision: number | undefined;
let failures = 0;

/** One poller per application, shared by task feedback and refresh waiters.
 * Cancelling a subscription never cancels a durable server job. */
export const refreshGalleryJobs = (): Promise<void> => {
  window.clearTimeout(timer);
  if (!listeners.size || document.visibilityState === "hidden") return Promise.resolve();
  if (inFlight) return controller?.signal.aborted ? inFlight.then(() => refreshGalleryJobs()) : inFlight;
  const generation = epoch;
  const request = new AbortController();
  controller = request;
  const run = async () => {
    let delay = 2000;
    try {
      const response = await galleryApi.listJobs(request.signal, revision);
      if (request.signal.aborted || generation !== epoch) return;
      revision = response.revision;
      failures = 0;
      delay = revision === undefined ? 2000 : 25;
      const returned = new Set(response.jobs.map((job) => job.id));
      const errors = new Map<string, unknown>();
      const missing = [...watched.values()].filter((job) => isActiveJob(job) && !returned.has(job.id));
      for (let offset = 0; offset < missing.length; offset += 8) {
        const extra = await Promise.all(missing.slice(offset, offset + 8).map(async (job) => {
          try { return (await galleryApi.getJob(job.id, request.signal)).job; }
          catch (error) {
            if (error instanceof ApiRequestError && error.status === 404) {
              watched.delete(job.id);
              errors.set(job.id, error);
            }
            return null;
          }
        }));
        if (request.signal.aborted || generation !== epoch) return;
        response.jobs.push(...extra.filter((job): job is GalleryJob => job !== null));
      }
      for (const job of response.jobs) watched.set(job.id, job);
      // Keep only active records and the bounded recent response in memory.
      for (const [id, job] of watched) if (!returned.has(id) && !isActiveJob(job) && !missing.some((item) => item.id === id)) watched.delete(id);
      for (const listener of [...listeners]) listener(response.jobs, errors);
    } catch (error) {
      // The caller's HTTP/terminal job error is reported separately. A brief
      // polling outage must not invent failed jobs or erase their last state.
      if (!request.signal.aborted && generation === epoch) {
        delay = [2000, 10000, 30000][Math.min(failures++, 2)];
        if (failures >= 3) {
          const errors = new Map([...watched].filter(([, job]) => isActiveJob(job)).map(([id]) => [id, error]));
          for (const listener of [...listeners]) listener([], errors);
        }
      }
    } finally {
      if (generation === epoch) {
        inFlight = undefined;
        if (listeners.size && document.visibilityState !== "hidden" &&
            (requests > 0 || [...watched.values()].some(isActiveJob))) {
          // Modern servers wake one asynchronous long poll on committed job
          // changes. Legacy servers retain the two-second fallback.
          timer = window.setTimeout(() => { void refreshGalleryJobs(); }, delay);
        }
      }
    }
  };
  inFlight = run();
  return inFlight;
};

const activity = (event: Event) => {
  requests = Math.max(0, requests + Number((event as CustomEvent<number>).detail || 0));
  void refreshGalleryJobs();
};
const visibility = () => {
  if (document.visibilityState === "hidden") { controller?.abort(); window.clearTimeout(timer); }
  else void refreshGalleryJobs();
};

export const subscribeGalleryJobs = (listener: Listener) => {
  listeners.add(listener);
  if (listeners.size === 1) {
    window.addEventListener(JOB_ACTIVITY_EVENT, activity);
    document.addEventListener("visibilitychange", visibility);
    timer = window.setTimeout(() => { void refreshGalleryJobs(); }, 500);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size) {
      epoch++;
      controller?.abort();
      window.clearTimeout(timer);
      inFlight = undefined;
      watched.clear();
      revision = undefined;
      failures = 0;
      requests = 0;
      window.removeEventListener(JOB_ACTIVITY_EVENT, activity);
      document.removeEventListener("visibilitychange", visibility);
    }
  };
};

export const waitForGalleryJob = (initial: GalleryJob, signal: AbortSignal): Promise<GalleryJob> => {
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  if (!isActiveJob(initial)) return Promise.resolve(initial);
  // A fast scan can finish before the POST response reaches its waiter. Never
  // replace a newer terminal snapshot with that older queued response.
  const cached = watched.get(initial.id);
  if (cached && !isActiveJob(cached)) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const unsubscribe = subscribeGalleryJobs((jobs, errors) => {
      if (errors?.has(initial.id)) { cleanup(); reject(errors.get(initial.id)); return; }
      const job = jobs.find((item) => item.id === initial.id);
      if (job && !isActiveJob(job)) { cleanup(); resolve(job); }
    });
    const cleanup = () => { signal.removeEventListener("abort", cancel); unsubscribe(); };
    const cancel = () => { cleanup(); reject(new DOMException("Aborted", "AbortError")); };
    signal.addEventListener("abort", cancel, { once: true });
    if (!cached || initial.updated_at > cached.updated_at) watched.set(initial.id, initial);
    void refreshGalleryJobs();
  });
};
