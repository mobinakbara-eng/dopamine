export const supportedLocales = ["de", "en", "fa", "tr"] as const;

export type SupportedLocale = (typeof supportedLocales)[number];

export const defaultLocale: SupportedLocale = "de";

export function isSupportedLocale(value: string): value is SupportedLocale {
  return supportedLocales.includes(value as SupportedLocale);
}

export function getTextDirection(locale: SupportedLocale): "ltr" | "rtl" {
  return locale === "fa" ? "rtl" : "ltr";
}

export function getLocaleLabel(locale: SupportedLocale): string {
  const labels: Record<SupportedLocale, string> = {
    de: "Deutsch",
    en: "English",
    fa: "فارسی",
    tr: "Türkçe",
  };

  return labels[locale];
}
