import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ToastProvider, useToast } from "./ToastViewport";

const ToastHarness = () => {
  const { pushToast } = useToast();
  return <button onClick={() => pushToast("Saved", "success")}>Notify</button>;
};

describe("ToastProvider", () => {
  it("renders and dismisses toast messages", async () => {
    render(
      <ToastProvider>
        <ToastHarness />
      </ToastProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Notify" }));
    expect(screen.getByText("Saved")).not.toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Close notification" }));
    expect(screen.queryByText("Saved")).toBeNull();
  });
});
