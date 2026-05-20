export const ONBOARDING_TOUR_COMPLETED_KEY = "universal-extractor:onboarding-tour-v1-completed";

export const isOnboardingTourCompleted = () => {
  try {
    return window.localStorage.getItem(ONBOARDING_TOUR_COMPLETED_KEY) === "true";
  } catch {
    return false;
  }
};

export const markOnboardingTourCompleted = () => {
  try {
    window.localStorage.setItem(ONBOARDING_TOUR_COMPLETED_KEY, "true");
  } catch {
    // Local storage can fail in privacy modes; skipping persistence is safer than blocking the UI.
  }
};
