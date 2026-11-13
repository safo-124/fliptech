/**
 * The markers both maps draw: a numbered cluster, a workshop's photo pin, and
 * the plain dot for a workshop with no picture.
 *
 * Built as HTML strings because Leaflet markers are DOM it owns, not React.
 * Leaflet touches `window` at import time, so this module is only imported by
 * components that are themselves loaded with `dynamic(..., { ssr: false })`.
 */

import L from "leaflet";
import { getImageProps } from "next/image";

import type { ProviderCard } from "@/lib/types";

/**
 * The same purple as a single pin. A cluster and a pin both say "workshops
 * here"; a near-black count beside a purple dot read as two different things.
 */
export function clusterIcon(count: number) {
  const size = count < 10 ? 42 : count < 50 ? 46 : 52;
  return L.divIcon({
    html: `<div aria-hidden="true" style="width:${size}px;height:${size}px;border-radius:50%;background:var(--color-brand-strong);color:#fff;display:flex;align-items:center;justify-content:center;font:700 13px/1 var(--font-sans);border:3px solid #fff;box-shadow:0 5px 15px rgba(20,24,31,.28)">${count}</div>`,
    className: "",
    iconSize: [size, size],
  });
}

/** For a provider with no picture at all: the plain brand dot. */
const dotIcon = L.divIcon({
  html: `<div aria-hidden="true" style="width:42px;height:42px;display:grid;place-items:center"><div style="width:22px;height:22px;border-radius:50%;background:var(--color-brand-strong);border:3px solid #fff;box-shadow:0 4px 12px rgba(20,24,31,.35)"></div></div>`,
  className: "",
  iconSize: [42, 42],
  iconAnchor: [21, 21],
});

const PHOTO_PIN = 44;

function escapeAttribute(value: string) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

/**
 * Screen 2's photo pin: the workshop itself rather than a coloured dot, since
 * the thing being judged is a workshop. Falls back to the owner's logo, then
 * to the dot.
 *
 * The image goes through Next's optimiser at pin size, the same route
 * next/image uses, so a pin costs a few kilobytes of WebP rather than the
 * stored original — Section 10's page-weight budget applies to the map too.
 */
function photoIcon(src: string, fit: "cover" | "contain", active = false) {
  // The chosen workshop's pin is bigger and ringed in the brand colour, so
  // the eye finds it among the others the moment it is picked.
  const size = active ? 58 : PHOTO_PIN;
  const ring = active ? "var(--color-brand-strong)" : "#fff";
  const { srcSet, src: fallback } = getImageProps({
    src,
    alt: "",
    width: size,
    height: size,
  }).props;
  const inner = size - 6;
  const background = fit === "contain" ? "#fff" : "var(--color-muted)";
  const padding = fit === "contain" ? "padding:4px;" : "";
  return L.divIcon({
    html:
      `<div aria-hidden="true" style="position:relative;width:${size}px;height:${size + 8}px">` +
      `<div style="width:${size}px;height:${size}px;border-radius:${active ? 16 : 12}px;border:3px solid ${ring};background:${background};box-shadow:0 ${active ? "10px 24px rgba(59,7,100,.45)" : "5px 14px rgba(20,24,31,.35)"};overflow:hidden">` +
      `<img src="${escapeAttribute(fallback)}"${
        srcSet ? ` srcset="${escapeAttribute(srcSet)}"` : ""
      } alt="" width="${inner}" height="${inner}" loading="lazy" decoding="async" ` +
      `style="display:block;width:100%;height:100%;object-fit:${fit};${padding}box-sizing:border-box">` +
      `</div>` +
      // The tail, so the pin points at the workshop rather than covering it.
      `<div style="position:absolute;left:50%;bottom:1px;width:12px;height:12px;margin-left:-6px;background:${ring};transform:rotate(45deg);box-shadow:3px 3px 6px rgba(20,24,31,.18)"></div>` +
      `</div>`,
    className: "",
    iconSize: [size, size + 8],
    iconAnchor: [size / 2, size + 6],
    popupAnchor: [0, -(size + 2)],
  });
}

/** The plain dot, picked: larger, with a soft brand halo. */
const activeDotIcon = L.divIcon({
  html: `<div aria-hidden="true" style="width:56px;height:56px;display:grid;place-items:center;border-radius:50%;background:color-mix(in oklch, var(--color-brand) 22%, transparent)"><div style="width:28px;height:28px;border-radius:50%;background:var(--color-brand-strong);border:4px solid #fff;box-shadow:0 6px 16px rgba(59,7,100,.45)"></div></div>`,
  className: "",
  iconSize: [56, 56],
  iconAnchor: [28, 28],
});

/**
 * One icon per picture, reused across renders. Handing react-leaflet a new
 * icon object makes it rebuild the marker's DOM, which re-requests the image
 * and flickers every pin on every pan.
 */
const pinCache = new Map<string, L.DivIcon>();

export function pinIcon(provider: Pick<ProviderCard, "primary_photo" | "logo">, active = false) {
  const picture = provider.primary_photo ?? provider.logo;
  if (!picture) return active ? activeDotIcon : dotIcon;
  const fit = provider.primary_photo ? "cover" : "contain";
  const key = `${active ? "active" : "pin"}:${fit}:${picture}`;
  let icon = pinCache.get(key);
  if (!icon) {
    icon = photoIcon(picture, fit, active);
    pinCache.set(key, icon);
  }
  return icon;
}
