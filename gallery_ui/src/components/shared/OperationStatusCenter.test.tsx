import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n/I18nProvider";
import { OperationStatusProvider, useOperationStatus } from "./OperationStatusCenter";

const renderWithStatus = (children: React.ReactNode) =>
  render(
    <I18nProvider>
      <OperationStatusProvider>{children}</OperationStatusProvider>
    </I18nProvider>,
  );

const NotifyHarness = () => {
  const { notify } = useOperationStatus();
  return <button onClick={() => notify("Saved", "success")}>Notify</button>;
};

const RunHarness = () => {
  const { runOperation } = useOperationStatus();
  return (
    <button
      onClick={() => void runOperation(async () => "ok", {
        pending: "Working",
        success: "Done",
      })}
    >
      Run
    </button>
  );
};

const PartialFailureHarness = () => {
  const { runOperation } = useOperationStatus();
  return <button onClick={() => void runOperation(async () => ({ moved: 1, failed: "a.png; b.png; c.png; d.png" }), {
    pending: "Moving",
    success: ({ moved }) => `Moved ${moved}; some not processed`,
    successTone: () => "error",
    successDetail: ({ failed }) => failed,
  })}>Move partially</button>;
};

const ErrorOverflowHarness = () => {
  const { notify } = useOperationStatus();
  return <button onClick={() => {
    notify("Delete failed", "error", "a.png");
    Array.from({ length: 8 }, (_, index) => notify(`Done ${index + 1}`, "success"));
  }}>Fill after error</button>;
};

const OverflowHarness = () => {
  const { notify, startOperation } = useOperationStatus();
  return (
    <button
      onClick={() => {
        startOperation("Still working");
        Array.from({ length: 5 }, (_, index) => notify(`Done ${index + 1}`, "success"));
      }}
    >
      Fill
    </button>
  );
};

describe("OperationStatusProvider", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders and dismisses notifications", async () => {
    renderWithStatus(<NotifyHarness />);

    await userEvent.click(screen.getByRole("button", { name: "Notify" }));
    expect(screen.getByRole("status")).toHaveTextContent("Saved");

    await userEvent.click(screen.getByRole("button", { name: "关闭提醒" }));
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("auto-dismisses completed notifications", async () => {
    vi.useFakeTimers();
    renderWithStatus(<NotifyHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Notify" }));
    expect(screen.getByText("Saved")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(3600);
    });

    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("updates pending operations to completion", async () => {
    renderWithStatus(<RunHarness />);

    await userEvent.click(screen.getByRole("button", { name: "Run" }));

    expect(await screen.findByText("Done")).toBeInTheDocument();
    expect(screen.queryByText("Working")).toBeNull();
  });

  it("keeps partial failures until dismissed and exposes every failed path through details", async () => {
    vi.useFakeTimers();
    renderWithStatus(<PartialFailureHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Move partially" }));
    await act(async () => { await Promise.resolve(); });
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Moved 1; some not processed");
    expect(alert.querySelector("details")).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("查看详情"));
    expect(alert.querySelector("details")).toHaveAttribute("open");
    expect(alert).toHaveTextContent("d.png");
    act(() => { vi.advanceTimersByTime(15_000); });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "关闭提醒" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("keeps pending operations when the list is capped", async () => {
    renderWithStatus(<OverflowHarness />);

    await userEvent.click(screen.getByRole("button", { name: "Fill" }));

    expect(screen.getByText("Still working")).toBeInTheDocument();
    expect(screen.queryByText("Done 1")).toBeNull();
    expect(screen.getAllByRole("status")).toHaveLength(5);
  });

  it("does not evict an error when later success notifications exceed the cap", () => {
    renderWithStatus(<ErrorOverflowHarness />);
    fireEvent.click(screen.getByRole("button", { name: "Fill after error" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Delete failed");
    expect(screen.getAllByRole("status")).toHaveLength(4);
  });

  it("clears dismiss timers on unmount", async () => {
    vi.useFakeTimers();
    const clearSpy = vi.spyOn(window, "clearTimeout");
    const { unmount } = renderWithStatus(<NotifyHarness />);

    fireEvent.click(screen.getByRole("button", { name: "Notify" }));
    unmount();

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});
