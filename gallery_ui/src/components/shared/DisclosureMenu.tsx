import { useEffect, useRef, type ReactNode } from "react";

interface DisclosureMenuProps {
  label: string;
  icon: ReactNode;
  children: ReactNode;
  className?: string;
  closeOnAction?: boolean;
  tourId?: string;
}

/** Native disclosure: keyboard-operable trigger, ordinary tabbable controls.
 * Deliberately not role=menu (which would require a roving arrow-key model).
 */
export const DisclosureMenu = ({ label, icon, children, className = "", closeOnAction = true, tourId }: DisclosureMenuProps) => {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: Event) => {
      const element = ref.current;
      if (!element?.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        element.open = false;
        element.querySelector("summary")?.focus();
      } else if (event.target instanceof Node && !element.contains(event.target)) {
        element.open = false;
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  return (
    <details ref={ref} className={`ue-disclosure-menu ${className}`}>
      <summary data-tour-id={tourId} aria-label={label} title={label}>{icon}</summary>
      <div className="ue-disclosure-panel" aria-label={label} onClick={(event) => {
        if (closeOnAction && event.target instanceof Element && event.target.closest("button")) {
          if (ref.current) {
            ref.current.open = false;
            ref.current.querySelector("summary")?.focus();
          }
        }
      }}>{children}</div>
    </details>
  );
};
