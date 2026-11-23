import { BrickWall, ChefHat, Cog, House, Laptop, Palette, Scissors, type LucideIcon } from "lucide-react";

/**
 * A trade category's picture, by the icon staff chose for it
 * (backend catalog.models.TradeCategory.Icon). An unknown name, from a
 * category added before the site knew its icon, falls back to the cog.
 */
const ICONS: Record<string, LucideIcon> = {
  cog: Cog,
  bricks: BrickWall,
  scissors: Scissors,
  palette: Palette,
  chef: ChefHat,
  laptop: Laptop,
  house: House,
};

export function CategoryIcon({ icon, className }: { icon: string; className?: string }) {
  const Icon = ICONS[icon] ?? Cog;
  return <Icon aria-hidden="true" className={className} />;
}
