import { BrickWall, ChefHat, Cog, House, Laptop, Palette, Scissors } from "lucide-react-native";

import type { TradeCategory } from "./types";

/**
 * Trade categories in the app: the picture for each (by the icon staff chose,
 * backend catalog.models.TradeCategory.Icon, the same as the website's
 * components/CategoryIcon.tsx), and which to offer on each list.
 */
const ICONS = {
  cog: Cog,
  bricks: BrickWall,
  scissors: Scissors,
  palette: Palette,
  chef: ChefHat,
  laptop: Laptop,
  house: House,
} as const;

/** The icon for a category; the cog for one the app does not know yet. */
export function categoryIcon(name: string) {
  return ICONS[name as keyof typeof ICONS] ?? Cog;
}

/** Which list a category row narrows: training (Explore), courses (Learn), the shop. */
export type CategoryList = "training" | "courses" | "shop";

const COUNT = { training: "provider_count", courses: "course_count", shop: "product_count" } as const;

/** The categories with something in this list, in the order staff set. */
export function categoriesFor(categories: TradeCategory[] | undefined, list: CategoryList) {
  return (categories ?? []).filter((category) => category[COUNT[list]] > 0);
}
