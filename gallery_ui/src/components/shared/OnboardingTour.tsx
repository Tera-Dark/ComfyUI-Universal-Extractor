import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Check, ChevronLeft, ChevronRight, X } from "lucide-react";

import { useI18n } from "../../i18n/I18nProvider";
import type { WorkspaceTab } from "../../types/universal-gallery";

interface OnboardingTourProps {
  open: boolean;
  onRequestTabChange: (tab: WorkspaceTab) => void;
  onRequestSidebarOpen: () => void;
  onSkip: () => void;
  onComplete: () => void;
}

interface OnboardingStep {
  id: string;
  targetId?: string;
  tab?: WorkspaceTab;
  expandSidebar?: boolean;
  placement?: TourPlacement;
  padding?: number;
  minWidth?: number;
  minHeight?: number;
  titleKey: string;
  bodyKey: string;
}

interface HighlightRect {
  targetId: string;
  left: number;
  top: number;
  width: number;
  height: number;
}

type TourPlacement = "top" | "right" | "bottom" | "left" | "center";

const TARGET_PADDING = 14;
const CARD_WIDTH = 430;
const CARD_HEIGHT_ESTIMATE = 318;
const CARD_GAP = 26;
const VIEWPORT_EDGE = 24;

const getTourSteps = (): OnboardingStep[] => [
  { id: "welcome", titleKey: "tourWelcomeTitle", bodyKey: "tourWelcomeBody" },
  { id: "topbar", targetId: "topbar-tabs", placement: "bottom", padding: 10, minHeight: 54, titleKey: "tourTopbarTitle", bodyKey: "tourTopbarBody" },
  { id: "sidebar", targetId: "sidebar-folders", placement: "right", expandSidebar: true, titleKey: "tourSidebarTitle", bodyKey: "tourSidebarBody" },
  { id: "gallery", targetId: "gallery-toolbar", placement: "bottom", tab: "gallery", titleKey: "tourGalleryTitle", bodyKey: "tourGalleryBody" },
  { id: "selection", targetId: "gallery-selection", placement: "left", minWidth: 70, minHeight: 70, tab: "gallery", titleKey: "tourSelectionTitle", bodyKey: "tourSelectionBody" },
  { id: "detail", targetId: "gallery-workflow", placement: "left", minWidth: 70, minHeight: 70, tab: "gallery", titleKey: "tourDetailTitle", bodyKey: "tourDetailBody" },
  { id: "library", targetId: "library-actions", placement: "bottom", tab: "library", titleKey: "tourLibraryTitle", bodyKey: "tourLibraryBody" },
  { id: "workbench", targetId: "workbench-generator", placement: "left", tab: "workbench", titleKey: "tourWorkbenchTitle", bodyKey: "tourWorkbenchBody" },
  { id: "settings", targetId: "settings-onboarding", placement: "top", tab: "settings", titleKey: "tourSettingsTitle", bodyKey: "tourSettingsBody" },
  { id: "done", titleKey: "tourDoneTitle", bodyKey: "tourDoneBody" },
];

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const getHighlightRect = (step: OnboardingStep): HighlightRect | null => {
  if (!step.targetId) {
    return null;
  }
  const element = document.querySelector<HTMLElement>(`[data-tour-id="${step.targetId}"]`);
  if (!element) {
    return null;
  }
  element.scrollIntoView?.({ block: "center", inline: "center", behavior: "smooth" });
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }
  const padding = step.padding ?? TARGET_PADDING;
  const rawWidth = rect.width + padding * 2;
  const rawHeight = rect.height + padding * 2;
  const width = Math.max(rawWidth, step.minWidth ?? 0);
  const height = Math.max(rawHeight, step.minHeight ?? 0);
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  return {
    targetId: step.targetId,
    left: clamp(centerX - width / 2, TARGET_PADDING, Math.max(TARGET_PADDING, window.innerWidth - width - TARGET_PADDING)),
    top: clamp(centerY - height / 2, TARGET_PADDING, Math.max(TARGET_PADDING, window.innerHeight - height - TARGET_PADDING)),
    width: Math.min(window.innerWidth - TARGET_PADDING * 2, width),
    height: Math.min(window.innerHeight - TARGET_PADDING * 2, height),
  };
};

const getCandidatePosition = (rect: HighlightRect, placement: TourPlacement) => {
  if (placement === "right") {
    return {
      left: rect.left + rect.width + CARD_GAP,
      top: rect.top + rect.height / 2 - CARD_HEIGHT_ESTIMATE / 2,
    };
  }
  if (placement === "left") {
    return {
      left: rect.left - CARD_WIDTH - CARD_GAP,
      top: rect.top + rect.height / 2 - CARD_HEIGHT_ESTIMATE / 2,
    };
  }
  if (placement === "bottom") {
    return {
      left: rect.left + rect.width / 2 - CARD_WIDTH / 2,
      top: rect.top + rect.height + CARD_GAP,
    };
  }
  if (placement === "top") {
    return {
      left: rect.left + rect.width / 2 - CARD_WIDTH / 2,
      top: rect.top - CARD_HEIGHT_ESTIMATE - CARD_GAP,
    };
  }
  return {
    left: window.innerWidth / 2 - CARD_WIDTH / 2,
    top: window.innerHeight / 2 - CARD_HEIGHT_ESTIMATE / 2,
  };
};

const getCardPosition = (rect: HighlightRect | null, preferredPlacement: TourPlacement = "right") => {
  if (!rect || window.innerWidth < 760) {
    return {
      placement: "center" as TourPlacement,
      style: {
        left: "50%",
        top: "50%",
        transform: "translate(-50%, -50%)",
      } satisfies CSSProperties,
    };
  }

  const placements = [
    preferredPlacement,
    "right",
    "left",
    "bottom",
    "top",
  ].filter((placement, index, all): placement is TourPlacement => all.indexOf(placement) === index);

  const fits = ({ left, top }: { left: number; top: number }) =>
    left >= VIEWPORT_EDGE &&
    top >= VIEWPORT_EDGE &&
    left + CARD_WIDTH <= window.innerWidth - VIEWPORT_EDGE &&
    top + CARD_HEIGHT_ESTIMATE <= window.innerHeight - VIEWPORT_EDGE;

  const selectedPlacement = placements.find((placement) => fits(getCandidatePosition(rect, placement))) ?? preferredPlacement;
  const candidate = getCandidatePosition(rect, selectedPlacement);
  const left = clamp(candidate.left, VIEWPORT_EDGE, Math.max(VIEWPORT_EDGE, window.innerWidth - CARD_WIDTH - VIEWPORT_EDGE));
  const top = clamp(candidate.top, VIEWPORT_EDGE, Math.max(VIEWPORT_EDGE, window.innerHeight - CARD_HEIGHT_ESTIMATE - VIEWPORT_EDGE));

  return {
    placement: selectedPlacement,
    style: {
      left: `${left}px`,
      top: `${top}px`,
      transform: "none",
    } satisfies CSSProperties,
  };
};

export const OnboardingTour = ({
  open,
  onRequestTabChange,
  onRequestSidebarOpen,
  onSkip,
  onComplete,
}: OnboardingTourProps) => {
  const { t } = useI18n();
  const steps = useMemo(() => getTourSteps(), []);
  const [stepIndex, setStepIndex] = useState(0);
  const [highlightRect, setHighlightRect] = useState<HighlightRect | null>(null);
  const [isResolvingTarget, setIsResolvingTarget] = useState(false);
  const step = steps[stepIndex];
  const isLastStep = stepIndex === steps.length - 1;

  useEffect(() => {
    if (!open) {
      setStepIndex(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }
    setHighlightRect(null);
    setIsResolvingTarget(Boolean(step.targetId));
    if (step.tab) {
      onRequestTabChange(step.tab);
    }
    if (step.expandSidebar) {
      onRequestSidebarOpen();
    }

    let disposed = false;
    const updateRect = () => {
      if (disposed) {
        return;
      }
      setHighlightRect(getHighlightRect(step));
      setIsResolvingTarget(false);
    };

    const animationFrame = window.requestAnimationFrame(updateRect);
    const timers = [80, 180, 340].map((delay) => window.setTimeout(updateRect, delay));
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);

    return () => {
      disposed = true;
      window.cancelAnimationFrame(animationFrame);
      timers.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  }, [onRequestSidebarOpen, onRequestTabChange, open, step]);

  if (!open) {
    return null;
  }

  const goPrevious = () => setStepIndex((current) => Math.max(0, current - 1));
  const goNext = () => {
    if (isLastStep) {
      onComplete();
      return;
    }
    setStepIndex((current) => Math.min(steps.length - 1, current + 1));
  };
  const currentHighlightRect = highlightRect?.targetId === step.targetId ? highlightRect : null;
  const cardPosition = getCardPosition(currentHighlightRect, step.placement);
  const showHighlight = Boolean(currentHighlightRect && step.targetId && window.innerWidth >= 760);
  const isPositioning = Boolean(step.targetId && isResolvingTarget && !currentHighlightRect);

  return (
    <div className="ue-onboarding-layer" role="dialog" aria-modal="true" aria-labelledby="ue-onboarding-title">
      <div className={`ue-onboarding-scrim ${showHighlight ? "is-cutout" : "is-dimmed"}`} />
      {showHighlight && currentHighlightRect ? (
        <div
          className="ue-onboarding-highlight"
          style={{
            left: `${currentHighlightRect.left}px`,
            top: `${currentHighlightRect.top}px`,
            width: `${currentHighlightRect.width}px`,
            height: `${currentHighlightRect.height}px`,
          }}
        />
      ) : null}
      <article
        className={`ue-onboarding-card ${showHighlight ? `is-${cardPosition.placement}` : "is-centered"} ${isPositioning ? "is-positioning" : ""}`}
        style={cardPosition.style}
      >
        <button className="ue-onboarding-close" type="button" onClick={onSkip} aria-label={t("tourSkip")}>
          <X size={15} />
        </button>
        <div className="ue-onboarding-content" key={step.id}>
          <div className="ue-onboarding-progress">
            <span>{t("tourStepProgress", { page: stepIndex + 1, totalPages: steps.length })}</span>
            <div>
              {steps.map((item, index) => (
                <i key={item.id} className={index <= stepIndex ? "active" : ""} />
              ))}
            </div>
          </div>
          <h2 id="ue-onboarding-title">{t(step.titleKey)}</h2>
          <p>{t(step.bodyKey)}</p>
          {step.targetId && !currentHighlightRect && !isResolvingTarget ? <small>{t("tourTargetMissing")}</small> : null}
        </div>
        <div className="ue-onboarding-actions">
          <button className="ue-secondary-action" type="button" onClick={onSkip}>
            <span>{t("tourSkip")}</span>
          </button>
          <div>
            <button className="ue-icon-action" type="button" onClick={goPrevious} disabled={stepIndex === 0} aria-label={t("tourPrevious")}>
              <ChevronLeft size={15} />
            </button>
            <button className="ue-primary-action" type="button" onClick={goNext}>
              <span>{isLastStep ? t("tourFinish") : t("tourNext")}</span>
              {isLastStep ? <Check size={15} /> : <ChevronRight size={15} />}
            </button>
          </div>
        </div>
      </article>
    </div>
  );
};
