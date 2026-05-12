import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "../../i18n/I18nProvider";
import { OperationStatusProvider } from "./OperationStatusCenter";
import { ToastProvider, useToast } from "./ToastViewport";

const ToastHarness = () => {
  const { pushToast } = useToast();
  return <button onClick={() => pushToast("Saved", "success")}>Notify</button>;
};

describe("ToastProvider", () => {
  it("renders and dismisses toast messages", async () => {
    render(
      <I18nProvider>
        <OperationStatusProvider>
          <ToastProvider>
            <ToastHarness />
          </ToastProvider>
        </OperationStatusProvider>
      </I18nProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Notify" }));
    expect(screen.getByText("Saved")).not.toBeNull();
    expect(document.querySelector(".ue-toast-viewport")).toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "关闭提醒" }));
    expect(screen.queryByText("Saved")).toBeNull();
  });
});
