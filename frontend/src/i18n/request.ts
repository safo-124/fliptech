/**
 * Which language a request is rendered in, and its messages.
 *
 * Section 10: English at version 1, with the interface strings externalised so
 * Twi and Ga become possible later without a rewrite. Every string a person
 * reads is in messages/en.json, looked up by key, and each other language is a
 * messages/<locale>.json that may be unfinished: what it leaves out is shown in
 * English. See catalogue.ts.
 *
 * The choice is a cookie, set by the footer's language links, then the
 * browser's own preference — never a path prefix. The generated area pages'
 * addresses are already indexed, and a prefix would put a redirect in front of
 * every one of them. Until a second language is switched on (config.ts), the
 * cookie and headers are not read at all, so pages that can be rendered once
 * and served to everyone still are.
 */

import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import { withFallback, type MessageTree } from "./catalogue";
import { DEFAULT_LOCALE, enabledLocales, LOCALE_COOKIE, pickLocale } from "./config";

export default getRequestConfig(async () => {
  const english = (await import("../../messages/en.json")).default;
  const enabled = enabledLocales();

  const locale =
    enabled.length > 1
      ? pickLocale({
          cookie: (await cookies()).get(LOCALE_COOKIE)?.value,
          acceptLanguage: (await headers()).get("accept-language"),
          enabled,
        })
      : DEFAULT_LOCALE;

  const messages =
    locale === DEFAULT_LOCALE
      ? english
      : withFallback(english, (await import(`../../messages/${locale}.json`)).default as MessageTree);

  return {
    locale,
    messages,
    // Dates are about intakes in Ghana, so they are read in Ghana's time zone
    // wherever the server happens to run.
    timeZone: "Africa/Accra",
  };
});
