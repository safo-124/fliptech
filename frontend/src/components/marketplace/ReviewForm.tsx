"use client";

import { Check, Loader2, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getReviewPrompt, sendReview, type ReviewPrompt } from "@/lib/marketplace-api";

/** Stars, a few words, and whether they bought. One per question or order. */
export function ReviewForm({ token }: { token: string }) {
  const t = useTranslations("Marketplace");
  const [prompt, setPrompt] = useState<ReviewPrompt | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [bought, setBought] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let active = true;
    getReviewPrompt(token)
      .then((found) => {
        if (active) setPrompt(found);
      })
      .catch((reason) => {
        if (active) setProblem(reason instanceof Error ? reason.message : t("reviewLinkBad"));
      });
    return () => {
      active = false;
    };
  }, [token, t]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!rating) {
      setProblem(t("reviewPickStars"));
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      await sendReview(token, { rating, comment: comment.trim(), bought });
      setDone(true);
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : t("reviewFailed"));
    }
    setBusy(false);
  }

  if (prompt === null) {
    return (
      <Card className="p-8 text-center text-sm text-[var(--color-muted-foreground)]">
        {problem ?? <Loader2 aria-hidden="true" className="mx-auto size-5 animate-spin" />}
      </Card>
    );
  }

  if (done || prompt.reviewed) {
    return (
      <Card className="p-8 text-center">
        <span className="mx-auto grid size-11 place-items-center rounded-xl bg-[var(--color-visit-bg)] text-[var(--color-visit)]">
          <Check aria-hidden="true" className="size-5" />
        </span>
        <p className="mt-3 font-semibold">{t("reviewThanks")}</p>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("reviewTitle", { seller: prompt.seller })}</CardTitle>
        <p className="text-sm text-[var(--color-muted-foreground)]">
          {prompt.paid
            ? t("reviewLeadPaid", { product: prompt.product_name })
            : t("reviewLeadAsked", { product: prompt.product_name })}
        </p>
      </CardHeader>
      <CardContent>
        <form onSubmit={submit} className="space-y-4">
          <fieldset>
            <legend className="text-sm font-medium">{t("reviewStarsLabel")}</legend>
            <div className="mt-1.5 flex gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRating(n)}
                  aria-pressed={rating === n}
                  aria-label={t("stars", { count: n })}
                  className="grid size-11 place-items-center rounded-lg hover:bg-[var(--color-muted)]"
                >
                  <Star
                    aria-hidden="true"
                    className={`size-7 ${n <= rating ? "fill-amber-400 text-amber-400" : "text-[var(--color-border-strong)]"}`}
                  />
                </button>
              ))}
            </div>
          </fieldset>
          {!prompt.paid ? (
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={bought}
                onChange={(event) => setBought(event.target.checked)}
                className="size-4 accent-[var(--color-brand)]"
              />
              {t("reviewBoughtLabel")}
            </label>
          ) : null}
          <div>
            <label htmlFor="review-comment" className="text-sm font-medium">
              {t("reviewCommentLabel")}
            </label>
            <textarea
              id="review-comment"
              rows={4}
              maxLength={600}
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              placeholder={t("reviewCommentPlaceholder")}
              className="mt-1.5 w-full rounded-lg border border-[var(--color-input)] bg-[var(--color-card)] px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-ring)]"
            />
          </div>
          {problem ? (
            <p role="alert" className="text-sm text-[var(--color-destructive)]">
              {problem}
            </p>
          ) : null}
          <Button type="submit" variant="brand" className="w-full" disabled={busy}>
            {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
            {t("reviewSend")}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
