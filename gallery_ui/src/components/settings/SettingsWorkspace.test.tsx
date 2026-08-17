import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n/I18nProvider";
import type { GallerySource, UiPreferences } from "../../types/universal-gallery";
import { ConfirmProvider } from "../shared/ConfirmDialog";
import { OperationStatusProvider } from "../shared/OperationStatusCenter";
import { SettingsWorkspace } from "./SettingsWorkspace";

const preferences: UiPreferences = {
  defaultSelectionMode: false,
  confirmWorkflowSend: true,
  collapseSidebarOnLaunch: false,
  enableImagePrefetch: true,
  enableLiveGalleryRefresh: true,
  defaultFolderTreeView: true,
};

const sources: GallerySource[] = [
  {
    id: "default_output",
    name: "Output",
    kind: "output",
    path: "D:/ComfyUI/output",
    enabled: true,
    writable: true,
    recursive: true,
    import_target: true,
    exists: true,
    image_count: 12,
  },
];

const renderSettings = (overrides: Partial<Parameters<typeof SettingsWorkspace>[0]> = {}) => {
  window.localStorage.setItem("universal-extractor-locale", "en");
  const props: Parameters<typeof SettingsWorkspace>[0] = {
    sources,
    preferences,
    onPreferencesChange: vi.fn(),
    onSourcesChange: vi.fn(),
    onRestartOnboarding: vi.fn(),
    ...overrides,
  };

  return {
    props,
    ...render(
      <I18nProvider>
        <ConfirmProvider>
          <OperationStatusProvider>
            <SettingsWorkspace {...props} />
          </OperationStatusProvider>
        </ConfirmProvider>
      </I18nProvider>,
    ),
  };
};

describe("SettingsWorkspace onboarding entry", () => {
  it("exposes a restart button for the onboarding tour", async () => {
    const user = userEvent.setup();
    const { props } = renderSettings();

    await user.click(screen.getByRole("button", { name: "Restart onboarding tour" }));

    expect(props.onRestartOnboarding).toHaveBeenCalledTimes(1);
  });
});
