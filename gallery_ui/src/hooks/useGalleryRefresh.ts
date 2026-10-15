import { useCallback, useEffect, useRef } from "react";

interface RefreshWaiter {
  parts: Set<"context" | "images">;
  error: Error | null;
  resolve: () => void;
  reject: (error: Error) => void;
}

export const useGalleryRefresh = (interrupted: string) => {
  const waiters = useRef(new Map<number, RefreshWaiter>());
  const completeRefreshPart = useCallback((key: number, part: "context" | "images", error?: Error) => {
    const waiter = waiters.current.get(key);
    if (!waiter) return;
    waiter.parts.delete(part);
    if (error) waiter.error ??= error;
    if (!waiter.parts.size) {
      waiters.current.delete(key);
      if (waiter.error) waiter.reject(waiter.error);
      else waiter.resolve();
    }
  }, []);
  const waitForRefresh = (trigger: () => number) => new Promise<void>((resolve, reject) => {
    const key = trigger();
    waiters.current.set(key, { parts: new Set(["context", "images"]), error: null, resolve, reject });
  });
  useEffect(() => {
    const pending = waiters.current;
    return () => {
      pending.forEach((waiter) => waiter.reject(new Error(interrupted)));
      pending.clear();
    };
  }, [interrupted]);
  return { completeRefreshPart, waitForRefresh };
};
