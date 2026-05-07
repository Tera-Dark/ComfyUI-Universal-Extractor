import { describe, expect, it } from "vitest";

import { formatFileSize, formatTitleCase } from "./formatters";

describe("formatters", () => {
  it("formats byte, kilobyte, and megabyte sizes", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(2.5 * 1024 * 1024)).toBe("2.50 MB");
  });

  it("normalizes separators and title-cases folder labels", () => {
    expect(formatTitleCase("  comfy_output-gallery  ")).toBe("Comfy Output Gallery");
  });
});
