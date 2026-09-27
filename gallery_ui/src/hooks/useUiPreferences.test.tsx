import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_UI_PREFERENCES, readStoredUiPreferences, useUiPreferences } from "./useUiPreferences";

const key = "universal-extractor:ui-preferences";

describe("useUiPreferences", () => {
  beforeEach(() => window.localStorage.removeItem(key));
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.removeItem(key);
  });

  it("loads once, merges old preferences with new defaults and persists changes", () => {
    window.localStorage.setItem(key, JSON.stringify({ enableImagePrefetch: false, collapseSidebarOnLaunch: true }));
    const { result } = renderHook(() => useUiPreferences());
    expect(result.current.preferences).toEqual({
      ...DEFAULT_UI_PREFERENCES, enableImagePrefetch: false, collapseSidebarOnLaunch: true,
    });
    act(() => result.current.update({ defaultFolderTreeView: false }));
    expect(result.current.preferences.defaultFolderTreeView).toBe(false);
    expect(JSON.parse(window.localStorage.getItem(key) || "{}")).toEqual(result.current.preferences);
  });

  it("recovers invalid storage and still allows in-memory updates when storage is blocked", () => {
    window.localStorage.setItem(key, "not json");
    expect(readStoredUiPreferences()).toEqual(DEFAULT_UI_PREFERENCES);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage denied"); });
    const { result } = renderHook(() => useUiPreferences());
    act(() => result.current.update({ enableLiveGalleryRefresh: false }));
    expect(result.current.preferences.enableLiveGalleryRefresh).toBe(false);
  });
});
