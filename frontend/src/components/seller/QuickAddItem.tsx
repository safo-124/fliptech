"use client";

import {Camera, Check, ChevronDown, Hammer, ImagePlus, Loader2, RotateCcw, X} from "lucide-react";
import {useTranslations} from "next-intl";
import {useEffect, useRef, useState} from "react";

import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Label} from "@/components/ui/label";
import {NativeSelect} from "@/components/ui/native-select";
import {Textarea} from "@/components/ui/textarea";
import {compressPhoto} from "@/lib/compress-photo";
import {
  nameExample,
  toInput,
  wasPriceTooLow,
  type QuickItemDraft,
} from "@/lib/quick-item";
import {
  createProduct,
  removePendingPhoto,
  uploadPendingPhoto,
  type CreatedProduct,
} from "@/lib/seller-api";
import {cn} from "@/lib/utils";

const MAX_PHOTOS = 6;

type TradeChoice = {id: number; name: string; slug: string};

type Shot = {
  key: string;
  preview: string;
  file: File;
  progress: number;
  state: "uploading" | "done" | "failed";
  id?: number;
};

/**
 * "Add an item", photo first, for a seller on a phone between customers.
 *
 * The camera opens at once (`initialFiles` are the photos taken from the
 * button that opened this). Each photo is made smaller on the phone and
 * uploaded straight away, shown from the phone's own copy the moment it is
 * picked, so it never waits for a reload. The required screen is only a
 * name, a price (optional) and two big buttons; everything else is under
 * "More details". "Put on sale" saves and publishes in one request.
 */
export function QuickAddItem({
  trades,
  start,
  initialFiles,
  onSaved,
  onClose,
}: {
  trades: TradeChoice[];
  /** A blank item in the shop's trade, or "Add another like this". */
  start: QuickItemDraft;
  /** Photos taken with the button that opened the form, as they arrive. */
  initialFiles: File[];
  onSaved: (product: CreatedProduct) => void;
  onClose: () => void;
}) {
  const t = useTranslations("QuickAdd");
  const [draft, setDraft] = useState<QuickItemDraft>(start);
  const [shots, setShots] = useState<Shot[]>([]);
  const [busy, setBusy] = useState<"sale" | "draft" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [nameMissing, setNameMissing] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  // The photos as they are now, for code that runs later (counting room for
  // more, freeing previews when the form closes).
  const shotsRef = useRef<Shot[]>([]);
  useEffect(() => {
    shotsRef.current = shots;
  }, [shots]);

  const tradeSlug = trades.find((trade) => trade.id === draft.trade)?.slug;
  const set = <K extends keyof QuickItemDraft>(key: K, value: QuickItemDraft[K]) =>
    setDraft((current) => ({...current, [key]: value}));

  function patch(key: string, change: Partial<Shot>) {
    setShots((current) => current.map((shot) => (shot.key === key ? {...shot, ...change} : shot)));
  }

  async function send(shot: Shot) {
    patch(shot.key, {state: "uploading", progress: 0});
    try {
      const uploaded = await uploadPendingPhoto(shot.file, (share) => patch(shot.key, {progress: share}));
      patch(shot.key, {state: "done", progress: 1, id: uploaded.id});
    } catch {
      patch(shot.key, {state: "failed"});
    }
  }

  async function addFiles(files: File[]) {
    const room = MAX_PHOTOS - shotsRef.current.length;
    // Counted now, so two batches picked quickly cannot pass six together.
    shotsRef.current = [...shotsRef.current, ...files.slice(0, Math.max(room, 0)).map(() => ({}) as Shot)];
    for (const original of files.slice(0, Math.max(room, 0))) {
      const key = `${Date.now()}-${Math.random()}`;
      // Shown at once, from the phone's own copy: nothing waits for the network.
      const preview = URL.createObjectURL(original);
      const placeholder: Shot = {key, preview, file: original, progress: 0, state: "uploading"};
      setShots((current) => [...current, placeholder]);
      const file = await compressPhoto(original);
      const shot = {...placeholder, file};
      setShots((current) => current.map((item) => (item.key === key ? shot : item)));
      void send(shot);
    }
  }

  // Photos taken from the button that opened the form: the camera has to be
  // opened by the tap itself, so the page's picker takes them and hands them
  // over here, once per batch.
  const taken = useRef<File[] | null>(null);
  useEffect(() => {
    if (initialFiles === taken.current || initialFiles.length === 0) return;
    taken.current = initialFiles;
    void addFiles(initialFiles);
    // addFiles reads the current photos through a ref.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialFiles]);

  // Previews are freed when the form goes.
  useEffect(() => () => shotsRef.current.forEach((shot) => URL.revokeObjectURL(shot.preview)), []);

  function remove(shot: Shot) {
    URL.revokeObjectURL(shot.preview);
    setShots((current) => current.filter((item) => item.key !== shot.key));
    if (shot.id) void removePendingPhoto(shot.id).catch(() => {});
  }

  const uploading = shots.some((shot) => shot.state === "uploading");
  const failed = shots.some((shot) => shot.state === "failed");

  async function save(publish: boolean) {
    setProblem(null);
    if (!draft.name.trim()) {
      setNameMissing(true);
      nameInput.current?.focus();
      return;
    }
    if (uploading) {
      setProblem(t("waitForPhotos"));
      return;
    }
    setBusy(publish ? "sale" : "draft");
    try {
      const photos = shots.flatMap((shot) => (shot.state === "done" && shot.id ? [shot.id] : []));
      const product = await createProduct(toInput(draft, photos, publish));
      onSaved(product);
    } catch (reason) {
      setProblem(reason instanceof Error ? reason.message : t("failed"));
      setBusy(null);
    }
  }

  const tooLow = wasPriceTooLow(draft);
  const choice = (selected: boolean) =>
    cn(
      "flex min-h-14 flex-1 items-center justify-center gap-2 rounded-2xl border-2 px-3 text-base font-bold transition-colors",
      selected
        ? "border-[var(--color-brand)] bg-[var(--color-brand-soft)] text-[var(--color-brand-strong)]"
        : "border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-foreground)]",
    );

  return (
    <section
      aria-labelledby="quick-add-title"
      className="rounded-3xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 shadow-[var(--shadow-card)] sm:p-6"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="quick-add-title" className="text-xl font-bold tracking-[-0.02em]">
          {t("title")}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label={t("close")}
          className="grid size-11 place-items-center rounded-full hover:bg-[var(--color-muted)]"
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      </div>

      {/* ------------------------------------------------------------ photos */}
      <div className="mt-4">
        <p className="text-sm font-semibold">{t("photos", {count: shots.length, max: MAX_PHOTOS})}</p>
        <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-6">
          {shots.map((shot, index) => (
            <li key={shot.key} className="relative aspect-square overflow-hidden rounded-xl bg-[var(--color-muted)]">
              {/* A plain img: it is the phone's own copy, nothing to optimise. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={shot.preview} alt={t("photoAlt", {n: index + 1})} className="size-full object-cover" />
              {shot.state === "uploading" ? (
                <span className="absolute inset-x-1.5 bottom-1.5 h-1.5 overflow-hidden rounded-full bg-black/40">
                  <span
                    className="block h-full rounded-full bg-white transition-[width]"
                    style={{width: `${Math.max(8, Math.round(shot.progress * 100))}%`}}
                  />
                  <span className="sr-only">{t("uploading")}</span>
                </span>
              ) : null}
              {shot.state === "done" ? (
                <span className="absolute bottom-1.5 left-1.5 grid size-6 place-items-center rounded-full bg-[var(--color-visit)] text-white">
                  <Check aria-hidden="true" className="size-3.5" />
                  <span className="sr-only">{t("uploaded")}</span>
                </span>
              ) : null}
              {shot.state === "failed" ? (
                <button
                  type="button"
                  onClick={() => void send(shot)}
                  className="absolute inset-0 grid place-items-center bg-black/55 text-xs font-bold text-white"
                >
                  <span className="grid justify-items-center gap-1">
                    <RotateCcw aria-hidden="true" className="size-5" />
                    {t("retry")}
                  </span>
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => remove(shot)}
                aria-label={t("removePhoto", {n: index + 1})}
                className="absolute right-1 top-1 grid size-8 place-items-center rounded-full bg-black/60 text-white"
              >
                <X aria-hidden="true" className="size-4" />
              </button>
            </li>
          ))}
          {shots.length < MAX_PHOTOS ? (
            <li>
              <button
                type="button"
                onClick={() => picker.current?.click()}
                className="grid aspect-square w-full place-items-center rounded-xl border-2 border-dashed border-[var(--color-border-strong)] text-[var(--color-muted-foreground)] hover:border-[var(--color-brand)] hover:text-[var(--color-brand)]"
              >
                <span className="grid justify-items-center gap-1 text-xs font-semibold">
                  {shots.length ? <ImagePlus aria-hidden="true" className="size-6" /> : <Camera aria-hidden="true" className="size-6" />}
                  {shots.length ? t("addPhoto") : t("takePhoto")}
                </span>
              </button>
            </li>
          ) : null}
        </ul>
        <input
          ref={picker}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          onChange={(event) => {
            const files = Array.from(event.target.files ?? []);
            event.target.value = "";
            void addFiles(files);
          }}
        />
        {failed ? (
          <p role="alert" className="mt-2 text-xs font-medium text-[var(--color-destructive)]">
            {t("photoFailed")}
          </p>
        ) : null}
      </div>

      {/* ---------------------------------------------------- the essentials */}
      <div className="mt-5 space-y-4">
        <div>
          <Label htmlFor="quick-name">{t("name")}</Label>
          <Input
            ref={nameInput}
            id="quick-name"
            value={draft.name}
            maxLength={200}
            autoComplete="off"
            enterKeyHint="next"
            className="min-h-12 text-base"
            placeholder={nameExample(tradeSlug, t("nameExample"))}
            aria-invalid={nameMissing || undefined}
            aria-describedby={nameMissing ? "quick-name-error" : undefined}
            onChange={(event) => {
              set("name", event.target.value);
              if (event.target.value.trim()) setNameMissing(false);
            }}
          />
          {nameMissing ? (
            <p id="quick-name-error" className="mt-1.5 text-xs font-medium text-[var(--color-destructive)]">
              {t("nameMissing")}
            </p>
          ) : null}
        </div>

        <div>
          <Label htmlFor="quick-price">{t("price")}</Label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-base font-semibold text-[var(--color-muted-foreground)]">
              GH₵
            </span>
            <Input
              id="quick-price"
              inputMode="decimal"
              value={draft.price}
              autoComplete="off"
              className="min-h-12 pl-14 text-base"
              placeholder={t("pricePlaceholder")}
              aria-describedby="quick-price-hint"
              onChange={(event) => set("price", event.target.value)}
            />
          </div>
          <p id="quick-price-hint" className="mt-1.5 text-xs text-[var(--color-muted-foreground)]">
            {t("priceHint")}
          </p>
        </div>

        <fieldset>
          <legend className="text-sm font-medium">{t("availability")}</legend>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              aria-pressed={draft.availability === "available"}
              className={choice(draft.availability === "available")}
              onClick={() => set("availability", "available")}
            >
              <Check aria-hidden="true" className="size-5" />
              {t("readyNow")}
            </button>
            <button
              type="button"
              aria-pressed={draft.availability === "made_to_order"}
              className={choice(draft.availability === "made_to_order")}
              onClick={() => set("availability", "made_to_order")}
            >
              <Hammer aria-hidden="true" className="size-5" />
              {t("madeToOrder")}
            </button>
          </div>
        </fieldset>

        {/* -------------------------------------------------- more details */}
        <details className="group rounded-2xl border border-[var(--color-border)]">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-2 px-4 text-sm font-semibold">
            {t("moreDetails")}
            <ChevronDown aria-hidden="true" className="size-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-4 border-t border-[var(--color-border)] p-4">
            <div>
              <Label htmlFor="quick-description">{t("description")}</Label>
              <Textarea
                id="quick-description"
                rows={5}
                value={draft.description}
                className="text-base"
                aria-describedby="quick-description-hint"
                onChange={(event) => set("description", event.target.value)}
              />
              <p id="quick-description-hint" className="mt-1.5 text-xs text-[var(--color-muted-foreground)]">
                {t("descriptionHint")}
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="quick-stock">{t("stock")}</Label>
                <Input
                  id="quick-stock"
                  inputMode="numeric"
                  value={draft.stock}
                  className="min-h-12 text-base"
                  placeholder={t("stockPlaceholder")}
                  onChange={(event) => set("stock", event.target.value.replace(/\D/g, ""))}
                />
              </div>
              <div>
                <Label htmlFor="quick-condition">{t("condition")}</Label>
                <NativeSelect
                  id="quick-condition"
                  value={draft.condition}
                  onChange={(event) => set("condition", event.target.value as QuickItemDraft["condition"])}
                >
                  <option value="new">{t("conditionNew")}</option>
                  <option value="used">{t("conditionUsed")}</option>
                </NativeSelect>
              </div>
            </div>

            <div>
              <Label htmlFor="quick-was-price">{t("wasPrice")}</Label>
              <Input
                id="quick-was-price"
                inputMode="decimal"
                value={draft.wasPrice}
                className="min-h-12 text-base"
                aria-invalid={tooLow || undefined}
                aria-describedby="quick-was-price-note"
                onChange={(event) => set("wasPrice", event.target.value)}
              />
              <p
                id="quick-was-price-note"
                className={cn("mt-1.5 text-xs", tooLow ? "font-medium text-[var(--color-warn)]" : "text-[var(--color-muted-foreground)]")}
              >
                {tooLow ? t("wasPriceTooLow") : t("wasPriceHint")}
              </p>
            </div>

            <div>
              <Label htmlFor="quick-options">{t("options")}</Label>
              <Input
                id="quick-options"
                value={draft.options}
                className="min-h-12 text-base"
                placeholder={t("optionsPlaceholder")}
                onChange={(event) => set("options", event.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="quick-trade">{t("trade")}</Label>
              <NativeSelect
                id="quick-trade"
                value={draft.trade ? String(draft.trade) : ""}
                onChange={(event) => set("trade", event.target.value ? Number(event.target.value) : null)}
              >
                <option value="">{t("tradeNone")}</option>
                {trades.map((trade) => (
                  <option key={trade.id} value={trade.id}>
                    {trade.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          </div>
        </details>
      </div>

      {problem ? (
        <p role="alert" className="mt-4 rounded-xl bg-[var(--color-destructive)]/10 px-3 py-2 text-sm text-[var(--color-destructive)]">
          {problem}
        </p>
      ) : null}

      <div className="mt-5 grid gap-2">
        <Button
          type="button"
          variant="brand"
          className="min-h-12 w-full text-base"
          disabled={busy !== null}
          onClick={() => void save(true)}
        >
          {busy === "sale" ? <Loader2 aria-hidden="true" className="animate-spin" /> : null}
          {t("putOnSale")}
        </Button>
        <button
          type="button"
          disabled={busy !== null}
          onClick={() => void save(false)}
          className="mx-auto inline-flex min-h-11 items-center gap-2 px-3 text-sm font-semibold text-[var(--color-brand)] hover:underline disabled:opacity-50"
        >
          {busy === "draft" ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
          {t("saveDraft")}
        </button>
      </div>
    </section>
  );
}

