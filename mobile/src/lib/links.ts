/**
 * The website's addresses, as the app's own screens.
 *
 * Used for three things: a tapped notification (its link is a site path),
 * an https link to the site opened from WhatsApp or SMS (Android App Links,
 * see +native-intent.tsx), and anything else that hands the app a site path.
 * Anything the app has no screen for (privacy, joining as a trainer, the
 * back office) opens the website inside the app (the /web screen).
 */

const KNOWN_FIRST = new Set([
  "account",
  "app-return",
  "certificates",
  "dashboard",
  "enquiry",
  "join",
  "language",
  "learn",
  "map",
  "marketplace",
  "privacy",
  "search",
  "sell",
  "trades",
  "trainee",
  "trainer",
  "training",
  "_next",
  "api",
  "back-office",
  "media",
]);

export function appPath(sitePath: string): string {
  let url: URL;
  try {
    url = new URL(sitePath, "https://site.invalid");
  } catch {
    return "/";
  }
  const parts = url.pathname.split("/").filter(Boolean);
  const query = url.searchParams;
  const [first, second, third] = parts;

  if (!parts.length) return "/";
  if (first === "account" && second === "chats" && third) return `/chats/${third}`;
  if (first === "account" && second === "chats") return "/chats";
  if (first === "account" && second === "orders") return "/orders";
  if (first === "sell") {
    const tab = query.get("tab");
    if (tab === "orders") return "/seller/orders";
    if (tab === "chats") return "/seller/chats";
    return "/seller";
  }
  if (first === "marketplace") {
    if (second === "order" && third) return `/order/${third}`;
    if (second === "seller" && third) return `/shop/${third}`;
    if (second === "bag") return "/bag";
    if (second === "saved") return "/saved";
    if (second && /^\d+$/.test(second)) return `/product/${second}`;
    const q = query.get("q");
    return q ? `/search?q=${encodeURIComponent(q)}` : "/shop";
  }
  if (first === "learn") {
    if (second === "mine") return "/my-courses";
    if (second && third) return `/course/${second}/${third}`;
    return "/learn";
  }
  if (first === "training") {
    const keep = new URLSearchParams();
    for (const key of ["q", "trade", "area"]) {
      const value = query.get(key);
      if (value) keep.set(key, value);
    }
    const rest = keep.toString();
    return rest ? `/explore?${rest}` : "/explore";
  }
  if (first === "search") {
    const q = query.get("q");
    return q ? `/search?q=${encodeURIComponent(q)}` : "/search";
  }
  if (first === "map") return "/map";
  // /<area>/<workshop>: a workshop's page.
  if (parts.length === 2 && !KNOWN_FIRST.has(first)) return `/workshop/${first}/${second}`;
  return `/web?path=${encodeURIComponent(`${url.pathname}${url.search}`)}`;
}
