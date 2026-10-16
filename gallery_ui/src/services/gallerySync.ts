import { ApiRequestError, galleryApi } from "./galleryApi";

interface SyncRequest {
  controller: AbortController;
  clients: number;
  promise: Promise<boolean>;
}
const requests = new Map<string, SyncRequest>();
const aborted = () => new DOMException("Aborted", "AbortError");
const wait = (signal: AbortSignal) => new Promise<void>((resolve, reject) => {
  if (signal.aborted) { reject(aborted()); return; }
  const cancel = () => { window.clearTimeout(timer); reject(aborted()); };
  const timer = window.setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, 250);
  signal.addEventListener("abort", cancel, { once: true });
});

/** Manual context/page refresh and automatic events share the same durable scan.
 * A whole-library scan also satisfies callers waiting for a narrower scope. */
export const synchronizeGalleryIndex = (scope: string, signal: AbortSignal): Promise<boolean> => {
  if (signal.aborted) return Promise.reject(aborted());
  // Old servers and embedded clients retain the original force-refresh API.
  if (typeof galleryApi.createJob !== "function") return Promise.resolve(true);
  let request = requests.get("") ?? requests.get(scope);
  if (!request || request.controller.signal.aborted) {
    const entry: SyncRequest = { controller: new AbortController(), clients: 0, promise: Promise.resolve(false) };
    request = entry;
    requests.set(scope, entry);
    entry.promise = (async () => {
      try {
        const response = await galleryApi.createJob("refresh_index", { subfolder: scope, force: true }).catch((error) => {
          if (error instanceof ApiRequestError && [404, 405].includes(error.status)) return null;
          throw error;
        });
        if (!response) return true;
        let { job } = response;
        while (["queued", "running", "cancelling"].includes(job.state)) {
          await wait(entry.controller.signal);
          job = (await galleryApi.getJob(job.id, entry.controller.signal)).job;
        }
        if (job.state !== "succeeded") throw new Error(job.error || `Index sync: ${job.state}`);
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
