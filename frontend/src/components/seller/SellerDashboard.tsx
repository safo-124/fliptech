"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  ImagePlus,
  Loader2,
  MessageCircle,
  FileText,
  Package,
  Pencil,
  Plus,
  ShoppingBag,
  Store,
  Trash2,
  TrendingUp,
  X,
} from "lucide-react";
import Link from "next/link";
import {useRouter} from "next/navigation";
import {useCallback, useEffect, useState} from "react";
import {useTranslations} from "next-intl";

import {DashboardBottomBar, DashboardSidebar, type DashboardTab} from "@/components/dashboard/DashboardNav";
import {SellerGrowthTab} from "@/components/seller/SellerGrowth";
import {SellerOrdersTab} from "@/components/seller/SellerOrders";
import {SellerQuotesTab} from "@/components/seller/SellerQuotes";
import {checkPhoto} from "@/lib/photo-check";
import {Button} from "@/components/ui/button";
import {Card, CardContent, CardDescription, CardHeader, CardTitle} from "@/components/ui/card";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {NativeSelect} from "@/components/ui/native-select";
import {Textarea} from "@/components/ui/textarea";
import {
  addProductPhoto,
  createProduct,
  deleteProduct,
  getSellerEnquiries,
  getSellerProducts,
  getSellerSession,
  markEnquiryReplied,
  saveProductOptions,
  publishProduct,
  removeProductPhoto,
  saveShop,
  signOutSeller,
  updateProduct,
  withdrawProduct,
  type SellerEnquiry,
  type SellerProduct,
  type SellerProfile,
} from "@/lib/seller-api";

type Tab = "products" | "grow" | "orders" | "quotes" | "enquiries" | "shop";
type Area = {slug: string; name: string; id?: number};

/**
 * The seller's workspace.
 *
 * Six tabs and one rule running through all of them: never let somebody
 * believe a product is for sale when it is not. A product can be published
 * and still invisible — because the shop is half filled in, or because
 * nobody has confirmed the seller yet — and those are different problems
 * with different things to do about them, so the page says which.
 */
export function SellerDashboard({areas}: {areas: Area[]}) {
  const t = useTranslations("SellerDashboard");
  const router = useRouter();
  const [seller, setSeller] = useState<SellerProfile | null>(null);
  const [products, setProducts] = useState<SellerProduct[]>([]);
  const [enquiries, setEnquiries] = useState<SellerEnquiry[]>([]);
  // Back from paying Paystack for a boost or the Shop plan: open the tab
  // that confirms it. Read once, in the browser; the server renders only
  // the loading state, so there is nothing to mismatch.
  const [tab, setTab] = useState<Tab>(() =>
    typeof window !== "undefined" && new URL(window.location.href).searchParams.has("payment")
      ? "grow"
      : "products",
  );
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<SellerProduct | "new" | null>(null);

  const fetchAll = useCallback(
    () =>
      Promise.all([
        getSellerSession(),
        getSellerProducts().catch(() => ({results: []})),
        getSellerEnquiries().catch(() => ({results: []})),
      ]),
    [],
  );

  const apply = useCallback(
    ([session, shelf, asked]: Awaited<ReturnType<typeof fetchAll>>) => {
      setSeller(session.authenticated ? session.seller : null);
      setProducts(shelf.results);
      setEnquiries(asked.results);
    },
    [],
  );

  const reload = useCallback(async () => apply(await fetchAll()), [apply, fetchAll]);

  useEffect(() => {
    // `active` because a slow first load that lands after the seller has
    // navigated away would otherwise set state on a gone component.
    let active = true;
    fetchAll()
      .then((data) => {
        if (!active) return;
        apply(data);
      })
      .catch(() => {
        if (active) setError(t("loadFailed"));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [apply, fetchAll, t]);

  async function run(action: () => Promise<unknown>, done?: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await reload();
      if (done) setNotice(done);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t("somethingWrong"));
    }
    setBusy(false);
  }

  if (loading) {
    return (
      <div className="grid place-items-center py-24">
        <Loader2 aria-hidden="true" className="size-6 animate-spin text-[var(--color-muted-foreground)]" />
      </div>
    );
  }

  if (!seller) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm text-[var(--color-muted-foreground)]">{t("signedOut")}</p>
        <Button asChild variant="brand" className="mx-auto mt-4">
          <Link href="/sell">{t("signIn")}</Link>
        </Button>
      </Card>
    );
  }

  const live = products.filter((p) => p.visible).length;
  const unanswered = enquiries.length;

  const tabs: ReadonlyArray<DashboardTab<Tab>> = [
    {key: "products", label: t("tabProducts"), short: t("tabProductsShort"), Icon: Package},
    {key: "grow", label: t("tabGrow"), short: t("tabGrowShort"), Icon: TrendingUp},
    {key: "orders", label: t("tabOrders"), short: t("tabOrdersShort"), Icon: ShoppingBag},
    {key: "quotes", label: t("tabQuotes"), short: t("tabQuotesShort"), Icon: FileText},
    {key: "enquiries", label: t("tabEnquiries"), short: t("tabEnquiriesShort"), Icon: MessageCircle},
    {key: "shop", label: t("tabShop"), short: t("tabShopShort"), Icon: Store},
  ];

  return (
    <div data-seller-dashboard className="pb-20 lg:pb-0">
      <SellerStatus seller={seller} live={live} total={products.length} onFix={() => setTab("shop")} />

      <header className="mb-5">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--color-brand-strong)]">
          {t("eyebrow")}
        </p>
        <h1 className="truncate text-2xl font-bold tracking-[-0.03em] sm:text-3xl">
          {seller.business_name || t("unnamedShop")}
        </h1>
        <p className="mt-1 text-sm text-[var(--color-muted-foreground)]">
          {t("summary", {live, total: products.length, asked: enquiries.length})}
        </p>
      </header>

      {error ? (
        <p role="alert" className="mb-4 rounded-lg bg-[var(--color-destructive)]/10 px-3 py-2 text-sm text-[var(--color-destructive)]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="mb-4 rounded-lg bg-[var(--color-visit-bg)] px-3 py-2 text-sm text-[var(--color-visit)]">
          {notice}
        </p>
      ) : null}

      <div className="gap-7 lg:grid lg:grid-cols-[15rem_minmax(0,1fr)]">
        <DashboardSidebar
          tabs={tabs}
          tab={tab}
          onSelect={setTab}
          counts={{products: products.length, enquiries: unanswered}}
          onSignOut={() =>
            run(async () => {
              await signOutSeller();
              router.replace("/sell");
            })
          }
          busy={busy}
          canSignOut
        />

        <div className="min-w-0">
          {tab === "products" ? (
            <ProductsTab
              products={products}
              busy={busy}
              mayPublish={seller.may_sell}
              editing={editing}
              setEditing={setEditing}
              run={run}
            />
          ) : null}
          {tab === "grow" ? <SellerGrowthTab /> : null}
          {tab === "orders" ? <SellerOrdersTab /> : null}
          {tab === "quotes" ? <SellerQuotesTab /> : null}
          {tab === "enquiries" ? <EnquiriesTab enquiries={enquiries} run={run} /> : null}
          {tab === "shop" ? <ShopTab seller={seller} areas={areas} busy={busy} run={run} /> : null}
        </div>
      </div>

      <DashboardBottomBar
        tabs={tabs}
        tab={tab}
        onSelect={setTab}
        counts={{products: products.length, enquiries: unanswered}}
      />
    </div>
  );
}

/**
 * The banner that says whether anything of theirs is actually for sale.
 *
 * Three states, kept apart because the thing to do about each is different:
 * finish the form (their work), wait for confirmation (not their work), or
 * nothing at all.
 */
function SellerStatus({
  seller,
  live,
  total,
  onFix,
}: {
  seller: SellerProfile;
  live: number;
  total: number;
  onFix: () => void;
}) {
  const t = useTranslations("SellerDashboard");

  if (seller.approval_status === "declined") {
    return (
      <Banner tone="bad" Icon={AlertTriangle} title={t("declinedTitle")}>
        {seller.approval_note || t("declinedBody")}
      </Banner>
    );
  }
  if (seller.ready_to_sell.length) {
    return (
      <Banner tone="warn" Icon={Store} title={t("finishShopTitle")} action={{label: t("finishShopAction"), onClick: onFix}}>
        {t("finishShopBody")}
      </Banner>
    );
  }
  if (seller.approval_status === "pending") {
    return (
      <Banner tone="warn" Icon={Clock} title={t("waitingTitle")}>
        {t("waitingBody")}
      </Banner>
    );
  }
  if (total && !live) {
    return (
      <Banner tone="warn" Icon={AlertTriangle} title={t("nothingLiveTitle")}>
        {t("nothingLiveBody")}
      </Banner>
    );
  }
  return (
    <Banner tone="good" Icon={CheckCircle2} title={t("sellingTitle")}>
      {t("sellingBody", {live})}
    </Banner>
  );
}

function Banner({
  tone,
  Icon,
  title,
  children,
  action,
}: {
  tone: "good" | "warn" | "bad";
  Icon: typeof Store;
  title: string;
  children: React.ReactNode;
  action?: {label: string; onClick: () => void};
}) {
  const tones = {
    good: "bg-[var(--color-visit-bg)] text-[var(--color-visit)]",
    warn: "bg-[var(--color-warn-bg)] text-[var(--color-warn)]",
    bad: "bg-[var(--color-destructive)]/10 text-[var(--color-destructive)]",
  } as const;
  return (
    <div className={`mb-5 flex flex-wrap items-start gap-3 rounded-2xl px-4 py-3.5 ${tones[tone]}`}>
      <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">{title}</p>
        <p className="mt-0.5 text-sm leading-relaxed opacity-90">{children}</p>
      </div>
      {action ? (
        <Button type="button" variant="outline" size="sm" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Products

function ProductsTab({
  products,
  busy,
  mayPublish,
  editing,
  setEditing,
  run,
}: {
  products: SellerProduct[];
  busy: boolean;
  mayPublish: boolean;
  editing: SellerProduct | "new" | null;
  setEditing: (value: SellerProduct | "new" | null) => void;
  run: (action: () => Promise<unknown>, done?: string) => Promise<void>;
}) {
  const t = useTranslations("SellerDashboard");

  if (editing) {
    return (
      <ProductEditor
        product={editing === "new" ? null : editing}
        busy={busy}
        onClose={() => setEditing(null)}
        run={run}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-bold tracking-[-0.02em]">{t("yourProducts")}</h2>
        <Button type="button" variant="brand" onClick={() => setEditing("new")}>
          <Plus aria-hidden="true" />
          {t("addProduct")}
        </Button>
      </div>

      {products.length === 0 ? (
        <Card className="p-10 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--color-muted)] text-[var(--color-muted-foreground)]">
            <Package aria-hidden="true" className="size-6" />
          </span>
          <p className="mt-4 font-bold">{t("noProducts")}</p>
          <p className="mx-auto mt-1.5 max-w-[42ch] text-sm leading-relaxed text-[var(--color-muted-foreground)]">
            {t("noProductsBody")}
          </p>
          <Button type="button" variant="brand" className="mx-auto mt-5" onClick={() => setEditing("new")}>
            <Plus aria-hidden="true" />
            {t("addFirst")}
          </Button>
        </Card>
      ) : (
        <ul className="space-y-3">
          {products.map((product) => (
            <li key={product.id}>
              <Card className="overflow-hidden">
                <div className="flex gap-3.5 p-3.5">
                  <div className="size-20 shrink-0 overflow-hidden rounded-xl bg-[var(--color-muted)] sm:size-24">
                    {product.photos[0]?.image ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img src={product.photos[0].image} alt="" className="size-full object-cover" />
                    ) : (
                      <span className="grid size-full place-items-center text-[var(--color-muted-foreground)]">
                        <ImagePlus aria-hidden="true" className="size-5" />
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <h3 className="min-w-0 truncate text-sm font-bold">{product.name}</h3>
                      <StatusPill product={product} />
                    </div>
                    <p className="mt-1 text-sm font-semibold">
                      {product.price === null ? (
                        <span className="text-[var(--color-muted-foreground)]">{t("onRequest")}</span>
                      ) : (
                        `GH₵${Number(product.price).toLocaleString("en-GH")}`
                      )}
                    </p>
                    {product.staff_note ? (
                      <p className="mt-1.5 rounded-lg bg-[var(--color-destructive)]/10 px-2 py-1 text-xs text-[var(--color-destructive)]">
                        {product.staff_note}
                      </p>
                    ) : null}

                    <div className="mt-2.5 flex flex-wrap gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setEditing(product)}>
                        <Pencil aria-hidden="true" />
                        {t("edit")}
                      </Button>
                      {product.status === "draft" ? (
                        <Button
                          type="button"
                          variant="brand"
                          size="sm"
                          disabled={busy || !mayPublish}
                          title={mayPublish ? undefined : t("cannotPublishYet")}
                          onClick={() => run(() => publishProduct(product.id), t("published"))}
                        >
                          {t("publish")}
                        </Button>
                      ) : product.status === "published" ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          onClick={() => run(() => withdrawProduct(product.id), t("withdrawn"))}
                        >
                          {t("withdraw")}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * What state a product is in, from the seller's point of view.
 *
 * "Published" is not a state a seller cares about; "can anybody see it" is.
 * A published product whose seller is not confirmed says Hidden, because
 * that is the true answer and the badge is the only place they would learn it.
 */
function StatusPill({product}: {product: SellerProduct}) {
  const t = useTranslations("SellerDashboard");
  const [label, tone] =
    product.status === "suspended"
      ? [t("takenDown"), "bg-[var(--color-destructive)]/10 text-[var(--color-destructive)]"]
      : product.visible
        ? [t("live"), "bg-[var(--color-visit-bg)] text-[var(--color-visit)]"]
        : product.status === "published"
          ? [t("hidden"), "bg-[var(--color-warn-bg)] text-[var(--color-warn)]"]
          : [t("draft"), "bg-[var(--color-muted)] text-[var(--color-muted-foreground)]"];
  return (
    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.06em] ${tone}`}>
      {label}
    </span>
  );
}

function ProductEditor({
  product,
  busy,
  onClose,
  run,
}: {
  product: SellerProduct | null;
  busy: boolean;
  onClose: () => void;
  run: (action: () => Promise<unknown>, done?: string) => Promise<void>;
}) {
  const t = useTranslations("SellerDashboard");
  const [name, setName] = useState(product?.name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [price, setPrice] = useState(product?.price ?? "");
  const [wasPrice, setWasPrice] = useState(product?.was_price ?? "");
  const [availability, setAvailability] = useState(product?.availability ?? "available");

  async function save(event: React.FormEvent) {
    event.preventDefault();
    const body = {
      name: name.trim(),
      description: description.trim(),
      // Empty means "price on request", which is a real answer here and not
      // a missing value.
      price: price.trim() === "" ? null : price.trim(),
      was_price: (wasPrice ?? "").trim() === "" ? null : (wasPrice ?? "").trim(),
      availability,
    };
    await run(async () => {
      if (product) await updateProduct(product.id, body);
      else await createProduct(body);
    }, product ? t("saved") : t("addedAsDraft"));
    onClose();
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>{product ? t("editProduct") : t("newProduct")}</CardTitle>
          <CardDescription>{product ? t("editLead") : t("newLead")}</CardDescription>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={onClose} aria-label={t("close")}>
          <X aria-hidden="true" />
        </Button>
      </CardHeader>

      <CardContent>
        <form onSubmit={save} className="space-y-4">
          <div>
            <Label htmlFor="product-name">{t("nameLabel")}</Label>
            <Input
              id="product-name"
              required
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t("namePlaceholder")}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="product-price">{t("priceLabel")}</Label>
              <Input
                id="product-price"
                inputMode="decimal"
                value={price ?? ""}
                onChange={(event) => setPrice(event.target.value)}
                placeholder={t("pricePlaceholder")}
              />
              <p className="mt-1.5 text-xs text-[var(--color-muted-foreground)]">{t("priceHelp")}</p>
            </div>
            <div>
              <Label htmlFor="product-availability">{t("availabilityLabel")}</Label>
              <NativeSelect
                id="product-availability"
                value={availability}
                onChange={(event) => setAvailability(event.target.value as SellerProduct["availability"])}
              >
                <option value="available">{t("availableNow")}</option>
                <option value="made_to_order">{t("madeToOrder")}</option>
                <option value="sold_out">{t("soldOut")}</option>
              </NativeSelect>
              <p className="mt-1.5 text-xs text-[var(--color-muted-foreground)]">
                {t("availabilityHelp")}
              </p>
            </div>
          </div>

          <div className="sm:w-1/2">
            <Label htmlFor="product-was-price">{t("wasPriceLabel")}</Label>
            <Input
              id="product-was-price"
              inputMode="decimal"
              value={wasPrice ?? ""}
              onChange={(event) => setWasPrice(event.target.value)}
            />
            <p className="mt-1.5 text-xs text-[var(--color-muted-foreground)]">{t("wasPriceHelp")}</p>
          </div>

          <div>
            <Label htmlFor="product-description">{t("descriptionLabel")}</Label>
            <Textarea
              id="product-description"
              rows={4}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={t("descriptionPlaceholder")}
            />
          </div>

          <div className="flex gap-2">
            <Button type="submit" variant="brand" disabled={busy}>
              {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
              {product ? t("saveChanges") : t("addProduct")}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              {t("cancel")}
            </Button>
          </div>
        </form>

        {/* Photos only once the product exists: they hang off an id, and a
            draft with no id has nowhere to put them. */}
        {product ? (
          <>
            <ProductPhotos product={product} busy={busy} run={run} />
            <ProductOptions product={product} busy={busy} run={run} />
          </>
        ) : (
          <p className="mt-5 rounded-lg bg-[var(--color-muted)] px-3 py-2 text-xs text-[var(--color-muted-foreground)]">
            {t("photosAfterSaving")}
          </p>
        )}

        {product ? (
          <div className="mt-6 border-t border-[var(--color-border)] pt-4">
            <Button
              type="button"
              variant="ghost"
              className="text-[var(--color-destructive)]"
              disabled={busy}
              onClick={async () => {
                await run(() => deleteProduct(product.id), t("deleted"));
                onClose();
              }}
            >
              <Trash2 aria-hidden="true" />
              {t("deleteProduct")}
            </Button>
            <p className="mt-1 text-xs text-[var(--color-muted-foreground)]">{t("deleteHelp")}</p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ProductPhotos({
  product,
  busy,
  run,
}: {
  product: SellerProduct;
  busy: boolean;
  run: (action: () => Promise<unknown>, done?: string) => Promise<void>;
}) {
  const t = useTranslations("SellerDashboard");
  const [warning, setWarning] = useState<string | null>(null);
  return (
    <div className="mt-6 border-t border-[var(--color-border)] pt-5">
      <p className="text-sm font-bold">{t("photos")}</p>
      <p className="mt-1 text-xs leading-relaxed text-[var(--color-muted-foreground)]">
        {t("photosHelp")}
      </p>
      <ul className="mt-2 list-disc space-y-0.5 pl-5 text-xs text-[var(--color-muted-foreground)]">
        <li>{t("photoTipLight")}</li>
        <li>{t("photoTipBackground")}</li>
        <li>{t("photoTipInUse")}</li>
      </ul>
      {warning ? (
        <p role="status" className="mt-2 rounded-lg bg-[var(--color-warn-bg)] px-3 py-2 text-xs text-[var(--color-warn)]">
          {warning}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2.5">
        {product.photos.map((photo) => (
          <div key={photo.id} className="group relative size-20 overflow-hidden rounded-xl bg-[var(--color-muted)]">
            {photo.image ? (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img src={photo.image} alt="" className="size-full object-cover" />
            ) : null}
            <button
              type="button"
              aria-label={t("removePhoto")}
              disabled={busy}
              onClick={() => run(() => removeProductPhoto(product.id, photo.id))}
              className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-black/60 text-white opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100"
            >
              <X aria-hidden="true" className="size-3.5" />
            </button>
          </div>
        ))}

        <label className="grid size-20 cursor-pointer place-items-center rounded-xl border-2 border-dashed border-[var(--color-border-strong)] text-[var(--color-muted-foreground)] transition-colors hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]">
          <ImagePlus aria-hidden="true" className="size-5" />
          <span className="sr-only">{t("addPhoto")}</span>
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (!file) return;
              // Uploaded either way; the check only warns, after a look at a
              // small copy in the browser.
              void checkPhoto(file).then(({dark, blurry}) =>
                setWarning(
                  dark && blurry
                    ? t("photoDarkBlurry")
                    : dark
                      ? t("photoDark")
                      : blurry
                        ? t("photoBlurry")
                        : null,
                ),
              );
              void run(() => addProductPhoto(product.id, file));
            }}
          />
        </label>
      </div>
    </div>
  );
}

function ProductOptions({
  product,
  busy,
  run,
}: {
  product: SellerProduct;
  busy: boolean;
  run: (action: () => Promise<unknown>, done?: string) => Promise<void>;
}) {
  const t = useTranslations("SellerDashboard");
  const [rows, setRows] = useState(
    product.options.map((option) => ({
      label: option.label,
      price: option.price ?? "",
      available: option.available,
    })),
  );

  function update(index: number, patch: Partial<(typeof rows)[number]>) {
    setRows(rows.map((row, position) => (position === index ? {...row, ...patch} : row)));
  }

  return (
    <div className="mt-6 border-t border-[var(--color-border)] pt-5">
      <p className="text-sm font-bold">{t("optionsTitle")}</p>
      <p className="mt-1 text-xs leading-relaxed text-[var(--color-muted-foreground)]">{t("optionsHelp")}</p>
      <div className="mt-3 space-y-2">
        {rows.map((row, index) => (
          <div key={index} className="flex flex-wrap items-center gap-2">
            <Input
              aria-label={t("optionLabel")}
              value={row.label}
              onChange={(event) => update(index, {label: event.target.value})}
              placeholder={t("optionPlaceholder")}
              className="min-w-0 flex-1"
            />
            <Input
              aria-label={t("optionPrice")}
              inputMode="decimal"
              value={row.price}
              onChange={(event) => update(index, {price: event.target.value})}
              placeholder={t("optionPricePlaceholder")}
              className="w-28"
            />
            <label className="flex min-h-11 items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                checked={row.available}
                onChange={(event) => update(index, {available: event.target.checked})}
                className="size-4 accent-[var(--color-brand)]"
              />
              {t("optionAvailable")}
            </label>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("optionRemove")}
              onClick={() => setRows(rows.filter((_, position) => position !== index))}
            >
              <X aria-hidden="true" />
            </Button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={rows.length >= 20}
          onClick={() => setRows([...rows, {label: "", price: "", available: true}])}
        >
          <Plus aria-hidden="true" />
          {t("optionAdd")}
        </Button>
        <Button
          type="button"
          variant="brand"
          size="sm"
          disabled={busy}
          onClick={() =>
            run(
              () =>
                saveProductOptions(
                  product.id,
                  rows
                    .filter((row) => row.label.trim())
                    .map((row) => ({
                      label: row.label.trim(),
                      price: row.price.trim() === "" ? null : row.price.trim(),
                      available: row.available,
                    })),
                ),
              t("optionsSaved"),
            )
          }
        >
          {t("optionsSave")}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Enquiries

function EnquiriesTab({
  enquiries,
  run,
}: {
  enquiries: SellerEnquiry[];
  run: (action: () => Promise<unknown>, done?: string) => Promise<void>;
}) {
  const t = useTranslations("SellerDashboard");

  if (!enquiries.length) {
    return (
      <Card className="p-10 text-center">
        <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-[var(--color-muted)] text-[var(--color-muted-foreground)]">
          <MessageCircle aria-hidden="true" className="size-6" />
        </span>
        <p className="mt-4 font-bold">{t("noEnquiries")}</p>
        <p className="mx-auto mt-1.5 max-w-[42ch] text-sm leading-relaxed text-[var(--color-muted-foreground)]">
          {t("noEnquiriesBody")}
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-bold tracking-[-0.02em]">{t("whoAsked")}</h2>
      {enquiries.map((enquiry) => (
        <Card key={enquiry.id}>
          <CardContent className="pt-5">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="text-sm font-bold">{enquiry.product_name}</p>
                <p className="mt-0.5 text-xs text-[var(--color-muted-foreground)]">
                  {enquiry.buyer_name || t("someone")} &middot; {enquiry.reference_code}
                </p>
              </div>
              {/* The honest thing to show. Somebody looking at a question they
                  have not answered deserves to know whether it ever reached
                  their phone, rather than feeling slow about a message
                  nobody passed on. */}
              <span
                className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-[0.06em] ${
                  enquiry.told
                    ? "bg-[var(--color-visit-bg)] text-[var(--color-visit)]"
                    : "bg-[var(--color-warn-bg)] text-[var(--color-warn)]"
                }`}
              >
                {enquiry.told ? t("sentToYou") : t("onItsWay")}
              </span>
            </div>

            {enquiry.message ? (
              <p className="mt-3 rounded-xl bg-[var(--color-muted)] px-3 py-2.5 text-sm leading-relaxed">
                {enquiry.message}
              </p>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {/* Opening the reply counts as replying, for the "replies
                  within a day" badge; nothing comes back from WhatsApp to
                  say the message was sent. */}
              <Button asChild variant="brand" size="sm">
                <a
                  href={enquiry.reply_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => {
                    if (!enquiry.replied_at) void markEnquiryReplied(enquiry.id).catch(() => {});
                  }}
                >
                  <MessageCircle aria-hidden="true" />
                  {t("replyOnWhatsApp")}
                </a>
              </Button>
              {enquiry.replied_at ? (
                <span className="inline-flex items-center gap-1 text-xs text-[var(--color-visit)]">
                  <CheckCircle2 aria-hidden="true" className="size-3.5" />
                  {t("replied")}
                </span>
              ) : (
                <Button type="button" variant="ghost" size="sm" onClick={() => run(() => markEnquiryReplied(enquiry.id))}>
                  {t("markReplied")}
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shop

function ShopTab({
  seller,
  areas,
  busy,
  run,
}: {
  seller: SellerProfile;
  areas: Area[];
  busy: boolean;
  run: (action: () => Promise<unknown>, done?: string) => Promise<void>;
}) {
  const t = useTranslations("SellerDashboard");
  const [businessName, setBusinessName] = useState(seller.business_name);
  const [about, setAbout] = useState(seller.about);
  const [area, setArea] = useState(seller.area ? String(seller.area) : "");
  const [delivers, setDelivers] = useState(seller.delivery_fee !== null);
  const [deliveryFee, setDeliveryFee] = useState(seller.delivery_fee ?? "");
  const [deliveryArea, setDeliveryArea] = useState(seller.delivery_area);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t("yourShop")}</CardTitle>
        <CardDescription>{t("yourShopLead")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            run(
              () =>
                saveShop({
                  business_name: businessName.trim(),
                  about: about.trim(),
                  area: area ? Number(area) : null,
                  delivery_fee: delivers ? deliveryFee.trim() || "0" : null,
                  delivery_area: delivers ? deliveryArea.trim() : "",
                }),
              t("shopSaved"),
            );
          }}
          className="space-y-4"
        >
          <div>
            <Label htmlFor="shop-name">{t("shopNameLabel")}</Label>
            <Input
              id="shop-name"
              required
              value={businessName}
              onChange={(event) => setBusinessName(event.target.value)}
              placeholder={t("shopNamePlaceholder")}
            />
            <p className="mt-1.5 text-xs text-[var(--color-muted-foreground)]">{t("shopNameHelp")}</p>
          </div>

          <div>
            <Label htmlFor="shop-area">{t("areaLabel")}</Label>
            <NativeSelect
              id="shop-area"
              required
              value={area}
              onChange={(event) => setArea(event.target.value)}
            >
              <option value="">{t("chooseArea")}</option>
              {areas.map((option) => (
                <option key={option.slug} value={option.id ?? option.slug}>
                  {option.name}
                </option>
              ))}
            </NativeSelect>
            <p className="mt-1.5 text-xs text-[var(--color-muted-foreground)]">{t("areaHelp")}</p>
          </div>

          <div>
            <Label htmlFor="shop-about">{t("aboutLabel")}</Label>
            <Textarea
              id="shop-about"
              rows={4}
              value={about}
              onChange={(event) => setAbout(event.target.value)}
              placeholder={t("aboutPlaceholder")}
            />
          </div>

          <fieldset className="rounded-xl border border-[var(--color-border)] p-3">
            <legend className="px-1 text-sm font-medium">{t("deliveryTitle")}</legend>
            <label className="flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={delivers}
                onChange={(event) => setDelivers(event.target.checked)}
                className="size-4 accent-[var(--color-brand)]"
              />
              {t("deliveryOffer")}
            </label>
            {delivers ? (
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="shop-delivery-fee">{t("deliveryFeeLabel")}</Label>
                  <Input
                    id="shop-delivery-fee"
                    inputMode="decimal"
                    value={deliveryFee}
                    onChange={(event) => setDeliveryFee(event.target.value)}
                    placeholder="20"
                  />
                </div>
                <div>
                  <Label htmlFor="shop-delivery-area">{t("deliveryAreaLabel")}</Label>
                  <Input
                    id="shop-delivery-area"
                    value={deliveryArea}
                    onChange={(event) => setDeliveryArea(event.target.value)}
                    placeholder={t("deliveryAreaPlaceholder")}
                  />
                </div>
              </div>
            ) : null}
            <p className="mt-2 text-xs text-[var(--color-muted-foreground)]">{t("deliveryHelp")}</p>
          </fieldset>

          <Button type="submit" variant="brand" disabled={busy}>
            {busy ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
            {t("saveShop")}
          </Button>
        </form>

        <div className="mt-6 border-t border-[var(--color-border)] pt-4">
          <p className="text-xs text-[var(--color-muted-foreground)]">
            {t("signedInAs", {phone: seller.phone})}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
