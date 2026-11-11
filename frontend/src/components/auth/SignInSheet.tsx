"use client";

import {X} from "lucide-react";
import {useTranslations} from "next-intl";
import {useEffect, useRef, useState} from "react";

import {PhoneSignIn} from "./PhoneSignIn";
import {onSignInRequest, openSignIn, type SignInRequest} from "@/lib/sign-in";

type Open = SignInRequest & {resolve: (signedIn: boolean) => void; id: number};

/**
 * The one sign-in sheet, in the root layout. It answers openSignIn() from
 * any page: slides up over what they were doing, and once they are in,
 * closes and lets that page carry on. See lib/sign-in.ts.
 */
export function SignInSheet() {
  const t = useTranslations("SignIn");
  const [open, setOpen] = useState<Open | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const counter = useRef(0);

  useEffect(
    () =>
      onSignInRequest((request) => {
        counter.current += 1;
        setOpen((current) => {
          current?.resolve(false);
          return {...request, id: counter.current};
        });
      }),
    [],
  );

  // Every "sign in and come back" link on the site opens the sheet instead
  // of leaving the page: /account?next=... and the trainee sign-in. Once in,
  // they go on to where the link pointed (a fresh load, so every part of the
  // page sees the new session). Without JavaScript the link still works.
  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.("a[href]");
      if (!(link instanceof HTMLAnchorElement) || link.target === "_blank") return;
      const url = new URL(link.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      const learning = url.pathname === "/trainee/sign-in";
      const next = url.searchParams.get("next");
      if (!learning && !(url.pathname === "/account" && next)) return;
      // Caught before React's handlers (capture), so a <Link> never starts
      // its own navigation.
      event.preventDefault();
      event.stopPropagation();
      const target = next && next.startsWith("/") && !next.startsWith("//") ? next : null;
      void openSignIn({role: learning ? "trainee" : undefined, interest: learning ? "learn" : undefined}).then(
        (signedIn) => {
          if (!signedIn) return;
          const here = window.location.pathname + window.location.search;
          if (target && target !== here) window.location.assign(target);
          else window.location.reload();
        },
      );
    }
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  function close(signedIn: boolean) {
    setOpen((current) => {
      current?.resolve(signedIn);
      return null;
    });
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby="sign-in-sheet-title"
      onCancel={(event) => {
        event.preventDefault();
        close(false);
      }}
      onClick={(event) => {
        // A click on the dimmed backdrop lands on the dialog itself.
        if (event.target === event.currentTarget) close(false);
      }}
      className="m-0 mt-auto w-full max-w-none rounded-t-3xl border border-[var(--color-border)] bg-[var(--color-card)] p-0 text-[var(--color-foreground)] shadow-2xl backdrop:bg-[rgb(23_20_38/0.45)] backdrop:backdrop-blur-[2px] sm:m-auto sm:max-w-md sm:rounded-3xl"
    >
      {open ? (
        <div className="max-h-[90dvh] overflow-y-auto p-5 pb-7 sm:p-6">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <p id="sign-in-sheet-title" className="text-xl font-bold tracking-[-0.02em]">
                {t("sheetTitle")}
              </p>
              <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
                {open.reason ?? t("sheetLead")}
              </p>
            </div>
            <button
              type="button"
              aria-label={t("close")}
              onClick={() => close(false)}
              className="grid size-10 shrink-0 place-items-center rounded-full hover:bg-[var(--color-muted)]"
            >
              <X aria-hidden className="size-5" />
            </button>
          </div>
          <PhoneSignIn
            key={open.id}
            idPrefix="sheet"
            role={open.role}
            interest={open.interest}
            onDone={() => close(true)}
          />
        </div>
      ) : null}
    </dialog>
  );
}
