import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider, useI18n } from "./I18nProvider";

const Probe = () => {
  const { locale, setLocale, t } = useI18n();
  return (
    <div>
      <span data-testid="locale">{locale}</span>
      <span data-testid="fallback">{t("missingTranslationKey")}</span>
      <span data-testid="page">{t("galleryPage", { page: 2, totalPages: 5 })}</span>
      <button onClick={() => setLocale("en")}>English</button>
    </div>
  );
};

describe("I18nProvider", () => {
  it("uses the default locale, interpolates text, and persists locale changes", async () => {
    render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );

    expect(screen.getByTestId("locale").textContent).toBe("zh-CN");
    expect(screen.getByTestId("fallback").textContent).toBe("missingTranslationKey");
    expect(screen.getByTestId("page").textContent).toContain("2");
    expect(screen.getByTestId("page").textContent).toContain("5");

    await userEvent.click(screen.getByRole("button", { name: "English" }));

    expect(screen.getByTestId("locale").textContent).toBe("en");
    expect(window.localStorage.getItem("universal-extractor-locale")).toBe("en");
  });
  it("sets document language and follows locale changes from another tab", () => {
    render(<I18nProvider><Probe /></I18nProvider>);
    expect(document.documentElement.lang).toBe("zh-CN");
    fireEvent(window,new StorageEvent("storage",{key:"universal-extractor-locale",newValue:"en"}));
    expect(screen.getByTestId("locale")).toHaveTextContent("en");
    expect(document.documentElement.lang).toBe("en");
  });
  it("still works when browser storage is unavailable", async () => {
    const get=vi.spyOn(Storage.prototype,"getItem").mockImplementation(()=>{throw new Error("blocked");});
    const set=vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("blocked");});
    try {
      render(<I18nProvider><Probe /></I18nProvider>);
      await userEvent.click(screen.getByRole("button",{name:"English"}));
      expect(screen.getByTestId("locale")).toHaveTextContent("en");
    } finally {get.mockRestore();set.mockRestore();}
  });

});
