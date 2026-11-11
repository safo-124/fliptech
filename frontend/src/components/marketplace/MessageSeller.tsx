"use client";

import { Loader2, MessageSquare, Send } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { startChat } from "@/lib/account-api";
import { openSignIn } from "@/lib/sign-in";

/**
 * Chat with the seller on the site, instead of handing out numbers. Opens a
 * box; sending starts (or continues) the chat and goes to it. Signed out, the
 * sign-in sheet opens and the same message is sent once they are in.
 */
export function MessageSeller({
  sellerId,
  sellerName,
  productId,
  productName,
}: {
  sellerId: number;
  sellerName: string;
  productId?: number;
  productName?: string;
}) {
  const t = useTranslations("Marketplace");
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState(productName ? t("chatStarter", { name: productName }) : "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [signIn, setSignIn] = useState(false);

  async function send() {
    if (!body.trim()) return;
    setBusy(true);
    setProblem(null);
    try {
      const thread = await startChat(sellerId, body.trim(), productId);
      router.push(`/account/chats/${thread.id}`);
    } catch (error) {
      const status = (error as { status?: number }).status;
      setBusy(false);
      if (status === 401 || status === 403) {
        // Sign in here, then send the same message: nothing typed is lost.
        if (await openSignIn({ interest: "buy" })) return send();
        setSignIn(true);
      } else setProblem(error instanceof Error ? error.message : t("chatFailed"));
    }
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" className="w-full" onClick={() => setOpen(true)}>
        <MessageSquare aria-hidden="true" />
        {t("chatOpen", { seller: sellerName })}
      </Button>
    );
  }

  return (
    <div className="space-y-2 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-3">
      <label htmlFor="chat-first" className="text-sm font-semibold">
        {t("chatLabel", { seller: sellerName })}
      </label>
      <textarea
        id="chat-first"
        value={body}
        onChange={(event) => setBody(event.target.value)}
        maxLength={1000}
        rows={3}
        className="w-full rounded-xl border border-[var(--color-border)] bg-[var(--color-muted)] p-3 text-sm outline-none focus:border-[var(--color-brand)]"
      />
      {signIn ? (
        <p className="text-sm">
          {t("chatSignIn")}{" "}
          <button type="button" onClick={() => void send()} className="font-semibold text-[var(--color-brand)] underline">
            {t("chatSignInLink")}
          </button>
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="text-sm font-semibold text-[var(--color-destructive)]">
          {problem}
        </p>
      ) : null}
      <Button type="button" variant="brand" className="w-full" disabled={busy || !body.trim()} onClick={() => void send()}>
        {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : <Send aria-hidden="true" />}
        {t("chatSend")}
      </Button>
      <p className="text-xs text-[var(--color-muted-foreground)]">{t("chatPrivacy")}</p>
    </div>
  );
}
