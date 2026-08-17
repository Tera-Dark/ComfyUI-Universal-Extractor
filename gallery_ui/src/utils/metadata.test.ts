import { describe, expect, it } from "vitest";

import type { ImageMetadata } from "../types/universal-gallery";
import { getPositivePromptText, stringifyImageMetadata } from "./metadata";

const baseMetadata: ImageMetadata = {
  filename: "image.png",
  relative_path: "image.png",
  metadata: null,
  workflow: null,
  artist_prompts: [],
  summary: {
    positive_prompt: "",
    negative_prompt: "",
    size: "",
    seed: null,
    steps: null,
    sampler: "",
    cfg: null,
    scheduler: "",
    denoise: null,
  },
  state: {
    favorite: false,
    pinned: false,
    boards: [],
    category: "",
    title: "",
    notes: "",
    updated_at: 0,
  },
};

describe("metadata utilities", () => {
  it("prefers the parsed positive prompt summary", () => {
    expect(
      getPositivePromptText({
        ...baseMetadata,
        summary: { ...baseMetadata.summary, positive_prompt: "  summary prompt  " },
        metadata: { prompt: "embedded prompt" },
      }),
    ).toBe("summary prompt");
  });

  it("falls back to embedded node text when no summary prompt exists", () => {
    expect(
      getPositivePromptText({
        ...baseMetadata,
        metadata: {
          prompt: {
            "1": { inputs: { text: " node prompt " } },
          },
        },
      }),
    ).toBe("node prompt");
  });

  it("stringifies the stable metadata inspection shape", () => {
    expect(JSON.parse(stringifyImageMetadata(baseMetadata))).toMatchObject({
      summary: baseMetadata.summary,
      artist_prompts: [],
      state: baseMetadata.state,
    });
  });
});
