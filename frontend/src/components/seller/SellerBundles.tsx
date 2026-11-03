"use client";

import { Loader2, PackagePlus, Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  createBundle,
  deleteBundle,
  getOwnBundles,
  updateBundle,
  type BundleInput,
  type SellerProduct,
} from "@/lib/seller-api";
import type { Bundle } from "@/lib/types";

/**
 * The "Bundles" tab, for a shop that is a training workshop: its online
 * course and tools from its shop, sold together for less. The buyer pays
 * once; the course opens on their phone when they do.
 */
export function SellerBundlesTab({ products }: { products: SellerProduct[] }) {
  const t = useTranslations("SellerDashboard");
  const [bundles, setBundles] = useState<Bundle[] | null>(null);
  const [editing, setEditing] = useState<Bundle | "new" | null>(null);

  const reload = useCallback(() => {
    getOwnBundles()
      .then((found) => setBundles(found.results))
      .catch(() => setBundles([]));
  }, []);
  useEffect(reload, [reload]);

  if (editing) {
    return (
      <BundleForm
        bundle={editing === "new" ? null : editing}
        products={products.filter((product) => product.status === "published" && product.price)}
        onDone={() => {
          setEditing(null);
          reload();
        }}
      />
    );
  }

  return (
    <section aria-labelledby="seller-bundles" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5">
        <div className="min-w-0 flex-1">
          <h2 id="seller-bundles" className="flex items-center gap-2 text-lg font-bold">
            <PackagePlus aria-hidden="true" className="size-5 text-[var(--color-brand)]" />
            {t("tabBundles")}
          </h2>
          <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">{t("bundlesLead")}</p>
        </div>
        <Button type="button" variant="brand" onClick={() => setEditing("new")}>
          {t("bundleNew")}
        </Button>
      </div>
      {bundles === null ? null : bundles.length ? (
        <ul className="space-y-3">
          {bundles.map((bundle) => (
            <li
              key={bundle.id}
              className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4"
            >
              <div className="min-w-0 flex-1">
                <p className="font-bold">
                  {bundle.title}
                  {!bundle.is_active ? (
                    <span className="ml-2 rounded-full bg-[var(--color-muted)] px-2 py-0.5 text-xs">{t("bundleOff")}</span>
                  ) : null}
                </p>
                <p className="text-sm text-[var(--color-muted-foreground)]">
                  {bundle.course ? `${t("bundleWithCourse")} · ` : ""}
                  {t("bundleItems", { count: bundle.items.length })}
                  {bundle.price ? ` · GH₵${bundle.price} (${t("bundleSaves", { amount: `GH₵${bundle.saving}` })})` : ""}
                </p>
                {bundle.problem ? <p className="text-sm text-[var(--color-warn)]">{bundle.problem}</p> : null}
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(bundle)}>
                <Pencil aria-hidden="true" />
                {t("edit")}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={t("bundleDelete", { title: bundle.title })}
                onClick={() => void deleteBundle(bundle.id).then(reload)}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl border border-dashed border-[var(--color-border-strong)] p-6 text-center text-sm text-[var(--color-muted-foreground)]">
          {t("bundlesNone")}
        </p>
      )}
    </section>
  );
}

function BundleForm({
  bundle,
  products,
  onDone,
}: {
  bundle: Bundle | null;
  products: SellerProduct[];
  onDone: () => void;
}) {
  const t = useTranslations("SellerDashboard");
  const [title, setTitle] = useState(bundle?.title ?? "");
  const [blurb, setBlurb] = useState(bundle?.blurb ?? "");
  const [percent, setPercent] = useState(String(bundle?.percent_off ?? 10));
  const [course, setCourse] = useState(bundle ? bundle.includes_course : true);
  const [active, setActive] = useState(bundle?.is_active ?? true);
  const [chosen, setChosen] = useState<Record<number, number>>(
    Object.fromEntries((bundle?.items ?? []).map((item) => [item.product.id, item.quantity])),
  );
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const body: BundleInput = {
      title: title.trim(),
      blurb: blurb.trim(),
      percent_off: Number(percent),
      includes_course: course,
      is_active: active,
      items: Object.entries(chosen).map(([product, quantity]) => ({ product: Number(product), quantity })),
    };
    setBusy(true);
    setProblem(null);
    try {
      if (bundle) await updateBundle(bundle.id, body);
      else await createBundle(body);
      onDone();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : t("bundleFailed"));
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(event) => void save(event)}
      className="space-y-4 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-5"
    >
      <h2 className="text-lg font-bold">{bundle ? t("bundleEdit") : t("bundleNew")}</h2>
      <div>
        <Label htmlFor="bundle-title">{t("bundleTitle")}</Label>
        <Input
          id="bundle-title"
          required
          maxLength={120}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={t("bundleTitlePlaceholder")}
        />
      </div>
      <div>
        <Label htmlFor="bundle-blurb">{t("bundleBlurb")}</Label>
        <Input id="bundle-blurb" maxLength={300} value={blurb} onChange={(event) => setBlurb(event.target.value)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="bundle-percent">{t("bundlePercent")}</Label>
          <NativeSelect id="bundle-percent" value={percent} onChange={(event) => setPercent(event.target.value)}>
            {[0, 5, 10, 15, 20, 25, 30, 40, 50].map((value) => (
              <option key={value} value={value}>
                {value}%
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className="flex flex-col justify-end gap-2">
          <label className="flex min-h-9 items-center gap-2 text-sm">
            <input type="checkbox" checked={course} onChange={(event) => setCourse(event.target.checked)} className="size-4" />
            {t("bundleIncludesCourse")}
          </label>
          <label className="flex min-h-9 items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} className="size-4" />
            {t("bundleOn")}
          </label>
        </div>
      </div>
      <fieldset>
        <legend className="text-sm font-semibold">{t("bundleProducts")}</legend>
        {products.length ? (
          <ul className="mt-2 divide-y divide-[var(--color-border)] rounded-xl border border-[var(--color-border)]">
            {products.map((product) => {
              const quantity = chosen[product.id];
              return (
                <li key={product.id} className="flex items-center gap-3 px-3 py-2">
                  <input
                    id={`bundle-${product.id}`}
                    type="checkbox"
                    checked={quantity !== undefined}
                    onChange={(event) =>
                      setChosen((now) => {
                        const next = { ...now };
                        if (event.target.checked) next[product.id] = 1;
                        else delete next[product.id];
                        return next;
                      })
                    }
                    className="size-4"
                  />
                  <label htmlFor={`bundle-${product.id}`} className="min-w-0 flex-1 truncate text-sm">
                    {product.name} · GH₵{product.price}
                  </label>
                  {quantity !== undefined ? (
                    <NativeSelect
                      aria-label={t("bundleQuantity", { name: product.name })}
                      value={String(quantity)}
                      onChange={(event) => setChosen((now) => ({ ...now, [product.id]: Number(event.target.value) }))}
                      className="w-20"
                    >
                      {[1, 2, 3, 4, 5].map((value) => (
                        <option key={value} value={value}>
                          × {value}
                        </option>
                      ))}
                    </NativeSelect>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-[var(--color-muted-foreground)]">{t("bundleNoProducts")}</p>
        )}
      </fieldset>
      {problem ? (
        <p role="alert" className="text-sm font-semibold text-[var(--color-destructive)]">
          {problem}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" variant="brand" disabled={busy || !title.trim() || !Object.keys(chosen).length}>
          {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
          {t("bundleSave")}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}
