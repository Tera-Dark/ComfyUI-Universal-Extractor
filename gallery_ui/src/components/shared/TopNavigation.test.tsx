import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../i18n/I18nProvider";
import { TopNavigation } from "./TopNavigation";

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
  it("keeps active tab, scope badge, search, refresh, and sidebar controls wired", () => {
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
});
