import { describe, expect, it, vi } from "vitest";
import { confirmedBatchRetry } from "./batchRetry";
import type { RunOperationOptions } from "../components/shared/OperationStatusCenter";

describe("partial operation retry", () => {
  it("confirms only unfinished paths and excludes later successes on a second retry", async () => {
    const confirm = vi.fn().mockResolvedValue(true);
    const execute = vi.fn().mockResolvedValueOnce({ failed: ["b"] }).mockResolvedValueOnce({ failed: [] });
    const runs: RunOperationOptions<{ failed: string[] }>[] = [];
    const run = async <T,>(operation: () => Promise<T>, options: RunOperationOptions<T>) => {
      const value = await operation(); runs.push(options as RunOperationOptions<{ failed: string[] }>); options.successRetry?.(value)?.(); return value;
    };
    confirmedBatchRetry<{ failed: string[] }>({ paths: ["a", "b", "a"], confirm, confirmation: (count) => ({ title: "Retry", message: `${count} files` }), execute,
      failed: (_paths, result) => result.failed, summary: () => "Done", run, pending: "Retrying" })!();
    await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2));
    expect(execute.mock.calls.map(([paths]) => paths)).toEqual([["a", "b"], ["b"]]);
    expect(confirm.mock.calls.map(([options]) => options.message)).toEqual(["2 files", "1 files"]);
    expect(runs).toHaveLength(2);
  });
  it("does nothing for an empty subset or a declined confirmation", async () => {
    const execute = vi.fn(); const confirm = vi.fn().mockResolvedValue(false);
    const options = { paths: [] as string[], confirm, confirmation: () => ({ title: "Retry", message: "Files" }), execute,
      failed: () => [], summary: () => "Done", run: vi.fn(), pending: "Retrying" };
    expect(confirmedBatchRetry(options)).toBeUndefined();
    confirmedBatchRetry({ ...options, paths: ["b"] })!();
    await vi.waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(execute).not.toHaveBeenCalled();
  });
});
