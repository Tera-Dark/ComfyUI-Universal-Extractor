import { describe, expect, it } from "vitest";

import {
  ONBOARDING_TOUR_COMPLETED_KEY,
  isOnboardingTourCompleted,
  markOnboardingTourCompleted,
} from "./onboardingTourModel";

describe("onboardingTourModel", () => {
  it("treats missing localStorage state as not completed", () => {
    expect(isOnboardingTourCompleted()).toBe(false);
  });

  it("persists completed state for future app launches", () => {
    markOnboardingTourCompleted();

    expect(window.localStorage.getItem(ONBOARDING_TOUR_COMPLETED_KEY)).toBe("true");
    expect(isOnboardingTourCompleted()).toBe(true);
  });
});
