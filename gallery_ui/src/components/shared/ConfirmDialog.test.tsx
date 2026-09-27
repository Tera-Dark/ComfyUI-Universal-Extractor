import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "../../i18n/I18nProvider";
import { ConfirmProvider, useConfirm } from "./ConfirmDialog";

const ConfirmHarness = () => {
  const { confirm, choose } = useConfirm();
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
      <button onClick={async () => setResult(await choose({
        title: "Unsaved edits",
        message: "What would you like to do?",
        confirmLabel: "Save and continue",
        alternativeLabel: "Discard changes",
        cancelLabel: "Keep editing",
        tone: "warning",
      }))}>Choose</button>
      <button onClick={async () => setResult(await choose({
        title: "Loading edits",
        message: "Wait before saving.",
        confirmLabel: "Save and continue",
        confirmDisabled: true,
        alternativeLabel: "Discard changes",
      }))}>Choose while loading</button>
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
  it("focuses the safe action, cancels with Escape and restores trigger focus", async () => {
    const user=userEvent.setup();
    render(<I18nProvider><ConfirmProvider><ConfirmHarness/></ConfirmProvider></I18nProvider>);
    const ask=screen.getByRole("button",{name:"Ask"});
    await user.click(ask);
    expect(screen.getByRole("button",{name:"Keep"})).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByTestId("result")).toHaveTextContent("false");
    expect(ask).toHaveFocus();
  });

  it.each([
    ["Keep editing", "cancel"],
    ["Discard changes", "alternative"],
    ["Save and continue", "confirm"],
  ])("returns %s from the three-choice unsaved-edit dialog", async (button, expected) => {
    const user = userEvent.setup();
    render(<I18nProvider><ConfirmProvider><ConfirmHarness /></ConfirmProvider></I18nProvider>);
    await user.click(screen.getByRole("button", { name: "Choose" }));
    expect(screen.getByRole("button", { name: "Keep editing" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: button }));
    expect(screen.getByTestId("result")).toHaveTextContent(expected);
  });

  it("prevents saving before metadata is ready but still permits cancellation or discard", async () => {
    const user = userEvent.setup();
    render(<I18nProvider><ConfirmProvider><ConfirmHarness /></ConfirmProvider></I18nProvider>);
    await user.click(screen.getByRole("button", { name: "Choose while loading" }));
    expect(screen.getByRole("button", { name: "Save and continue" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.getByTestId("result")).toHaveTextContent("alternative");
  });
});
