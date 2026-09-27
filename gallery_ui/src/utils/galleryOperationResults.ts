import type { DeleteImagesResult, MoveImagesResult } from "../types/universal-gallery";

/** Account for every requested source path; destinations alone cannot identify which selection to clear. */
export const getMoveOutcome = (paths: string[], result: MoveImagesResult) => {
  const requested = [...new Set(paths)];
  const requestedSet = new Set(requested);
  const notMoved = new Set([...result.missing, ...(result.blocked ?? []), ...(result.unchanged ?? [])]
    .filter((path) => requestedSet.has(path)));
  // Older servers only provide destination paths. Infer the corresponding sources
  // only if the returned counts account for every requested item.
  const inferredSources = result.moved.length === requested.length - notMoved.size
    ? requested.filter((path) => !notMoved.has(path))
    : [];
  const movedSources = new Set((result.moved_sources ?? inferredSources)
    .filter((path) => requestedSet.has(path) && !notMoved.has(path)));
  const failedPaths = requested.filter((path) => !movedSources.has(path));
  const unaccounted = failedPaths.filter((path) => !notMoved.has(path)).length;
  return {
    movedSources,
    failedPaths,
    unaccounted,
    complete: failedPaths.length === 0 && result.moved.length === requested.length,
  };
};

export const getDeleteOutcome = (paths: string[], result: DeleteImagesResult) => {
  const requested = [...new Set(paths)];
  const requestedSet = new Set(requested);
  const deletedPaths = new Set(result.deleted.filter((path) => requestedSet.has(path)));
  const failedPaths = requested.filter((path) => !deletedPaths.has(path));
  const missing = new Set(result.missing);
  return {
    deletedPaths,
    failedPaths,
    unaccounted: failedPaths.filter((path) => !missing.has(path)).length,
    complete: failedPaths.length === 0 && result.deleted.length === requested.length,
  };
};

// The operation card is expandable, so keep every path available for inspection/retry.
export const describeFailedPaths = (paths: string[]) => paths.join("; ");
