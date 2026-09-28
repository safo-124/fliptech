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
 */
export function AccountNav() {
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
        // A trainer first: holding both is not something the sign-up flows can
        // produce, and the workshop is the one with work waiting on it.
        if (who.trainer) setAccount({href: "/trainer/dashboard", name: who.trainer.name});
        else if (who.trainee)
          setAccount({href: "/trainee", name: who.trainee.name, avatar: who.trainee.avatar});
      })
      // Signed out is the safe answer: it offers a way in rather than a link
      // to a dashboard that would bounce them.
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  if (account) {
    // Their own face, at both widths. The button is the same element on a
    // phone as on a desktop — only its padding changes — so the picture needs
    // no separate mobile treatment. It is inset by the same amount it adds, so
    // the pill keeps the width it had with the icon.
    const showPhoto = account.avatar && !photoFailed;
    return (
      <Button
        asChild
        variant="onBand"
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
              className="size-7 rounded-full object-cover ring-1 ring-white/40"
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
      <Button asChild variant="onBand" size="default" className="px-3 sm:px-4">
        <Link href="/trainee">
          <UserRound aria-hidden />
          <span className="hidden sm:inline">My account</span>
          <span className="sm:hidden">Account</span>
        </Link>
      </Button>
      <Button asChild variant="warm" size="default" className="px-3 sm:px-4">
        <Link href="/join">
          <UserPlus aria-hidden />
          Sign up
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
