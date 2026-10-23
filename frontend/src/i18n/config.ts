/**
 * Languages the interface can be shown in.
 *
 * LOCALES is every language there is a messages file for. Which of them a
 * visitor is offered is NEXT_PUBLIC_LOCALES ("en,tw"), so a half-finished
 * translation can be switched on in staging, for translators to read in
 * place, before any trainee sees it. English is always on: it is what every
 * gap in another language falls back to. The API reads the same choice; see
 * INTERFACE_LANGUAGES in the backend settings.
 *
 * Twi is "tw" and Ga "gaa". A browser set to Akan sends "ak", which is taken
 * as Twi: it is the language most people mean by it.
 */
export const LOCALES = ["en", "tw", "gaa"] as const;
export type AppLocale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = "en";

/** next-intl's own cookie name, and the one the API reads. */
export const LOCALE_COOKIE = "NEXT_LOCALE";

/** Each language by the name its speakers use, for the switcher. */
export const LOCALE_NAMES: Record<AppLocale, string> = {
  en: "English",
  tw: "Twi",
  gaa: "Ga",
};

const ALIASES: Record<string, AppLocale> = { ak: "tw" };

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/** The languages switched on for this build, English first and always. */
export function enabledLocales(setting = process.env.NEXT_PUBLIC_LOCALES): AppLocale[] {
  const wanted = (setting ?? "").split(",").map((code) => code.trim());
  return LOCALES.filter((locale) => locale === DEFAULT_LOCALE || wanted.includes(locale));
}

/**
 * Which language to answer in: the visitor's choice if they made one, then
 * the browser's preference, then English. Only ever a switched-on language.
 */
export function pickLocale({
  cookie,
  acceptLanguage,
  enabled,
}: {
  cookie?: string | null;
  acceptLanguage?: string | null;
  enabled: readonly AppLocale[];
}): AppLocale {
  if (isAppLocale(cookie) && enabled.includes(cookie)) return cookie;

  const preferred = (acceptLanguage ?? "")
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((param) => param.trim().startsWith("q="));
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q.trim().slice(2)) || 0 : 1 };
    })
    .filter((entry) => entry.tag && entry.q > 0)
    .sort((a, b) => b.q - a.q);

  for (const { tag } of preferred) {
    const primary = tag.split("-")[0];
    const locale = ALIASES[primary] ?? primary;
    if (isAppLocale(locale) && enabled.includes(locale)) return locale;
  }
  return DEFAULT_LOCALE;
}
