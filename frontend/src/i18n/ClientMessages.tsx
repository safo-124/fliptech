/**
 * Hands a client subtree the messages it needs, and no others.
 *
 * Server components read messages on the server and ship none of them. Client
 * components need theirs serialised into the page, and the whole catalogue on
 * every page would spend Section 10's page-weight budget on strings for screens
 * the visitor is not on — the trainer sign-up wizard's copy on the search page.
 * So each client subtree names its namespaces here.
 *
 * Providers do not merge: a client component under this provider sees only the
 * namespaces listed, so list every namespace the subtree's client components
 * use, including shared ones like Format.
 */

import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";

import type { ClientNamespace } from "./namespaces";

export async function ClientMessages({
  namespaces,
  children,
}: {
  namespaces: readonly ClientNamespace[];
  children: React.ReactNode;
}) {
  const all = await getMessages();
  const picked = Object.fromEntries(
    namespaces.map((namespace) => [namespace, all[namespace]]),
  ) as Partial<typeof all>;
  return <NextIntlClientProvider messages={picked}>{children}</NextIntlClientProvider>;
}
