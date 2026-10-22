/** Languages the interface can be shown in. English only at version 1. */
export const LOCALES = ["en"] as const;
export type AppLocale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = "en";
