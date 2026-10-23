/**
 * Messages, locale and time zone for a provider that is itself loaded lazily.
 *
 * next-intl's client provider imports the message formatter as soon as it
 * loads, about 12 KB. ClientMessages renders that provider in the page's own
 * tree, so where a client subtree is only sometimes shown it puts the cost on
 * every visitor. Pass this instead and render the provider inside the lazy
 * chunk. See SearchMapWithMessages.
 *
 * Its own module on purpose. Next bundles every client component a page's
 * imports can reach, rendered or not, so importing this from ClientMessages's
 * file would bring the provider straight back.
 */

import type { Locale } from "next-intl";
import { getLocale, getMessages, getNow, getTimeZone } from "next-intl/server";

import type { ClientNamespace } from "./namespaces";

export async function pickMessages(namespaces: readonly ClientNamespace[]) {
  const all = await getMessages();
  return Object.fromEntries(
    namespaces.map((namespace) => [namespace, all[namespace]]),
  ) as Partial<typeof all>;
}

export type ClientIntl = {
  locale: Locale;
  timeZone: string;
  now: Date;
  messages: Awaited<ReturnType<typeof pickMessages>>;
};

export async function clientIntl(namespaces: readonly ClientNamespace[]): Promise<ClientIntl> {
  const [messages, locale, timeZone, now] = await Promise.all([
    pickMessages(namespaces),
    getLocale(),
    getTimeZone(),
    getNow(),
  ]);
  return { locale, timeZone, now, messages };
}
