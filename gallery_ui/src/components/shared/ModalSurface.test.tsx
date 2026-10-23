import { useState } from "react";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ModalSurface } from "./ModalSurface";
import { ConfirmProvider, useConfirm } from "./ConfirmDialog";
import { I18nProvider } from "../../i18n/I18nProvider";

const NestedConfirmation = () => {
  const { confirm } = useConfirm();
  return <button onClick={() => void confirm({ title: "Confirm nested action", message: "Keep the parent editor open" })}>Nested action</button>;
};
const Harness = ({ closed = () => {}, busy = false }: { closed?: () => void; busy?: boolean }) => {
  const [open, setOpen] = useState(false);
  return <><button onClick={() => setOpen(true)}>Open editor</button>{open && <ModalSurface title="Editor" className="ue-library-modal" onClose={() => { closed(); setOpen(false); }} closeDisabled={busy}>
    <button>First</button><details><summary>Advanced</summary><input aria-label="Hidden option" /></details><NestedConfirmation /><button>Last</button>
  </ModalSurface>}</>;
};
const mount = (closed = vi.fn(), busy = false) => render(<I18nProvider><ConfirmProvider><Harness closed={closed} busy={busy} /></ConfirmProvider></I18nProvider>);

describe("shared light modal interaction", () => {
  it("keeps Tab inside the modal and restores the opener after Escape", async () => {
    mount(); const opener = screen.getByRole("button", { name: "Open editor" });
    await userEvent.click(opener);
    const dialog = screen.getByRole("dialog", { name: "Editor" }); expect(dialog).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true }); expect(screen.getByRole("button", { name: "Last" })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: "Tab" }); expect(screen.getByRole("button", { name: "First" })).toHaveFocus();
    fireEvent.keyDown(dialog, { key: "Escape" }); expect(screen.queryByRole("dialog")).toBeNull(); expect(opener).toHaveFocus();
  });
  it("gives a nested confirmation keyboard ownership without closing its parent", async () => {
    const closed = vi.fn(); mount(closed);
    await userEvent.click(screen.getByRole("button", { name: "Open editor" }));
    await userEvent.click(screen.getByRole("button", { name: "Nested action" }));
    const confirmation = screen.getByRole("alertdialog");
    fireEvent.keyDown(within(confirmation).getByRole("button", { name: "取消" }), { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull(); expect(screen.getByRole("dialog", { name: "Editor" })).toBeInTheDocument(); expect(closed).not.toHaveBeenCalled();
  });
  it("does not dismiss a submitting form through Escape or the backdrop", async () => {
    const closed = vi.fn(); mount(closed, true);
    await userEvent.click(screen.getByRole("button", { name: "Open editor" }));
    const dialog = screen.getByRole("dialog"); fireEvent.keyDown(dialog, { key: "Escape" }); fireEvent.click(dialog.parentElement!);
    expect(closed).not.toHaveBeenCalled(); expect(dialog).toBeInTheDocument();
  });
  it("ignores a drag starting inside the editor but permits a deliberate backdrop click", async () => {
    const closed = vi.fn(); mount(closed);
    await userEvent.click(screen.getByRole("button", { name: "Open editor" }));
    const dialog = screen.getByRole("dialog"), backdrop = dialog.parentElement!;
    fireEvent.pointerDown(within(dialog).getByRole("button", { name: "First" })); fireEvent.click(backdrop);
    expect(closed).not.toHaveBeenCalled();
    await userEvent.click(backdrop); expect(closed).toHaveBeenCalledOnce();
  });
});
