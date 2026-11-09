"use client";

import {UserPlus, UserRound} from "lucide-react";
import Link from "next/link";
import {useEffect, useState} from "react";

import {Button} from "@/components/ui/button";
import {getWhoami} from "@/lib/session-api";

/**
 * The right-hand end of the header, which has to know who is signed in.
 *
 * Before this, the header was static and always offered "My account" and
 * "Sign up". "My account" went to the trainee area, so a signed-in trainer who
 * clicked away from their dashboard was shown a sign-up button and, if they
 * followed the only account link on the page, a trainee sign-in form. Their
 * session was never touched — it just looked exactly like being logged out,
 * with no way back.
 *
 * Signed out is the first render, which is what the server sends and what the
 * great majority of visitors are, so nothing moves for them and the page needs
 * no JavaScript to be correct. The swap costs one small request per page load.
 *
 * The labels arrive already translated, from the header. Translating here
 * would put next-intl's message formatter on every page — about 12 KB, on a
 * search page with a 200 KB budget — for three fixed strings.
 */
export type AccountNavLabels = {myAccount: string; signUp: string};

export function AccountNav({labels}: {labels: AccountNavLabels}) {
  const [account, setAccount] = useState<{
    href: string;
    name: string;
    avatar?: string | null;
  } | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);

  useEffect(() => {
    let active = true;
    getWhoami()
      .then((who) => {
        if (!active) return;
        // One login can hold several roles now. The account page lists them
        // all, so the header always goes there. The server picks the picture
        // (the account's own, else the trainee's): core/whoami.py.
        if (!who.customer && !who.trainer && !who.seller && !who.trainee) return;
        // A name if there is one; a bare phone number is no name, and the
        // header then says "My account".
        const name =
          [who.customer?.name, who.trainer?.name, who.seller?.name, who.trainee?.name].find(
            (candidate) => candidate && !/^\+?\d[\d\s]+$/.test(candidate),
          ) ?? labels.myAccount;
        setAccount({href: "/account", name, avatar: who.customer?.avatar});
      })
      // Signed out is the safe answer: it offers a way in rather than a link
      // to a dashboard that would bounce them.
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [labels.myAccount]);

  if (account) {
    // Their own face, at both widths. The button is the same element on a
    // phone as on a desktop — only its padding changes — so the picture needs
    // no separate mobile treatment. It is inset by the same amount it adds, so
    // the pill keeps the width it had with the icon.
    const showPhoto = account.avatar && !photoFailed;
    return (
      <Button
        asChild
        variant="outline"
        size="default"
        className={showPhoto ? "pl-2 pr-3 sm:pr-4" : "px-3 sm:px-4"}
      >
        <Link href={account.href} title={account.name}>
          {showPhoto ? (
            // Not next/image: at 28px there is nothing for the optimiser to
            // save, and this avoids a second origin in remotePatterns for a
            // file that is only ever this size.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={account.avatar as string}
              alt=""
              className="size-7 rounded-full object-cover ring-1 ring-[var(--color-border)]"
              // A picture that 404s would leave a broken-image glyph in the
              // header of every page. Fall back to the icon instead.
              onError={() => setPhotoFailed(true)}
            />
          ) : (
            <UserRound aria-hidden />
          )}
          <span className="max-w-[9rem] truncate">{firstName(account.name)}</span>
        </Link>
      </Button>
    );
  }

  return (
    <>
      <Button asChild variant="outline" size="default" className="px-3 sm:px-4">
        <Link href="/account" aria-label={labels.myAccount}>
          <UserRound aria-hidden />
          {/* Icon only below sm, where the logo and two labelled buttons
              are wider than a 320px phone. The aria-label still names it. */}
          <span className="hidden sm:inline">{labels.myAccount}</span>
        </Link>
      </Button>
      <Button asChild variant="brand" size="default" className="px-3 sm:px-4">
        <Link href="/account?new=1">
          <UserPlus aria-hidden />
          {labels.signUp}
        </Link>
      </Button>
    </>
  );
}

/**
 * "Ama Mensah" becomes "Ama". The header is 4rem tall on a phone and shares
 * the row with the logo; a full name pushes the nav off the screen. A phone
 * number, which is the fallback when a trainer has not filled in their name,
 * has no spaces and survives this unchanged.
 */
function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name;
}
