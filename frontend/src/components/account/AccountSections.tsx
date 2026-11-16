"use client";

import {GraduationCap, MessageCircle, UserRound} from "lucide-react";
import Link from "next/link";
import {useTranslations} from "next-intl";

import {cn} from "@/lib/utils";

/**
 * The one account area's sections, at the top of each of its pages: the
 * account itself (details, orders, closing it), learning (what was /trainee)
 * and messages. One login, one place: nothing here asks to sign in again.
 */
export function AccountSections({
  current,
  wide = false,
}: {
  current: "account" | "learning" | "messages";
  /** On the wide learning workspace: lined up with its heading, not centred. */
  wide?: boolean;
}) {
  const t = useTranslations("AccountSections");
  const items = [
    {key: "account", href: "/account", Icon: UserRound},
    {key: "learning", href: "/account/learning", Icon: GraduationCap},
    {key: "messages", href: "/account#messages", Icon: MessageCircle},
  ] as const;
  return (
    <nav aria-label={t("label")} className={wide ? "mb-5" : "mx-auto mb-5 max-w-3xl"}>
      <ul className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1">
        {items.map(({key, href, Icon}) => {
          const here = key === current;
          return (
            <li key={key} className="shrink-0">
              <Link
                href={href}
                aria-current={here ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-10 items-center gap-2 rounded-full border px-4 text-sm font-semibold transition-colors",
                  here
                    ? "border-transparent bg-[var(--color-brand)] text-white"
                    : "border-[var(--color-border)] bg-[var(--color-card)] hover:border-[var(--color-brand)]/40",
                )}
              >
                <Icon aria-hidden="true" className="size-4" />
                {t(key)}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
