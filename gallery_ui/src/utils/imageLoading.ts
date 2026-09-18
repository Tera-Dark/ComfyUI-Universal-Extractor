/** Decode before presenting a full-size image; abort stale navigation work. */
export function loadDecodedImage(src: string, signal: AbortSignal, timeoutMs = 15000): Promise<boolean> {
  return new Promise(resolve => {
    if (signal.aborted || !src) { resolve(false); return; }
    const image = new Image();
    image.decoding = "async";
    let finished = false;
    const finish = (success: boolean) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      image.onload = null;
      image.onerror = null;
      if (!success) image.src = "";
      resolve(success);
    };
    const abort = () => finish(false);
    const timer = window.setTimeout(() => finish(false), timeoutMs);
    image.onload = async () => {
      try { await image.decode?.(); } catch { /* onload is still a valid decoded fallback */ }
      finish(!signal.aborted);
    };
    image.onerror = () => finish(false);
    signal.addEventListener("abort", abort, {once:true});
    image.src = src;
  });
}

export function preferredScrollBehavior(): ScrollBehavior {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
}
