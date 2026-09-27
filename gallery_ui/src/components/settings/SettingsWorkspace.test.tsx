import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n/I18nProvider";
import type { GallerySource, UiPreferences } from "../../types/universal-gallery";
import { ConfirmProvider } from "../shared/ConfirmDialog";
import { OperationStatusProvider } from "../shared/OperationStatusCenter";
import { SettingsWorkspace } from "./SettingsWorkspace";

const preferences: UiPreferences = {
  defaultSelectionMode: false,
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
  it("keeps a new source editable instead of jumping back to the default source", async () => {
    renderSettings();
    await userEvent.click(screen.getByRole("button",{name:"Add custom source"}));
    const name=screen.getByPlaceholderText("Reference drive / archive folder");
    expect(name).toHaveValue("");
    await userEvent.type(name,"Archive");
    expect(name).toHaveValue("Archive");
    expect(screen.getByText("Unsaved changes")).toBeInTheDocument();
  });
  it("warns before discarding source edits and preserves them on cancel", async () => {
    renderSettings();
    const name=screen.getByPlaceholderText("Reference drive / archive folder");
    fireEvent.change(name,{target:{value:"Changed"}});
    await userEvent.click(screen.getByRole("button",{name:"Add custom source"}));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Discard unsaved source settings?");
    await userEvent.click(screen.getByRole("button",{name:"Cancel"}));
    expect(name).toHaveValue("Changed");
  });

});
