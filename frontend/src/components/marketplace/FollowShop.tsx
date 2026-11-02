"use client";

import { BellPlus, Check, Loader2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { getFollow, setFollow, type FollowState } from "@/lib/marketplace-api";

/**
 * Follow a shop: at most one text a day when it adds something. Needs an
 * account, so signed-out visitors get a link to sign in and come back.
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
        <Button asChild variant="outline" size="sm">
          <Link href={`/account?next=${encodeURIComponent(`/marketplace/seller/${sellerId}`)}`}>
            <BellPlus aria-hidden="true" />
            {labels.signIn}
          </Link>
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
