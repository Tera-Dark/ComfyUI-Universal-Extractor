export interface TrashBatchResult {
  completed: string[];
  unfinished: string[];
  error: string;
}

/** Stop after a failed commit: later files must not run past recovery evidence.
 * Successful items are never replayed, and the caller reloads once per batch. */
export const runTrashBatch = async (ids: string[], mutate: (id: string) => Promise<{ ok: boolean }>): Promise<TrashBatchResult> => {
  const requested = [...new Set(ids)];
  const completed: string[] = [];
  let error = "";
  for (const id of requested) {
    try {
      const result = await mutate(id);
      if (!result.ok) throw new Error("Trash operation was not committed");
      completed.push(id);
    } catch (failure) {
      error = failure instanceof Error ? failure.message : String(failure);
      break;
    }
  }
  return { completed, unfinished: requested.slice(completed.length), error };
};
