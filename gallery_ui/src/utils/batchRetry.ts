import type { ConfirmOptions } from "../components/shared/ConfirmDialog";
import type { RunOperationOptions } from "../components/shared/OperationStatusCenter";

interface RetryOptions<T> {
  paths: string[];
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  confirmation: (count: number) => ConfirmOptions;
  execute: (paths: string[]) => Promise<T>;
  failed: (paths: string[], result: T) => string[];
  summary: (paths: string[], result: T) => string;
  run: <V>(operation: () => Promise<V>, options: RunOperationOptions<V>) => Promise<V>;
  pending: string;
}

/** Each retry owns only its unfinished subset and asks again before mutation.
 * It does not retain component selection or overwrite a later browsing scope. */
export const confirmedBatchRetry = <T,>(options: RetryOptions<T>): (() => void) | undefined => {
  const paths = [...new Set(options.paths)];
  if (!paths.length) return undefined;
  return () => { void (async () => {
    if (!await options.confirm(options.confirmation(paths.length))) return;
    await options.run(async () => {
      const result = await options.execute(paths);
      window.dispatchEvent(new Event("universal-gallery:files-changed"));
      return result;
    }, {
      pending: options.pending,
      success: (result) => options.summary(paths, result),
      successTone: (result) => options.failed(paths, result).length ? "error" : "success",
      successDetail: (result) => options.failed(paths, result).join("; "),
      successRetry: (result) => confirmedBatchRetry({ ...options, paths: options.failed(paths, result) }),
    });
  })().catch(() => undefined); };
};
