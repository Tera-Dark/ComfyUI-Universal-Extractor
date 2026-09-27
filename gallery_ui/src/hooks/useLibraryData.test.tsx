import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

import { I18nProvider } from "../i18n/I18nProvider";
import { galleryApi } from "../services/galleryApi";
import { useLibraryData } from "./useLibraryData";

vi.mock("../services/galleryApi", () => ({ galleryApi: {
  listLibraries: vi.fn(), getLibraryEntries: vi.fn(), getLibrary: vi.fn(),
} }));
const wrapper = ({ children }: { children: ReactNode }) => <I18nProvider>{children}</I18nProvider>;
const deferred = <T,>() => {
  let resolve!: (result: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
};
type EntriesResponse = Awaited<ReturnType<typeof galleryApi.getLibraryEntries>>;
const page = (title: string, total = 1): EntriesResponse => ({
  name: "test.json", page: 1, limit: 120, total,
  data: total ? [{ source_index: 0, title, prompt: title }] : [],
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.mocked(galleryApi.listLibraries).mockResolvedValue([]);
});
afterEach(() => { vi.useRealTimers(); });

const advance = async (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe("useLibraryData scope-aware page requests", () => {
  it("does not blank an active library when its sidebar row is activated again", async () => {
    vi.mocked(galleryApi.getLibraryEntries).mockResolvedValue(page("Keep this entry"));
    const { result } = renderHook(() => useLibraryData(true), { wrapper });
    await act(async () => { await result.current.openLibrary("test.json"); });
    await advance(0);
    expect(result.current.entries[0]?.title).toBe("Keep this entry");
    const calls = vi.mocked(galleryApi.getLibraryEntries).mock.calls.length;
    await act(async () => { await result.current.openLibrary("test.json"); });
    await advance(0);
    expect(result.current.entries[0]?.title).toBe("Keep this entry");
    expect(result.current.entryTotal).toBe(1);
    expect(galleryApi.getLibraryEntries).toHaveBeenCalledTimes(calls);
  });

  it("never commits a late older search result or its count", async () => {
    const soft = deferred<EntriesResponse>();
    const never = deferred<EntriesResponse>();
    vi.mocked(galleryApi.getLibraryEntries).mockImplementation((_name, search) => search === "Soft" ? soft.promise : never.promise);
    const { result } = renderHook(() => useLibraryData(true), { wrapper });
    await act(async () => { await result.current.openLibrary("test.json"); });
    await act(async () => { result.current.setSearchTerm("Soft"); });
    await advance(250);
    expect(galleryApi.getLibraryEntries).toHaveBeenCalledWith("test.json", "Soft", 1, 120);
    await act(async () => { result.current.setSearchTerm("neverxyz"); });
    expect(result.current.entries).toEqual([]);
    expect(result.current.entryTotal).toBe(0);
    await advance(250);
    await act(async () => { never.resolve(page("", 0)); });
    expect(result.current.searchTerm).toBe("neverxyz");
    expect(result.current.entries).toEqual([]);
    expect(result.current.entryTotal).toBe(0);
    await act(async () => { soft.resolve(page("Soft daylight")); });
    expect(result.current.entries).toEqual([]);
    expect(result.current.entryTotal).toBe(0);
  });

  it("isolates two libraries when the old request resolves last", async () => {
    const old = deferred<EntriesResponse>();
    vi.mocked(galleryApi.getLibraryEntries).mockImplementation((name) => name === "old.json" ? old.promise : Promise.resolve(page("New item", 2)));
    const { result } = renderHook(() => useLibraryData(true), { wrapper });
    await act(async () => { await result.current.openLibrary("old.json"); });
    await advance(0);
    await act(async () => { await result.current.openLibrary("new.json"); });
    expect(result.current.entries).toEqual([]);
    await advance(0);
    expect(result.current.activeLibraryName).toBe("new.json");
    expect(result.current.entries[0]?.title).toBe("New item");
    expect(result.current.entryTotal).toBe(2);
    await act(async () => { old.resolve(page("Wrong old item", 99)); });
    expect(result.current.entries[0]?.title).toBe("New item");
    expect(result.current.entryTotal).toBe(2);
  });

  it("debounces typing into one request and ignores an older failure", async () => {
    const pending = deferred<EntriesResponse>();
    vi.mocked(galleryApi.getLibraryEntries).mockImplementation((_name, search) => search === "x" ? pending.promise : Promise.resolve(page("Match")));
    const { result } = renderHook(() => useLibraryData(true), { wrapper });
    await act(async () => { await result.current.openLibrary("test.json"); });
    await advance(0);
    await act(async () => { result.current.setSearchTerm("x"); });
    await advance(250);
    await act(async () => { result.current.setSearchTerm("xy"); });
    await advance(100);
    await act(async () => { result.current.setSearchTerm("xyz"); });
    await advance(250);
    expect(vi.mocked(galleryApi.getLibraryEntries).mock.calls.map((call) => call[1])).toEqual(["", "x", "xyz"]);
    await act(async () => { pending.resolve(page("Old", 42)); });
    expect(result.current.entries[0]?.title).toBe("Match");
    expect(result.current.entryTotal).toBe(1);
  });
});
