import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { WorkspaceTab } from "../types/universal-gallery";
import { translations, type Locale } from "./translations";

interface TranslateOptions {
  source?: string;
  moved?: number;
  missing?: number;
  blocked?: number;
  loaded?: number;
  total?: number;
  shown?: number;
  page?: number;
  totalPages?: number;
  count?: number;
  name?: string;
  target?: string;
  tab?: WorkspaceTab;
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, options?: TranslateOptions) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);
const STORAGE_KEY = "universal-extractor-locale";

const interpolate = (template: string, options?: TranslateOptions) => {
  if (!options) {
    return template;
  }

  return template.replace(/\{(\w+)\}/g, (_, key: keyof TranslateOptions) => {
    const value = options[key];
    return value === undefined ? "" : String(value);
  });
};

export const I18nProvider = ({ children }: { children: ReactNode }) => {
  const [locale, setLocale] = useState<Locale>(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      return stored === "en" || stored === "zh-CN" ? stored : "zh-CN";
    } catch { return "zh-CN"; }
  });

  useEffect(() => {
    document.documentElement.lang = locale;
    try { window.localStorage.setItem(STORAGE_KEY, locale); } catch { /* Private mode: keep in-memory language. */ }
  }, [locale]);

  useEffect(() => {
    const sync = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY && (event.newValue === "en" || event.newValue === "zh-CN")) setLocale(event.newValue);
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key, options) => {
        const dictionary = translations[locale];
        const entry = dictionary[key] ?? translations.en[key];
        if (!entry) {
          return key;
        }

        if (typeof entry === "string") {
          return interpolate(entry, options);
        }

        const tab = options?.tab ?? "gallery";
        return entry[tab] ?? key;
      },
    }),
    [locale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = () => {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return context;
};
