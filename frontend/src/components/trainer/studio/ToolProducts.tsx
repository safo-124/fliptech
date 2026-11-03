"use client";

import { Loader2, Plus, Search, X } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { saveToolProducts } from "@/lib/course-api";
import { API_URL } from "@/lib/trainer-fetch";
import type { ProductCard, StudioDetails } from "@/lib/types";

/**
 * "Tools you need", linked to the marketplace: the trainer finds products
 * (theirs or anyone's) and adds them; learners see them on the course page.
 * With none chosen, the course page suggests products from the tool list.
 */
export function ToolProducts({
  details,
  onSaved,
}: {
  details: StudioDetails;
  onSaved: (details: StudioDetails) => void;
}) {
  const t = useTranslations("CourseStudio");
  const [chosen, setChosen] = useState(details.tool_products ?? []);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<ProductCard[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (!query.trim()) return;
    const response = await fetch(`${API_URL}/api/products/?q=${encodeURIComponent(query.trim())}`);
    const data = (await response.json().catch(() => null)) as { results?: ProductCard[] } | null;
    setFound(data?.results?.slice(0, 8) ?? []);
  }

  async function save(next: typeof chosen) {
    setChosen(next);
    setBusy(true);
    setNote(null);
    try {
      onSaved(await saveToolProducts(next.map((product) => product.id)));
      setNote(t("toolProductsSaved"));
    } catch (error) {
      setNote(error instanceof Error ? error.message : t("saveFailed"));
    }
    setBusy(false);
  }

  return (
    <div className="space-y-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5 shadow-[var(--shadow-card)]">
      <div>
        <h3 className="text-sm font-bold">{t("toolProductsTitle")}</h3>
        <p className="text-xs text-[var(--color-muted-foreground)]">{t("toolProductsHelp")}</p>
      </div>
      {chosen.length ? (
        <ul className="flex flex-wrap gap-2">
          {chosen.map((product) => (
            <li
              key={product.id}
              className="inline-flex items-center gap-1.5 rounded-full bg-[var(--color-brand-soft)] py-1 pl-3 pr-1 text-xs font-semibold text-[var(--color-brand)]"
            >
              {product.name}
              <button
                type="button"
                aria-label={t("toolProductsRemove", { name: product.name })}
                disabled={busy}
                onClick={() => void save(chosen.filter((row) => row.id !== product.id))}
                className="grid size-6 place-items-center rounded-full hover:bg-white"
              >
                <X aria-hidden="true" className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <form onSubmit={(event) => void search(event)} className="flex gap-2">
        <label htmlFor="tool-search" className="sr-only">
          {t("toolProductsSearch")}
        </label>
        <input
          id="tool-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("toolProductsSearch")}
          className="h-10 min-w-0 flex-1 rounded-xl border border-[var(--color-border)] bg-[var(--color-muted)] px-3 text-sm outline-none focus:border-[var(--color-brand)]"
        />
        <button
          type="submit"
          aria-label={t("toolProductsSearch")}
          className="grid size-10 place-items-center rounded-xl bg-[var(--color-brand)] text-white"
        >
          <Search aria-hidden="true" className="size-4" />
        </button>
      </form>
      {found ? (
        found.length ? (
          <ul className="divide-y divide-[var(--color-border)] rounded-xl border border-[var(--color-border)]">
            {found.map((product) => {
              const added = chosen.some((row) => row.id === product.id);
              return (
                <li key={product.id} className="flex items-center gap-2 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {product.name}
                    <span className="text-[var(--color-muted-foreground)]"> · {product.seller.business_name}</span>
                  </span>
                  <button
                    type="button"
                    disabled={added || busy || chosen.length >= 12}
                    onClick={() =>
                      void save([...chosen, { id: product.id, name: product.name, seller: product.seller.business_name }])
                    }
                    className="inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold text-[var(--color-brand)] disabled:opacity-40"
                  >
                    <Plus aria-hidden="true" className="size-3.5" />
                    {added ? t("toolProductsAdded") : t("toolProductsAdd")}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-sm text-[var(--color-muted-foreground)]">{t("toolProductsNone")}</p>
        )
      ) : null}
      {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
      {note ? <p className="text-xs text-[var(--color-muted-foreground)]">{note}</p> : null}
    </div>
  );
}
