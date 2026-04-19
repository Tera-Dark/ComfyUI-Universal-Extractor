import type { WorkspaceTab } from "../types/universal-gallery";

import en from "./locales/en";
import zhCN from "./locales/zh-CN";


export type Locale = "zh-CN" | "en";
export type TranslationValue = string | Record<WorkspaceTab, string>;

export const translations: Record<Locale, Record<string, TranslationValue>> = {
  "zh-CN": zhCN,
  en,
};
