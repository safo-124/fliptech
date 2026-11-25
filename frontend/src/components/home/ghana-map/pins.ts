// Relative, not "@/", so Vitest (which has no path aliases) can load it.
import { insideGhana } from "../../../lib/ghana-bounds";
import type { MapPin } from "@/lib/types";

import { project } from "./project";

/** A workshop's pin, or several that sit too close to tell apart. */
export type PlacedPin =
  | { kind: "pin"; x: number; y: number; pin: MapPin }
  | { kind: "group"; x: number; y: number; pins: MapPin[]; place: string; href: string };

/** How close, in map units, two pins may sit before they become one bubble. */
export const GROUP_RADIUS = 22;

/**
 * Where each pin goes, with near neighbours gathered into one numbered
 * bubble, so Accra's twenty workshops read as "21" rather than a pile.
 *
 * Greedy, in the order given (newest first, from the API): each pin joins the
 * first bubble whose centre is within GROUP_RADIUS, or starts its own. A
 * bubble opens the full map on what its pins share: one town, else one
 * region, else the whole country. Pins outside Ghana's box are data mistakes
 * (see lib/ghana-bounds) and are left off. Southern pins come last, so they
 * are drawn over the ones behind them.
 */
export function placePins(pins: MapPin[], radius = GROUP_RADIUS): PlacedPin[] {
  const groups: { x: number; y: number; pins: MapPin[] }[] = [];
  for (const pin of pins) {
    if (!insideGhana(pin.lat, pin.lng)) continue;
    const [x, y] = project(pin.lat, pin.lng);
    const near = groups.find((group) => Math.hypot(group.x - x, group.y - y) <= radius);
    if (near) {
      near.pins.push(pin);
      const n = near.pins.length;
      near.x += (x - near.x) / n;
      near.y += (y - near.y) / n;
    } else {
      groups.push({ x, y, pins: [pin] });
    }
  }

  return groups
    .map((group): PlacedPin => {
      const x = Math.round(group.x * 10) / 10;
      const y = Math.round(group.y * 10) / 10;
      if (group.pins.length === 1) return { kind: "pin", x, y, pin: group.pins[0] };
      const [first] = group.pins;
      if (group.pins.every((pin) => pin.area_slug === first.area_slug)) {
        return { kind: "group", x, y, pins: group.pins, place: first.area, href: `/map?area=${first.area_slug}` };
      }
      if (group.pins.every((pin) => pin.region_slug === first.region_slug)) {
        return { kind: "group", x, y, pins: group.pins, place: first.region, href: `/map?region=${first.region_slug}` };
      }
      return { kind: "group", x, y, pins: group.pins, place: "Ghana", href: "/map" };
    })
    .sort((a, b) => a.y - b.y);
}

/** The numbers beside the map. */
export function summarise(pins: MapPin[]) {
  const byRegion = new Map<string, { name: string; slug: string; count: number }>();
  for (const pin of pins) {
    const entry = byRegion.get(pin.region_slug) ?? { name: pin.region, slug: pin.region_slug, count: 0 };
    entry.count += 1;
    byRegion.set(pin.region_slug, entry);
  }
  return {
    workshops: pins.length,
    shops: pins.filter((pin) => pin.has_shop).length,
    towns: new Set(pins.map((pin) => pin.area_slug)).size,
    regions: [...byRegion.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    newest: [...pins].sort((a, b) => b.joined.localeCompare(a.joined)).slice(0, 3),
  };
}

/** Whole days between when a workshop joined and now, never negative. */
export function daysSince(joined: string, now: Date): number {
  const ms = now.getTime() - new Date(joined).getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}
