import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n/I18nProvider";
import { galleryApi } from "../../services/galleryApi";
import { TopNavigation } from "./TopNavigation";

vi.mock("../../services/galleryApi", () => ({
  galleryApi: {
    getUpdateStatus: vi.fn(),
  },
}));

const mockUpdateStatus = () => {
  vi.mocked(galleryApi.getUpdateStatus).mockResolvedValue({
    current_version: "1.2.7",
    latest_version: "1.2.8",
    update_available: true,
    release_url: "https://github.com/Tera-Dark/ComfyUI-Universal-Extractor/releases/tag/v1.2.8",
    repository_url: "https://github.com/Tera-Dark/ComfyUI-Universal-Extractor",
    checked_at: 1,
    error: "",
    releases: [
      {
        version: "1.2.8",
        tag_name: "v1.2.8",
        name: "v1.2.8",
        body: "Update notes",
        url: "https://github.com/Tera-Dark/ComfyUI-Universal-Extractor/releases/tag/v1.2.8",
        published_at: "2026-07-01T00:00:00Z",
      },
    ],
  });
};

const renderNavigation = (overrides: Partial<Parameters<typeof TopNavigation>[0]> = {}) => {
  const props: Parameters<typeof TopNavigation>[0] = {
    activeTab: "gallery",
    onTabChange: vi.fn(),
    searchValue: "",
    onSearchChange: vi.fn(),
    onRefresh: vi.fn(),
    sidebarCollapsed: false,
    onSidebarToggle: vi.fn(),
    ...overrides,
  };

  return {
    props,
    ...render(
      <I18nProvider>
        <TopNavigation {...props} />
      </I18nProvider>,
    ),
  };
};

describe("TopNavigation", () => {
  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = "";
  });

  it("keeps active tab, scope badge, search, refresh, and sidebar controls wired", () => {
    mockUpdateStatus();
    const { container, props } = renderNavigation();
    const scope = container.querySelector(".ue-topbar-scope");
    const tabs = Array.from(container.querySelectorAll<HTMLButtonElement>(".ue-topbar-tab"));
    const sidebarToggle = container.querySelector<HTMLButtonElement>("[data-tour-id='topbar-sidebar-toggle']");
    const searchWrap = container.querySelector<HTMLElement>("[data-tour-id='topbar-search']");
    const searchButton = searchWrap?.querySelector<HTMLButtonElement>("button");
    const refreshButton = container.querySelector<HTMLButtonElement>("[data-tour-id='topbar-refresh']");

    expect(scope).toBeInTheDocument();
    expect(tabs[0]).toHaveClass("active");

    fireEvent.click(tabs[1]);
    expect(props.onTabChange).toHaveBeenCalledWith("library");

    fireEvent.click(sidebarToggle!);
    expect(props.onSidebarToggle).toHaveBeenCalled();

    fireEvent.click(searchButton!);
    expect(searchWrap).toHaveClass("is-open");

    fireEvent.click(refreshButton!);
    expect(props.onRefresh).toHaveBeenCalled();
  });

  it("keeps the update popover open when the bell is clicked", async () => {
    mockUpdateStatus();
    const { container } = renderNavigation();
    const updateButton = container.querySelector<HTMLButtonElement>("[data-tour-id='topbar-updates']");

    fireEvent.click(updateButton!);

    await waitFor(() => {
      expect(document.body.querySelector(".ue-update-popover")).toBeInTheDocument();
    });
    expect(updateButton).toHaveClass("is-open");
    expect(screen.getByText("1.2.7")).toBeInTheDocument();
    expect(screen.getByText("1.2.8")).toBeInTheDocument();
    expect(screen.getByText("Update notes")).toBeInTheDocument();

    fireEvent.click(document.body);
    expect(document.body.querySelector(".ue-update-popover")).not.toBeInTheDocument();
  });
});
