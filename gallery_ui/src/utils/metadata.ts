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

  if (embeddedPrompt && typeof embeddedPrompt === "object") {
    for (const node of Object.values(embeddedPrompt as Record<string, unknown>)) {
      if (!node || typeof node !== "object") {
        continue;
      }

      const inputs = (node as { inputs?: unknown }).inputs;
      if (!inputs || typeof inputs !== "object") {
        continue;
      }

      const text = normalizePromptText((inputs as { text?: unknown }).text);
      if (text) {
        return text;
      }
    }
  }

  return "";
};

export const stringifyImageMetadata = (metadata: ImageMetadata | null | undefined) =>
  JSON.stringify(
    {
      summary: metadata?.summary ?? null,
      artist_prompts: metadata?.artist_prompts ?? [],
      metadata: metadata?.metadata ?? null,
      workflow: metadata?.workflow ?? null,
      state: metadata?.state ?? null,
    },
    null,
    2,
  );
