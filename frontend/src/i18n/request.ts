/**
 * Which language a request is rendered in, and its messages.
 *
 * Section 10: English at version 1, with the interface strings externalised so
 * Twi and Ga become possible later without a rewrite. Every string a person
 * reads is in messages/en.json, looked up by key. Adding a language is a new
 * messages/<locale>.json and a decision about how a visitor chooses it — a
 * cookie, Accept-Language or a path prefix — made here, in one place.
 *
 * There is deliberately no locale routing yet. With one language it would only
 * add a redirect to every page and a segment to every URL, and the generated
 * area pages' addresses are already indexed.
 */

import { getRequestConfig } from "next-intl/server";

import { DEFAULT_LOCALE } from "./config";

export default getRequestConfig(async () => {
  const locale = DEFAULT_LOCALE;
  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
    // Dates are about intakes in Ghana, so they are read in Ghana's time zone
    // wherever the server happens to run.
    timeZone: "Africa/Accra",
  };
});
