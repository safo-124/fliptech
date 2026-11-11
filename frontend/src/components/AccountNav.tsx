"use client";

import {
  BookOpen,
  ChevronDown,
  Heart,
  LayoutDashboard,
  LogOut,
  Package,
  Store,
  UserPlus,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import {usePathname, useRouter} from "next/navigation";
import {useEffect, useRef, useState} from "react";

import {Button} from "@/components/ui/button";
import {signOutAccount} from "@/lib/account-api";
import {getWhoami} from "@/lib/session-api";
import {SESSION_CHANGED, announceSessionChange} from "@/lib/sign-in";
import type {Whoami} from "@/lib/types";

/**
 * The right-hand end of the header, which has to know who is signed in.
 *
 * Signed out: "Sign in" and "Register". Signed in: their picture and first
 * name, opening one menu with a link for each part of the site they use: the
 * account and orders for everyone (every login can buy), courses for a
 * trainee, the workshop dashboard for a trainer, the shop for a seller. One
 * login, so nothing to "switch" between.
 *
 * The labels arrive translated, from the header (a server component).
 */
export type AccountNavLabels = {
  myAccount: string;
  signUp: string;
  account: string;
  orders: string;
  saved: string;
  courses: string;
  workshop: string;
  shop: string;
  signOut: string;
  menu: string;
};

type Signed = {name: string; avatar?: string | null; who: Whoami};

export function AccountNav({labels}: {labels: AccountNavLabels}) {
  const [account, setAccount] = useState<Signed | null>(null);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const pathname = usePathname() ?? "/";
  const router = useRouter();
  const isOpen = open === pathname;
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    function load() {
      getWhoami()
        .then((who) => {
          if (!active) return;
          if (!who.customer && !who.trainer && !who.seller && !who.trainee) {
            setAccount(null);
            return;
          }
          // A name if there is one; a bare phone number is no name.
          const name =
            [who.customer?.name, who.trainer?.name, who.seller?.name, who.trainee?.name].find(
              (candidate) => candidate && !/^\+?\d[\d\s]+$/.test(candidate),
            ) ?? labels.account;
          setAccount({name, avatar: who.customer?.avatar, who});
        })
        // Signed out is the safe answer: it offers a way in.
        .catch(() => {});
    }
    load();
    // Signing in from the sheet, or out from the menu, updates this at once.
    window.addEventListener(SESSION_CHANGED, load);
    return () => {
      active = false;
      window.removeEventListener(SESSION_CHANGED, load);
    };
  }, [labels.account]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setOpen(null);
    const onPointer = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [isOpen]);

  if (!account) {
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

  const {who} = account;
  const items = [
    {href: "/account", label: labels.account, icon: UserRound},
    {href: "/account#orders", label: labels.orders, icon: Package},
    {href: "/marketplace/saved", label: labels.saved, icon: Heart},
    ...(who.trainee ? [{href: "/learn/mine", label: labels.courses, icon: BookOpen}] : []),
    ...(who.trainer ? [{href: "/trainer/dashboard", label: labels.workshop, icon: LayoutDashboard}] : []),
    ...(who.seller ? [{href: "/sell/shop", label: labels.shop, icon: Store}] : []),
  ];

  const showPhoto = account.avatar && !photoFailed;
  return (
    <div ref={root} className="relative">
      <Button
        type="button"
        variant="outline"
        size="default"
        aria-label={`${labels.menu}: ${account.name}`}
        aria-expanded={isOpen}
        aria-haspopup="menu"
        onClick={() => setOpen(isOpen ? null : pathname)}
        className={showPhoto ? "pl-2 pr-2.5 sm:pr-3" : "px-3"}
      >
        {showPhoto ? (
          // Not next/image: at 28px there is nothing for the optimiser to save.
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={account.avatar as string}
            alt=""
            className="size-7 rounded-full object-cover ring-1 ring-[var(--color-border)]"
            onError={() => setPhotoFailed(true)}
          />
        ) : (
          <UserRound aria-hidden />
        )}
        <span className="max-w-[9rem] truncate max-sm:hidden">{firstName(account.name)}</span>
        <ChevronDown
          aria-hidden
          className={`size-4 text-[var(--color-muted-foreground)] transition-transform ${isOpen ? "rotate-180" : ""}`}
        />
      </Button>

      {isOpen ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-10 mt-2 w-64 overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-1.5 shadow-[0_24px_60px_-20px_rgb(38_0_90/0.4)]"
        >
          <p className="truncate px-3 pb-2 pt-2.5 text-sm font-bold">{account.name}</p>
          {items.map(({href, label, icon: Icon}) => (
            <Link
              key={href}
              role="menuitem"
              href={href}
              onClick={() => setOpen(null)}
              className="flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium hover:bg-[var(--color-brand-soft)]"
            >
              <Icon aria-hidden className="size-[1.125rem] text-[var(--color-brand)]" />
              {label}
            </Link>
          ))}
          <div className="my-1 h-px bg-[var(--color-border)]" />
          <button
            type="button"
            role="menuitem"
            onClick={async () => {
              setOpen(null);
              await signOutAccount().catch(() => {});
              setAccount(null);
              announceSessionChange();
              router.push("/");
              router.refresh();
            }}
            className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm font-medium hover:bg-[var(--color-muted)]"
          >
            <LogOut aria-hidden className="size-[1.125rem] text-[var(--color-muted-foreground)]" />
            {labels.signOut}
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** "Ama Mensah" becomes "Ama": the header shares its row with the logo. */
function firstName(name: string) {
  return name.trim().split(/\s+/)[0] || name;
}
