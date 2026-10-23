import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { WorkspaceSearch } from "./WorkspaceSearch";

describe("workspace search", () => {
  it("commits composed text only when the IME finishes", () => {
    const onChange = vi.fn();
    render(<WorkspaceSearch value="" onChange={onChange} placeholder="Search entries" clearLabel="Clear" />);
    const input = screen.getByRole("textbox");
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: "画师" } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.compositionEnd(input, { target: { value: "画师" } });
    expect(onChange).toHaveBeenCalledExactlyOnceWith("画师");
  });
  it("supports Gallery shortcuts, leaves typing alone and restores focus after clearing", async () => {
    const onChange = vi.fn();
    render(<><WorkspaceSearch value="portrait" onChange={onChange} placeholder="Search entries" clearLabel="Clear" /><textarea aria-label="Draft" /></>);
    const input = screen.getByRole("textbox", { name: "Search entries" });
    fireEvent.keyDown(window, { key: "/" });
    expect(input).toHaveFocus();
    const draft = screen.getByRole("textbox", { name: "Draft" });
    draft.focus(); fireEvent.keyDown(draft, { key: "/" });
    expect(draft).toHaveFocus();
    fireEvent.keyDown(window, { key: "k", ctrlKey: true }); expect(input).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenLastCalledWith(""); expect(input).toHaveFocus();
  });
});
