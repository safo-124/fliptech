import { X } from "lucide-react";
import Link from "next/link";

/**
 * "Category: Fashion, Beauty & Leather Craft ×" above a list opened from a
 * category page (?category=), so the narrowing is visible and one tap
 * undoes it. `href` is the same list without the category.
 */
export function CategoryPill({ label, clearLabel, href }: { label: string; clearLabel: string; href: string }) {
  return (
    <Link
      href={href}
      aria-label={`${label}. ${clearLabel}`}
      title={clearLabel}
      className="mt-2 inline-flex min-h-9 items-center gap-1.5 rounded-full border border-[var(--color-border)] bg-[var(--color-brand-soft)] px-3 text-xs font-semibold text-[var(--color-brand-strong)] hover:border-[var(--color-brand)]"
    >
      {label}
      <X aria-hidden="true" className="size-3.5" />
    </Link>
  );
}
