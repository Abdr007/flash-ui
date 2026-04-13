// ============================================
// Flash UI — i18n System
// ============================================
// Lightweight translation system. Add new languages by creating
// a new file (e.g. ar.ts, zh.ts) and adding it to LANGUAGES.

import { en, type Translations } from "./en";

export type Locale = "en" | "ar" | "zh" | "es" | "tr" | "ko" | "ja";

const LANGUAGES: Record<string, Translations> = {
  en,
  // Future: import and add other languages here
  // ar: ar,
  // zh: zh,
};

let currentLocale: Locale = "en";

export function setLocale(locale: Locale): void {
  currentLocale = locale;
  if (typeof window !== "undefined") {
    localStorage.setItem("flash-locale", locale);
    document.documentElement.lang = locale;
  }
}

export function getLocale(): Locale {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem("flash-locale") as Locale | null;
    if (stored && LANGUAGES[stored]) return stored;
  }
  return currentLocale;
}

export function t(key: string): string {
  const locale = getLocale();
  const translations = LANGUAGES[locale] ?? LANGUAGES.en;

  // Navigate nested keys: "trade.confirmTrade" → translations.trade.confirmTrade
  const parts = key.split(".");
  let current: unknown = translations;
  for (const part of parts) {
    if (current && typeof current === "object" && part in current) {
      current = (current as Record<string, unknown>)[part];
    } else {
      // Key not found — fall back to English
      current = undefined;
      break;
    }
  }

  if (typeof current === "string") return current;

  // Fallback: try English
  let fallback: unknown = LANGUAGES.en;
  for (const part of parts) {
    if (fallback && typeof fallback === "object" && part in fallback) {
      fallback = (fallback as Record<string, unknown>)[part];
    } else {
      return key; // Return the key itself as last resort
    }
  }

  return typeof fallback === "string" ? fallback : key;
}

export { type Translations } from "./en";
