"use client";

/**
 * The search page's map and its messages provider, loaded as one chunk.
 *
 * next-intl's client provider imports the message formatter the moment it
 * loads. Rendered in the search page's own tree it put about 12 KB on every
 * phone, for a map only a desktop ever shows, and pushed the page over
 * Section 10's 200 KB budget. Loaded here, behind SearchMapPanel's desktop
 * check, it costs only the desktop that opens the map.
 */

import { NextIntlClientProvider } from "next-intl";
import type { ComponentProps } from "react";

import type { ClientIntl } from "@/i18n/client-intl";

import MapView from "./MapView";

export default function SearchMapWithMessages({
  intl,
  ...props
}: ComponentProps<typeof MapView> & { intl: ClientIntl }) {
  return (
    <NextIntlClientProvider {...intl}>
      <MapView {...props} />
    </NextIntlClientProvider>
  );
}
