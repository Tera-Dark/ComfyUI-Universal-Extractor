import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

class TestResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

if (!window.ResizeObserver) {
  window.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});
