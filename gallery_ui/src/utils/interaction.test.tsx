import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  isEditableTarget,
  placeFloatingMenu,
  placeMenuForEvent,
  placeMenuNearRect,
  useDismissableLayer,
} from "./interaction";

const DismissableProbe = ({
  active,
  onDismiss,
  closeOnContextMenu,
  closeOnScroll,
}: {
  active: boolean;
  onDismiss: () => void;
  closeOnContextMenu?: boolean;
  closeOnScroll?: boolean;
}) => {
  useDismissableLayer(active, onDismiss, { closeOnContextMenu, closeOnScroll });
  return <button type="button">probe</button>;
};

describe("interaction utilities", () => {
  it("places floating menus at the pointer when there is enough space", () => {
    expect(placeFloatingMenu(40, 50, { width: 120, height: 80 }, { width: 500, height: 400 })).toEqual({
      x: 40,
      y: 50,
    });
  });

  it("flips floating menus away from viewport edges", () => {
    expect(placeFloatingMenu(480, 390, { width: 120, height: 80 }, { width: 500, height: 400 })).toEqual({
      x: 360,
      y: 310,
    });
  });

  it("places rect-anchored menus beside the trigger when space allows", () => {
    expect(placeMenuNearRect({ left: 100, right: 250, top: 80 }, { width: 292, height: 430 }, { width: 900, height: 700 }))
      .toEqual({ x: 260, y: 80 });
  });

  it("places event menus at the pointer when pointer placement is requested", () => {
    const trigger = document.createElement("button");
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      x: 100,
      y: 80,
      left: 100,
      top: 80,
      right: 250,
      bottom: 120,
      width: 150,
      height: 40,
      toJSON: () => undefined,
    } as DOMRect);

    expect(placeMenuForEvent({ clientX: 40, clientY: 50, currentTarget: trigger }, { width: 120, height: 80 }, "pointer"))
      .toEqual({ x: 40, y: 50 });
  });

  it("keeps event menu target placement compatible by default", () => {
    const trigger = document.createElement("button");
    vi.spyOn(trigger, "getBoundingClientRect").mockReturnValue({
      x: 100,
      y: 80,
      left: 100,
      top: 80,
      right: 250,
      bottom: 120,
      width: 150,
      height: 40,
      toJSON: () => undefined,
    } as DOMRect);

    expect(placeMenuForEvent({ clientX: 40, clientY: 50, currentTarget: trigger }, { width: 292, height: 430 }))
      .toEqual({ x: 260, y: 80 });
  });

  it("flips rect-anchored menus to the left when the right side is cramped", () => {
    expect(placeMenuNearRect({ left: 360, right: 490, top: 90 }, { width: 292, height: 430 }, { width: 500, height: 700 }))
      .toEqual({ x: 58, y: 90 });
  });

  it("clamps rect-anchored menu height inside the viewport", () => {
    expect(placeMenuNearRect({ left: 20, right: 100, top: 680 }, { width: 160, height: 120 }, { width: 500, height: 720 }))
      .toEqual({ x: 110, y: 588 });
  });

  it("detects editable keyboard targets", () => {
    render(
      <div>
        <input aria-label="input" />
        <textarea aria-label="textarea" />
        <select aria-label="select" />
        <div data-testid="editable" contentEditable />
        <button type="button">button</button>
      </div>,
    );

    expect(isEditableTarget(screen.getByLabelText("input"))).toBe(true);
    expect(isEditableTarget(screen.getByLabelText("textarea"))).toBe(true);
    expect(isEditableTarget(screen.getByLabelText("select"))).toBe(true);
    expect(isEditableTarget(screen.getByTestId("editable"))).toBe(true);
    expect(isEditableTarget(screen.getByRole("button"))).toBe(false);
  });

  it("dismisses an active layer on Escape, click, resize, contextmenu, and scroll", () => {
    const onDismiss = vi.fn();
    render(
      <DismissableProbe
        active
        onDismiss={onDismiss}
        closeOnContextMenu
        closeOnScroll
      />,
    );

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(window);
    fireEvent.resize(window);
    fireEvent.contextMenu(window);
    fireEvent.scroll(window);

    expect(onDismiss).toHaveBeenCalledTimes(5);
  });

  it("does not attach dismiss handlers while inactive", () => {
    const onDismiss = vi.fn();
    render(<DismissableProbe active={false} onDismiss={onDismiss} />);

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.click(window);
    fireEvent.resize(window);

    expect(onDismiss).not.toHaveBeenCalled();
  });
});
