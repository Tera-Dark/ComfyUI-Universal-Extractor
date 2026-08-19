import { type ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";

export interface FloatingMenuPosition {
  x: number;
  y: number;
}

export interface FloatingMenuSize {
  width: number;
  height: number;
}

export type MenuPlacementMode = "pointer" | "target";

const defaultMargin = 12;
const defaultGap = 10;

export const isEditableTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement && Boolean(target.closest("input, textarea, select, [contenteditable='true']"));

export const placeFloatingMenu = (
  clientX: number,
  clientY: number,
  { width, height }: FloatingMenuSize,
  viewport: { width: number; height: number } = { width: window.innerWidth, height: window.innerHeight },
): FloatingMenuPosition => {
  const x = clientX + width > viewport.width - defaultMargin
    ? Math.max(defaultMargin, clientX - width)
    : Math.max(defaultMargin, clientX);
  const y = clientY + height > viewport.height - defaultMargin
    ? Math.max(defaultMargin, clientY - height)
    : Math.max(defaultMargin, clientY);
  return { x, y };
};

export const placeMenuNearRect = (
  rect: Pick<DOMRect, "top" | "left" | "right">,
  { width, height }: FloatingMenuSize,
  viewport: { width: number; height: number } = { width: window.innerWidth, height: window.innerHeight },
): FloatingMenuPosition => {
  const hasRightSpace = rect.right + defaultGap + width <= viewport.width - defaultMargin;
  const x = hasRightSpace
    ? rect.right + defaultGap
    : Math.max(defaultMargin, rect.left - defaultGap - width);
  const y = Math.min(
    Math.max(defaultMargin, rect.top),
    Math.max(defaultMargin, viewport.height - height - defaultMargin),
  );
  return { x, y };
};

export const placeMenuForEvent = (
  event: { clientX: number; clientY: number; currentTarget?: EventTarget | null },
  size: FloatingMenuSize,
  mode: MenuPlacementMode = "target",
) => {
  if (mode === "pointer") {
    return placeFloatingMenu(event.clientX, event.clientY, size);
  }
  const rect = event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : null;
  return rect ? placeMenuNearRect(rect, size) : placeFloatingMenu(event.clientX, event.clientY, size);
};

export const FloatingLayerPortal = ({ children }: { children: ReactNode }) => {
  if (typeof document === "undefined") {
    return null;
  }
  return createPortal(children, document.body);
};

export const useDismissableLayer = (
  active: boolean,
  onDismiss: () => void,
  options: { closeOnContextMenu?: boolean; closeOnScroll?: boolean } = {},
) => {
  useEffect(() => {
    if (!active) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onDismiss();
      }
    };

    const handleScroll = (event: Event) => {
      if (
        event.target instanceof HTMLElement &&
        (event.target.closest(".ue-update-popover") ||
          event.target.closest(".ue-floating-layer") ||
          event.target.closest(".ue-filter-popover") ||
          event.target.closest(".ue-select-field__menu") ||
          event.target.closest(".ue-context-menu"))
      ) {
        return;
      }
      onDismiss();
    };

    window.addEventListener("click", onDismiss);
    window.addEventListener("resize", onDismiss);
    window.addEventListener("keydown", handleKeyDown);
    if (options.closeOnContextMenu) {
      window.addEventListener("contextmenu", onDismiss);
    }
    if (options.closeOnScroll) {
      window.addEventListener("scroll", handleScroll, true);
    }

    return () => {
      window.removeEventListener("click", onDismiss);
      window.removeEventListener("resize", onDismiss);
      window.removeEventListener("keydown", handleKeyDown);
      if (options.closeOnContextMenu) {
        window.removeEventListener("contextmenu", onDismiss);
      }
      if (options.closeOnScroll) {
        window.removeEventListener("scroll", handleScroll, true);
      }
    };
  }, [active, onDismiss, options.closeOnContextMenu, options.closeOnScroll]);
};
