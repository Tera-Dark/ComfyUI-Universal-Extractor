import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeReleaseNotice } from "./releaseNotice";

afterEach(() => { vi.restoreAllMocks(); });
describe("installed release notices", () => {
  it("establishes a first-install baseline and consumes an upgrade once", () => {
    localStorage.setItem("universal-extractor:seen-releases", "[]");
    expect(consumeReleaseNotice("1.6.0")).toBe(false);
    expect(consumeReleaseNotice("1.7.0")).toBe(true);
    expect(consumeReleaseNotice("1.7.0")).toBe(false);
    expect(consumeReleaseNotice("1.6.0")).toBe(false);
  });
  it("uses session state when browser storage is unavailable", () => {
    localStorage.setItem("universal-extractor:seen-releases", '["1.7.0"]');
    consumeReleaseNotice("1.7.0");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(consumeReleaseNotice("1.8.0")).toBe(true);
    expect(consumeReleaseNotice("1.8.0")).toBe(false);
  });
});
