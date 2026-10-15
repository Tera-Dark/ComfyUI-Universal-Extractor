import type { BatchUpdateResult, ImageRecord } from "../types/universal-gallery";

/** Never copy the last image's unrelated title, notes, or board state to a batch. */
export const applyBatchImageState = (image: ImageRecord, response: BatchUpdateResult, updates: Record<string, unknown>): ImageRecord => {
  const state = response.states?.[image.relative_path];
  if (state) return { ...image, ...state };
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(updates)) {
    if (["favorite", "pinned", "boards", "category", "title", "notes"].includes(key)) {
      patch[key] = response.last_state?.[key as keyof NonNullable<BatchUpdateResult["last_state"]>] ?? updates[key];
    }
  }
  if ("pinned" in patch || "favorite" in patch) {
    patch.pinned = Boolean(patch.pinned ?? patch.favorite);
    patch.favorite = patch.pinned;
    if (!patch.pinned && !("boards" in updates)) patch.boards = [];
  }
  return { ...image, ...patch };
};
