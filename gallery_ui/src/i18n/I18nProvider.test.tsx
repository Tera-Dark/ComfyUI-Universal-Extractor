import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

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
});
