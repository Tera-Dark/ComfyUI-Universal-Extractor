import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DisclosureMenu } from "./DisclosureMenu";

describe("DisclosureMenu", () => {
  it("closes after an action and restores focus to its trigger", () => {
    const action = vi.fn();
    const { container } = render(<DisclosureMenu label="More" icon={<span>…</span>}><button onClick={action}>Organize</button></DisclosureMenu>);
    const trigger = screen.getByLabelText("More", { selector: "summary" });
    fireEvent.click(trigger);
    expect(container.querySelector("details")).toHaveAttribute("open");
    fireEvent.click(screen.getByRole("button", { name: "Organize" }));
    expect(action).toHaveBeenCalledOnce();
    expect(container.querySelector("details")).not.toHaveAttribute("open");
    expect(trigger).toHaveFocus();
  });
  it("dismisses with Escape and pointer outside", () => {
    const { container } = render(<DisclosureMenu label="More" icon={<span>…</span>}><button>Organize</button></DisclosureMenu>);
    const trigger = screen.getByLabelText("More", { selector: "summary" });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(container.querySelector("details")).not.toHaveAttribute("open");
    fireEvent.click(trigger);
    fireEvent.pointerDown(document.body);
    expect(container.querySelector("details")).not.toHaveAttribute("open");
  });
});
