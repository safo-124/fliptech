"use client";

import { Check, Printer, Share2 } from "lucide-react";
import { useState } from "react";

/** Print (or save as PDF) and share a certificate. Words arrive as props. */
export function CertificateActions({
  url,
  labels,
}: {
  url: string;
  labels: { print: string; share: string; copied: string; shareText: string };
}) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const link = url.startsWith("http") ? url : window.location.href;
    if (navigator.share) {
      try {
        await navigator.share({ title: document.title, text: labels.shareText, url: link });
        return;
      } catch {
        // Closed the share sheet: fall through to copying.
      }
    }
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      window.prompt(labels.share, link);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        onClick={() => window.print()}
        className="inline-flex min-h-11 items-center gap-2 rounded-full bg-[var(--color-brand)] px-5 text-sm font-bold text-white shadow-md hover:bg-[var(--color-brand-strong)]"
      >
        <Printer aria-hidden="true" className="size-4" />
        {labels.print}
      </button>
      <button
        type="button"
        onClick={() => void share()}
        className="inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--color-border-strong)] bg-[var(--color-card)] px-5 text-sm font-bold hover:bg-[var(--color-muted)]"
      >
        {copied ? <Check aria-hidden="true" className="size-4 text-[var(--color-visit)]" /> : <Share2 aria-hidden="true" className="size-4" />}
        {copied ? labels.copied : labels.share}
      </button>
    </div>
  );
}
