import type { ImageMetadata } from "../types/universal-gallery";

const normalizePromptText = (value: unknown) => (typeof value === "string" ? value.trim() : "");

export const getPositivePromptText = (metadata: ImageMetadata | null | undefined) => {
  const summaryPrompt = normalizePromptText(metadata?.summary?.positive_prompt);
  if (summaryPrompt) {
    return summaryPrompt;
  }

  const embeddedPrompt = metadata?.metadata?.prompt;
  if (typeof embeddedPrompt === "string") {
    return embeddedPrompt.trim();
  }

  // Object-form ComfyUI graphs must be resolved by the backend. Picking the
  // first text node could copy a negative prompt or the wrong output branch.

  return "";
};

export const stringifyImageMetadata = (metadata: ImageMetadata | null | undefined) =>
  JSON.stringify(
    {
      summary: metadata?.summary ?? null,
      recipe: metadata?.recipe ?? null,
      artist_prompts: metadata?.artist_prompts ?? [],
      metadata: metadata?.metadata ?? null,
      workflow: metadata?.workflow ?? null,
      state: metadata?.state ?? null,
    },
    null,
    2,
  );
