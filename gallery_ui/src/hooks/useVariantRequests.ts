import { useCallback, useEffect, useRef } from "react";

/** One current variant request; replaced scopes and unmounted views cannot apply stale data. */
export const useVariantRequests = () => {
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const invalidate = useCallback(() => {
    sequence.current += 1;
    controller.current?.abort();
  }, []);
  const begin = useCallback(() => {
    invalidate();
    controller.current = new AbortController();
    const id = sequence.current;
    return { signal: controller.current.signal, isCurrent: () => id === sequence.current };
  }, [invalidate]);
  useEffect(() => invalidate, [invalidate]);
  return { begin, invalidate };
};
