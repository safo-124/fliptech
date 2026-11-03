import { Navigation, Store } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import type { PickupPoint } from "@/lib/types";

/** Collect from the workshop: the address the site already shows for it,
    its directions, and a map link. */
export function PickupCard({ pickup }: { pickup: PickupPoint }) {
  const t = useTranslations("Marketplace");
  const map =
    pickup.lat !== null && pickup.lng !== null
      ? `https://www.openstreetmap.org/directions?to=${pickup.lat}%2C${pickup.lng}#map=17/${pickup.lat}/${pickup.lng}`
      : null;
  return (
    <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card)] p-4 text-sm">
      <p className="flex items-center gap-2 font-bold">
        <Store aria-hidden="true" className="size-4 text-[var(--color-brand)]" />
        {t("pickupTitle")}
      </p>
      <p className="mt-1.5">
        <Link href={pickup.workshop_path} className="font-semibold hover:underline">
          {pickup.name}
        </Link>
        {pickup.address ? `, ${pickup.address}` : ""}, {pickup.area}
      </p>
      {pickup.directions ? (
        <p className="mt-1 text-[var(--color-muted-foreground)]">{pickup.directions}</p>
      ) : null}
      {map ? (
        <a
          href={map}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex min-h-10 items-center gap-1.5 font-semibold text-[var(--color-brand)]"
        >
          <Navigation aria-hidden="true" className="size-4" />
          {t("pickupDirections")}
        </a>
      ) : null}
    </div>
  );
}
