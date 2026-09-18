import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n/I18nProvider";
import { OnboardingTour } from "./OnboardingTour";

const renderTour = (overrides: Partial<Parameters<typeof OnboardingTour>[0]> = {}) => {
  window.localStorage.setItem("universal-extractor-locale", "en");
  const props: Parameters<typeof OnboardingTour>[0] = {
    open: true,
    onRequestTabChange: vi.fn(),
    onRequestSidebarOpen: vi.fn(),
    onSkip: vi.fn(),
    onComplete: vi.fn(),
    ...overrides,
  };

  return {
    props,
    ...render(
      <I18nProvider>
        <OnboardingTour {...props} />
      </I18nProvider>,
    ),
  };
};

const createTourTarget = (id: string) => {
  const target = document.createElement("div");
  target.dataset.tourId = id;
  target.getBoundingClientRect = () => ({
    left: 40,
    top: 50,
    width: 180,
    height: 36,
    right: 220,
    bottom: 86,
    x: 40,
    y: 50,
    toJSON: () => ({}),
  });
  document.body.appendChild(target);
  return target;
};

describe("OnboardingTour", () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it("renders the welcome step and lets the user skip", async () => {
    const user = userEvent.setup();
    const { props } = renderTour();

    expect(screen.getByText("Welcome to Universal Gallery")).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: "Skip" })[0]);
    expect(props.onSkip).toHaveBeenCalledTimes(1);
  });

  it("shows a fallback card when a tour target is missing", async () => {
    const user = userEvent.setup();
    renderTour();

    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Move between workspaces")).toBeInTheDocument();
    expect(await screen.findByText("There is no visible target here yet, possibly because no images or library are loaded. You can continue to the next step.", {}, { timeout: 2500 })).toBeInTheDocument();
  });

  it("tracks a real target and requests cross-tab navigation", async () => {
    const user = userEvent.setup();
    createTourTarget("workspace-switcher");
    const { props } = renderTour();

    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(await screen.findByText("Move between workspaces")).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector(".ue-onboarding-highlight")).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Next" }));

    expect(props.onRequestSidebarOpen).toHaveBeenCalled();
    expect(props.onRequestTabChange).toHaveBeenCalledWith("gallery");
  });

  it("calls complete on the final step", async () => {
    const user = userEvent.setup();
    const { props } = renderTour();

    for (let index = 0; index < 10; index += 1) {
      await user.click(screen.getByRole("button", { name: "Next" }));
    }

    await user.click(screen.getByRole("button", { name: "Finish" }));
    expect(props.onComplete).toHaveBeenCalledTimes(1);
  });
  it("keeps keyboard focus inside the portal and restores inert on unmount", async () => {
    const root=document.createElement("div"); root.id="root"; document.body.appendChild(root);
    const {props,unmount}=renderTour();
    expect(root.inert).toBe(true);
    const next=screen.getByRole("button",{name:"Next"}); next.focus();
    fireEvent.keyDown(document,{key:"Tab"});
    expect(screen.getByRole("button",{name:"Close tour"})).toHaveFocus();
    fireEvent.keyDown(document,{key:"Escape"});expect(props.onSkip).toHaveBeenCalledTimes(1);
    unmount();expect(root.inert).toBe(false);root.remove();
  });

});
