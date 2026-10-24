import Image from "next/image";
import {
  BrickWall,
  ChefHat,
  Flame,
  GraduationCap,
  Hammer,
  Scissors,
  Shirt,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { tradeClass, tradeColour, type TradeColour } from "@/lib/trades";

const ICONS: Record<TradeColour, LucideIcon> = {
  spark: Flame,
  dye: Shirt,
  coral: Scissors,
  timber: Hammer,
  signal: Zap,
  steel: Wrench,
  clay: BrickWall,
  leaf: ChefHat,
  violet: GraduationCap,
};

/**
 * A trade's picture: its hand-painted signboard art, once a sign painter has
 * made one, and its icon in the trade's colour until then.
 *
 * Decorative: the trade's name is always written beside it.
 */
export function TradeArt({
  colour,
  picture,
  className = "size-28",
  sizes = "112px",
}: {
  colour: string;
  picture: string | null;
  className?: string;
  sizes?: string;
}) {
  if (picture) {
    return (
      <Image
        src={picture}
        alt=""
        width={480}
        height={480}
        sizes={sizes}
        className={`${className} rounded-3xl object-cover`}
      />
    );
  }
  const Icon = ICONS[tradeColour(colour)];
  return (
    <div
      aria-hidden="true"
      className={`${tradeClass(colour)} ${className} grid place-items-center rounded-3xl bg-[var(--trade-bg)] text-[var(--trade-fg)]`}
    >
      <Icon className="size-1/2" strokeWidth={1.4} />
    </div>
  );
}
