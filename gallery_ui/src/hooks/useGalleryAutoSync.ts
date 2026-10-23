import { invalidateGallerySyncRequests, synchronizeGalleryIndex } from "../services/gallerySync";
import { useCallback, useEffect, useRef } from "react";
import { ApiRequestError, galleryApi } from "../services/galleryApi";
import { commonGalleryScope, GALLERY_EVENTS_CHANNEL, isGalleryOutputEvent } from "../services/galleryEvents";

interface AutoSyncOptions {
  enabled: boolean;
  active: boolean;
  scope: string;
  viewKey: string;
  loaded: boolean;
  refresh: (forceLegacy: boolean, signal: AbortSignal, filesystemChanged?: boolean) => Promise<void>;
  onError: (error: unknown, retry: () => void) => void;
}

/** Events mark the index dirty even while another workspace is open. Reading
 * a page and acknowledging a filesystem fingerprint are separate operations. */
export const useGalleryAutoSync = (options: AutoSyncOptions) => {
  const dirty = useRef(0);
  const consumed = useRef(0);
  const seen = useRef(new Set<string>());
  const pendingScopes = useRef<{ generation: number; scopes: string[] }[]>([]);
  const baselineReconciled = useRef(false);
  const relay = useRef({ instance: "", sequence: 0, started: 0, supported: true });
  const fingerprints = useRef(new Map<string, string>());
  const blockedGenerations = useRef(new Map<string, number>());
  const callbacks = useRef(options);
  useEffect(() => { callbacks.current = options; });
  useEffect(() => { relay.current.started = Date.now() / 1000; }, []);

  const acceptEvent = useCallback((data: unknown) => {
    if (!isGalleryOutputEvent(data) || seen.current.has(data.prompt_id)) return;
    seen.current.add(data.prompt_id);
    if (seen.current.size > 256) seen.current.delete(seen.current.values().next().value!);
    dirty.current++;
    invalidateGallerySyncRequests();
    pendingScopes.current.push({ generation: dirty.current, scopes: data.scopes?.length ? data.scopes : [""] });
    if (pendingScopes.current.length > 256) pendingScopes.current = [{ generation: dirty.current, scopes: [""] }];
    window.dispatchEvent(new Event("universal-gallery:outputs-dirty"));
  }, []);

  useEffect(() => {
    if (!options.enabled || typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(GALLERY_EVENTS_CHANNEL);
    channel.onmessage = ({ data }: MessageEvent<unknown>) => {
      acceptEvent(data);
    };
    return () => channel.close();
  }, [options.enabled, acceptEvent]);

  useEffect(() => {
    if (!options.enabled || !options.active || typeof galleryApi.getSyncStatus !== "function" || !relay.current.supported) return;
    const controller = new AbortController();
    let timer: number | undefined;
    let running = false;
    const poll = async () => {
      if (running || controller.signal.aborted || document.visibilityState === "hidden") return;
      running = true;
      // This only reads bounded in-memory completion hints, not the filesystem.
      // One visible-only check per second also covers API-only workflow clients.
      let delay = 1000;
      try {
        const status = await galleryApi.getSyncStatus(relay.current.sequence, controller.signal);
        if (controller.signal.aborted) return;
        if (relay.current.instance && relay.current.instance !== status.instance) relay.current.sequence = 0;
        else relay.current.sequence = status.sequence;
        relay.current.instance = status.instance;
        for (const event of status.events) if (!event.created_at || event.created_at >= relay.current.started) acceptEvent(event);
      } catch (error) {
        if (error instanceof ApiRequestError && [404, 405].includes(error.status)) { relay.current.supported = false; return; }
        delay = 10000;
      } finally {
        running = false;
        if (!controller.signal.aborted && relay.current.supported) timer = window.setTimeout(() => { void poll(); }, delay);
      }
    };
    const visible = () => { window.clearTimeout(timer); if (document.visibilityState === "visible") void poll(); };
    document.addEventListener("visibilitychange", visible);
    void poll();
    return () => { controller.abort(); window.clearTimeout(timer); document.removeEventListener("visibilitychange", visible); };
  }, [options.enabled, options.active, acceptEvent]);

  useEffect(() => {
    if (!options.enabled || !options.active || !options.loaded) return;
    const controller = new AbortController();
    const { signal } = controller;
    let running = false;
    let timer: number | undefined;
    let retryCount = 0;
    const schedule = (ms: number) => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => { void check(); }, ms);
    };
    const check = async () => {
      if (signal.aborted || running || document.visibilityState === "hidden" || blockedGenerations.current.get(options.scope) === dirty.current) return;
      running = true;
      const generation = dirty.current;
      const eventDirty = generation !== consumed.current;
      const known = fingerprints.current.get(options.scope) ?? "";
      try {
        // A terminal workflow event already proves that a scan is needed. Do
        // not queue another full filesystem traversal in front of that scan.
        const freshness = eventDirty ? null : await galleryApi.getImageFreshness(options.scope, known, signal);
        if (signal.aborted) return;
        // The first visible snapshot must be reconciled once; an empty known
        // fingerprint says nothing about whether the committed index is fresh.
        if (eventDirty || !known || freshness?.changed) {
          if (freshness?.changed) invalidateGallerySyncRequests();
          const scopes = new Set(pendingScopes.current.filter((item) => item.generation <= generation).flatMap((item) => item.scopes));
          // The history baseline intentionally omits old completions. Reconcile
          // every source once so opening an old subfolder cannot hide output
          // created elsewhere before this gallery session started.
          const targets = !baselineReconciled.current ? [""] : eventDirty ? [commonGalleryScope([...scopes])] : [options.scope];
          const results = await Promise.all(targets.map((scope) => synchronizeGalleryIndex(scope, signal)));
          const legacy = results.some(Boolean);
          if (signal.aborted) return;
          if (freshness?.changed) await callbacks.current.refresh(legacy, signal, true);
          else await callbacks.current.refresh(legacy, signal);
          if (signal.aborted) return;
          baselineReconciled.current = true;
          consumed.current = generation;
          pendingScopes.current = pendingScopes.current.filter((item) => item.generation > generation);
        }
        if (freshness) fingerprints.current.set(options.scope, freshness.fingerprint);
        blockedGenerations.current.delete(options.scope);
        retryCount = 0;
      } catch (error) {
        if (signal.aborted) return;
        const retryable = error instanceof TypeError || error instanceof ApiRequestError && [502, 503, 504].includes(error.status);
        if (retryable && retryCount < 2) schedule([2000, 10000][retryCount++]);
        else {
          // A terminal failure must not create a new durable scan every poll or
          // focus event. Keep the unacknowledged change until retry/new output.
          blockedGenerations.current.set(options.scope, generation);
          callbacks.current.onError(error, () => { retryCount = 0; dirty.current++; window.dispatchEvent(new Event("universal-gallery:outputs-dirty")); });
        }
      } finally {
        running = false;
        if (!signal.aborted && dirty.current !== generation) schedule(1000);
      }
    };
    const onDirty = () => { retryCount = 0; if (!running) schedule(1000); };
    const onVisible = () => { if (document.visibilityState === "visible") schedule(0); };
    const interval = window.setInterval(() => { void check(); }, 15000);
    window.addEventListener("universal-gallery:outputs-dirty", onDirty);
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    schedule(1000);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
      window.clearInterval(interval);
      window.removeEventListener("universal-gallery:outputs-dirty", onDirty);
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [options.enabled, options.active, options.loaded, options.scope, options.viewKey]);
};
