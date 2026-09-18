import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";
import { useI18n } from "../../i18n/I18nProvider";
import type { WorkspaceTab } from "../../types/universal-gallery";
import { placeTourCard, tourCardMaxHeight, type TourRect } from "./tourPosition";

interface OnboardingTourProps {
  open: boolean;
  onRequestTabChange: (tab: WorkspaceTab) => void;
  onRequestSidebarOpen: () => void;
  onRequestSidebarClose?: () => void;
  onSkip: () => void;
  onComplete: () => void;
}
interface Step { id: string; target?: string; tab?: WorkspaceTab; sidebar?: boolean; title: string; body: string }
const steps: Step[] = [
  { id: "welcome", title: "tourWelcomeTitle", body: "tourWelcomeBody" },
  { id: "topbar", target: "workspace-switcher", title: "tourTopbarTitle", body: "tourTopbarBody" },
  { id: "sidebar", target: "sidebar-folders", tab: "gallery", sidebar: true, title: "tourSidebarTitle", body: "tourSidebarBody" },
  { id: "gallery", target: "gallery-search", tab: "gallery", title: "tourGalleryTitle", body: "tourGalleryBody" },
  { id: "density", target: "gallery-density", tab: "gallery", title: "tourDensityTitle", body: "tourDensityBody" },
  { id: "selection", target: "gallery-selection", tab: "gallery", title: "tourSelectionTitle", body: "tourSelectionBody" },
  { id: "detail", target: "gallery-card", tab: "gallery", title: "tourDetailTitle", body: "tourDetailBody" },
  { id: "library", target: "library-actions", tab: "library", title: "tourLibraryTitle", body: "tourLibraryBody" },
  { id: "workbench", target: "workbench-generator", tab: "workbench", title: "tourWorkbenchTitle", body: "tourWorkbenchBody" },
  { id: "settings", target: "settings-onboarding", tab: "settings", title: "tourSettingsTitle", body: "tourSettingsBody" },
  { id: "done", title: "tourDoneTitle", body: "tourDoneBody" },
];

export const OnboardingTour = (props: OnboardingTourProps) => {
  const { open, onSkip, onComplete } = props;
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<TourRect | null>(null);
  const [missing, setMissing] = useState(false);
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight });
  const [cardSize, setCardSize] = useState({ width: 352, height: 250 });
  const cardRef = useRef<HTMLElement>(null);
  const callbacks = useRef(props);
  useEffect(() => { callbacks.current = props; });
  const step = steps[index];

  useEffect(() => { if (!open) setIndex(0); }, [open]);

  // Modal semantics: portal remains interactive while the application is inert.
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const root = document.getElementById("root");
    const wasInert = root?.inert ?? false;
    if (root) root.inert = true;
    cardRef.current?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); callbacks.current.onSkip(); return; }
      if (event.key !== "Tab") return;
      const buttons = Array.from(cardRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
      const first = buttons[0], last = buttons[buttons.length - 1];
      if (!first) return;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === cardRef.current)) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === cardRef.current)) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      if (root) root.inert = wasInert;
      if (previous?.isConnected && !previous.closest("[inert]")) previous.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    setRect(null); setMissing(false);
    if (step.tab) callbacks.current.onRequestTabChange(step.tab);
    if (step.sidebar) callbacks.current.onRequestSidebarOpen();
    else if (window.innerWidth <= 960) callbacks.current.onRequestSidebarClose?.();
    let frame = 0;
    let scrolled = false;
    let disposed = false;
    let target: HTMLElement | null = null;
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => schedule()) : null;
    const measure = () => {
      frame = 0;
      if (disposed) return;
      const width = window.innerWidth, height = window.innerHeight;
      setViewport(old => old.width === width && old.height === height ? old : { width, height });
      const box = cardRef.current?.getBoundingClientRect();
      if (box?.height) setCardSize(old => old.width === box.width && old.height === box.height ? old : {width: box.width, height: box.height});
      const found = step.target ? document.querySelector<HTMLElement>(`[data-tour-id="${step.target}"]`) : null;
      if (found !== target) { if (target) observer?.unobserve(target); target = found; if (found) observer?.observe(found); }
      if (!found) { setRect(null); return; }
      let r = found.getBoundingClientRect();
      if (!r.width || !r.height) { setRect(null); return; }
      // Scroll once on step entry, never from a scroll/resize measurement callback.
      if (!scrolled) {
        scrolled = true;
        if (r.top < 65 || r.top > height * .55) {
          found.scrollIntoView?.({ block: "start", inline: "nearest", behavior: "instant" });
          r = found.getBoundingClientRect();
        }
      }
      const left = Math.max(8, r.left - 6), top = Math.max(8, r.top - 6);
      // Focus on the top of a large panel so the explanation has room below it.
      const next = {left, top, width: Math.max(0, Math.min(r.right + 6, width - 8) - left),
        height: Math.max(0, Math.min(r.bottom + 6, top + (step.id === "sidebar" ? 112 : 100), height - 8) - top)};
      if (!next.width || !next.height) { setRect(null); return; }
      setRect(old => old && Object.keys(next).every(k => Math.abs(old[k as keyof TourRect] - next[k as keyof TourRect]) < .5) ? old : next);
      setMissing(false);
    };
    function schedule() { if (!frame && !disposed) frame = window.requestAnimationFrame(measure); }
    const mutations = new MutationObserver(records => {
      if (records.some(record => !(record.target instanceof Element && record.target.closest(".ue-onboarding-layer")))) schedule();
    });
    mutations.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "open", "inert"] });
    if (cardRef.current) observer?.observe(cardRef.current);
    schedule();
    const unavailableTimer = window.setTimeout(() => setMissing(true), 1400);
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    document.addEventListener("transitionend", schedule, true);
    return () => {
      disposed = true; window.cancelAnimationFrame(frame); window.clearTimeout(unavailableTimer);
      observer?.disconnect(); mutations.disconnect();
      window.removeEventListener("resize", schedule); window.removeEventListener("scroll", schedule, true);
      document.removeEventListener("transitionend", schedule, true);
    };
  }, [open, step]);

  if (!open) return null;
  const pos = placeTourCard(rect, cardSize, viewport);
  const last = index === steps.length - 1;
  // SVG even-odd cutout dims the page without dimming the highlighted control.
  const hole = rect ? `M${rect.left},${rect.top}h${rect.width}v${rect.height}h-${rect.width}Z` : "";
  return createPortal(
    <div className="ue-onboarding-layer" role="dialog" aria-modal="true" aria-labelledby="ue-onboarding-title" aria-describedby="ue-onboarding-body">
      <svg className="ue-onboarding-scrim" aria-hidden="true" width="100%" height="100%">
        <path d={`M0,0H${viewport.width}V${viewport.height}H0Z ${hole}`} fillRule="evenodd" />
      </svg>
      {rect ? <div className="ue-onboarding-highlight" data-target={step.target} style={{left:rect.left, top:rect.top, width:rect.width, height:rect.height}} /> : null}
      <article ref={cardRef} tabIndex={-1} className="ue-onboarding-card" data-step={step.id} data-placement={pos.side} style={{left:pos.left, top:pos.top, maxHeight:tourCardMaxHeight(rect, cardSize.width, viewport)}}>
        <header className="ue-onboarding-progress">
          <span>{t("tourStepProgress", {page:index + 1, totalPages:steps.length})}</span>
          <button className="ue-onboarding-close" type="button" onClick={onSkip} aria-label={t("tourClose")}><X size={17}/></button>
        </header>
        <div className="ue-onboarding-meter" aria-hidden="true"><span style={{width:`${(index + 1) / steps.length * 100}%`}} /></div>
        <div className="ue-onboarding-content" aria-live="polite" aria-atomic="true">
          <h2 id="ue-onboarding-title">{t(step.title)}</h2>
          <p id="ue-onboarding-body">{t(step.body)}</p>
          {step.target && !rect && missing ? <small>{t("tourTargetMissing")}</small> : null}
        </div>
        <footer className="ue-onboarding-actions">
          <button type="button" className="ue-tour-skip" onClick={onSkip}>{t("tourSkip")}</button>
          <div>
            <button type="button" className="ue-tour-back" onClick={() => setIndex(i => Math.max(0, i - 1))} disabled={!index} aria-label={t("tourPrevious")}><ChevronLeft size={17}/></button>
            <button type="button" className="ue-tour-next" onClick={() => last ? onComplete() : setIndex(i => i + 1)}>
              <span>{t(last ? "tourFinish" : "tourNext")}</span>{last ? <Check size={16}/> : <ChevronRight size={16}/>}
            </button>
          </div>
        </footer>
      </article>
    </div>, document.body);
};
