import { afterEach, describe, expect, it, vi } from "vitest";

import { readStorageItem, writeStorageItem } from "./safeStorage";

describe("safeStorage", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reads and writes a preference without changing its key", () => {
    expect(writeStorageItem("safe-storage-test", "list")).toBe(true);
    expect(readStorageItem("safe-storage-test")).toBe("list");
    window.localStorage.removeItem("safe-storage-test");
  });

  it("keeps the app usable when the browser blocks storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage denied"); });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage denied"); });
    expect(readStorageItem("anything")).toBeNull();
    expect(writeStorageItem("anything", "value")).toBe(false);
  });
});
