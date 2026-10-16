import { synchronizeGalleryIndex } from "../services/gallerySync";
import { useEffect, useRef } from "react";
import { ApiRequestError, galleryApi } from "../services/galleryApi";
import { GALLERY_EVENTS_CHANNEL, isGalleryOutputEvent } from "../services/galleryEvents";

interface AutoSyncOptions {
  enabled: boolean;
  active: boolean;
  scope: string;
  viewKey: string;
  loaded: boolean;
  refresh: (forceLegacy: boolean, signal: AbortSignal) => Promise<void>;
  onError: (error: unknown, retry: () => void) => void;
}

/** Events mark the index dirty even while another workspace is open. Reading
 * a page and acknowledging a filesystem fingerprint are separate operations. */
export const useGalleryAutoSync = (options: AutoSyncOptions) => {
  const dirty = useRef(0);
  const consumed = useRef(0);
  const seen = useRef(new Set<string>());
  const fingerprints = useRef(new Map<string, string>());
  const blockedGenerations = useRef(new Map<string, number>());
  const callbacks = useRef(options);
  useEffect(() => { callbacks.current = options; });

  useEffect(() => {
    if (!options.enabled || typeof BroadcastChannel === "undefined") return;
    const channel = new BroadcastChannel(GALLERY_EVENTS_CHANNEL);
    channel.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (!isGalleryOutputEvent(data) || seen.current.has(data.prompt_id)) return;
      seen.current.add(data.prompt_id);
      if (seen.current.size > 256) seen.current.delete(seen.current.values().next().value!);
      dirty.current++;
      window.dispatchEvent(new Event("universal-gallery:outputs-dirty"));
    };
    return () => channel.close();
  }, [options.enabled]);

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
        const freshness = await galleryApi.getImageFreshness(options.scope, known, signal);
        if (signal.aborted) return;
        // The first visible snapshot must be reconciled once; an empty known
        // fingerprint says nothing about whether the committed index is fresh.
        if (eventDirty || !known || freshness.changed) {
          const legacy = await synchronizeGalleryIndex(eventDirty ? "" : options.scope, signal);
          if (signal.aborted) return;
          await callbacks.current.refresh(legacy, signal);
          if (signal.aborted) return;
          consumed.current = generation;
        }
        fingerprints.current.set(options.scope, freshness.fingerprint);
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
