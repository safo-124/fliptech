"use client";

import { BellPlus, Check, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { getFollow, setFollow, type FollowState } from "@/lib/marketplace-api";
import { openSignIn } from "@/lib/sign-in";

/**
 * Follow a shop: at most one text a day when it adds something. Needs an
 * account: signed out, the button opens the sign-in sheet and follows once
 * they are in.
 * Labels come as props: the shop page ships no message catalogue.
 */
export function FollowShop({
  sellerId,
  labels,
}: {
  sellerId: number;
  labels: { follow: string; following: string; signIn: string; followers: string };
}) {
  const [state, setState] = useState<FollowState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    getFollow(sellerId)
      .then((found) => {
        if (active) setState(found);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [sellerId]);

  if (!state) return null;
  const count = labels.followers.replace("#", String(state.followers));

  if (!state.signed_in) {
    return (
      <span className="inline-flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={async () => {
            // Sign in here, then follow: the reason they pressed it.
            if (!(await openSignIn({ interest: "buy" }))) return;
            setBusy(true);
            try {
              setState(await setFollow(sellerId, true));
            } catch {
              setState(await getFollow(sellerId).catch(() => state));
            }
            setBusy(false);
          }}
        >
          <BellPlus aria-hidden="true" />
          {labels.signIn}
        </Button>
        {state.followers ? <span className="text-xs text-[var(--color-muted-foreground)]">{count}</span> : null}
      </span>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant={state.following ? "outline" : "brand"}
        aria-pressed={state.following}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            setState(await setFollow(sellerId, !state.following));
          } catch {
            // Unchanged; the button stays as it was.
          }
          setBusy(false);
        }}
      >
        {busy ? (
          <Loader2 aria-hidden="true" className="animate-spin" />
        ) : state.following ? (
          <Check aria-hidden="true" />
        ) : (
          <BellPlus aria-hidden="true" />
        )}
        {state.following ? labels.following : labels.follow}
      </Button>
      {state.followers ? <span className="text-xs text-[var(--color-muted-foreground)]">{count}</span> : null}
    </span>
  );
}
