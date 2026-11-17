"use client";

import {LogIn} from "lucide-react";
import {useTranslations} from "next-intl";
import {useEffect, useState} from "react";

import {Button} from "@/components/ui/button";
import {getAccount} from "@/lib/account-api";
import {openSignIn, SESSION_CHANGED, type SignInRequest} from "@/lib/sign-in";

/**
 * In front of a form that used to prove the phone with a code typed on it
 * (an enquiry, a question to a seller, a quote request...). While SMS codes
 * cannot be relied on (the code is switched off), someone not signed in is
 * asked to sign in or create an account first, in the sign-in sheet, and
 * the form appears once they are in. Signed in, their own number needs no
 * code, so the form works as before. With the code switched on, the form
 * shows straight away and proves the number itself.
 */
export function SignInGate({
  children,
  request,
}: {
  children: React.ReactNode;
  request?: SignInRequest;
}) {
  const t = useTranslations("SignInGate");
  const [state, setState] = useState<"checking" | "open" | "closed">("checking");

  useEffect(() => {
    let active = true;
    function check() {
      getAccount()
        .then((session) => {
          if (active) setState(session.authenticated || session.sign_in?.code ? "open" : "closed");
        })
        // The server could not be asked: let the form say what is wrong.
        .catch(() => active && setState("open"));
    }
    check();
    window.addEventListener(SESSION_CHANGED, check);
    return () => {
      active = false;
      window.removeEventListener(SESSION_CHANGED, check);
    };
  }, []);

  if (state === "checking") return <div aria-busy="true" className="min-h-24" />;
  if (state === "open") return <>{children}</>;
  return (
    <div className="space-y-3 rounded-2xl border border-[var(--color-brand)]/30 bg-[var(--color-brand-soft)]/50 p-4">
      <p className="text-base font-bold">{t("title")}</p>
      <p className="text-sm text-[var(--color-muted-foreground)]">{t("body")}</p>
      <Button type="button" variant="brand" className="min-h-12 w-full" onClick={() => void openSignIn(request)}>
        <LogIn aria-hidden />
        {t("button")}
      </Button>
    </div>
  );
}
