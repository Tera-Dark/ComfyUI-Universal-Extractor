import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "../../i18n/I18nProvider";
import { ConfirmProvider, useConfirm } from "./ConfirmDialog";

const ConfirmHarness = () => {
  const { confirm } = useConfirm();
  const [result, setResult] = useState("pending");
  return (
    <div>
      <button
        onClick={async () => {
          const approved = await confirm({
            title: "Delete image",
            message: "This action moves the image to trash.",
            confirmLabel: "Delete",
            cancelLabel: "Keep",
            tone: "warning",
          });
          setResult(String(approved));
        }}
      >
        Ask
      </button>
      <span data-testid="result">{result}</span>
    </div>
  );
};

describe("ConfirmProvider", () => {
  it("resolves confirmation requests from the modal action", async () => {
    render(
      <I18nProvider>
        <ConfirmProvider>
          <ConfirmHarness />
        </ConfirmProvider>
      </I18nProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Ask" }));
    expect(screen.getByText("Delete image")).not.toBeNull();

    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(screen.getByTestId("result").textContent).toBe("true");
    expect(screen.queryByText("Delete image")).toBeNull();
  });

  it("renders confirmation with the shared backdrop and modal classes", async () => {
    render(
      <I18nProvider>
        <ConfirmProvider>
          <ConfirmHarness />
        </ConfirmProvider>
      </I18nProvider>,
    );

    await userEvent.click(screen.getByRole("button", { name: "Ask" }));

    const backdrop = document.querySelector(".ue-confirm-backdrop");
    const modal = document.querySelector(".ue-confirm-modal");

    expect(backdrop).toHaveClass("ue-modal-backdrop");
    expect(modal).toHaveClass("ue-dialog-modal");
  });
});
