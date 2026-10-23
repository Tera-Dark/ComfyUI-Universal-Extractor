import { ApiRequestError, galleryApi } from "./galleryApi";
import { waitForGalleryJob } from "./galleryJobMonitor";

interface SyncRequest {
  controller: AbortController;
  clients: number;
  promise: Promise<boolean>;
  obsolete: boolean;
}
const requests = new Map<string, SyncRequest>();
export const invalidateGallerySyncRequests = () => {
  for (const request of requests.values()) request.obsolete = true;
};
export class GallerySyncError extends Error {
  readonly jobId: string;
  readonly scope: string;
  constructor(message: string, jobId: string, scope: string) { super(message); this.jobId = jobId; this.scope = scope; }
}
const aborted = () => new DOMException("Aborted", "AbortError");

/** Manual context/page refresh and automatic events share the same durable scan.
 * A whole-library scan also satisfies callers waiting for a narrower scope. */
export const synchronizeGalleryIndex = (scope: string, signal: AbortSignal): Promise<boolean> => {
  if (signal.aborted) return Promise.reject(aborted());
  // Old servers and embedded clients retain the original force-refresh API.
  if (typeof galleryApi.createJob !== "function") return Promise.resolve(true);
  const whole = requests.get("");
  let request = whole && !whole.obsolete ? whole : requests.get(scope);
  if (request?.obsolete) request = undefined;
  if (!request || request.controller.signal.aborted) {
    const entry: SyncRequest = { controller: new AbortController(), clients: 0, promise: Promise.resolve(false), obsolete: false };
    request = entry;
    requests.set(scope, entry);
    entry.promise = (async () => {
      try {
        const response = await galleryApi.createJob("refresh_index", { subfolder: scope, force: true }).catch((error) => {
          if (error instanceof ApiRequestError && [404, 405].includes(error.status)) return null;
          throw error;
        });
        if (!response) return true;
        const job = await waitForGalleryJob(response.job, entry.controller.signal);
        if (job.state !== "succeeded") throw new GallerySyncError(job.error || `Index sync: ${job.state}`, job.id, String(job.payload?.subfolder ?? scope));
        return false;
      } finally {
        if (requests.get(scope) === entry) requests.delete(scope);
      }
    })();
  }
  const entry = request;
  entry.clients++;
  return new Promise<boolean>((resolve, reject) => {
    let finished = false;
    const release = () => {
      if (finished) return false;
      finished = true;
      signal.removeEventListener("abort", cancel);
      if (--entry.clients === 0) entry.controller.abort();
      return true;
    };
    const cancel = () => { if (release()) reject(aborted()); };
    signal.addEventListener("abort", cancel, { once: true });
    entry.promise.then((legacy) => { if (release()) resolve(legacy); }, (error) => { if (release()) reject(error); });
  });
};
