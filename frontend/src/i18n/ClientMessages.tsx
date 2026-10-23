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
 *
 * The provider brings next-intl's message formatter with it, about 12 KB. For
 * a subtree only some visitors see, use client-intl.ts instead.
 */

import { NextIntlClientProvider } from "next-intl";

import { pickMessages } from "./client-intl";
import type { ClientNamespace } from "./namespaces";

export async function ClientMessages({
  namespaces,
  children,
}: {
  namespaces: readonly ClientNamespace[];
  children: React.ReactNode;
}) {
  return (
    <NextIntlClientProvider messages={await pickMessages(namespaces)}>{children}</NextIntlClientProvider>
  );
}
