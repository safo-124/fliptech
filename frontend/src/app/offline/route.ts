import { BRAND, BRAND_COLOURS } from "@/lib/brand";
import { markSvg } from "@/lib/brand-mark";

/**
 * What a phone with no signal sees instead of the browser's own error page.
 *
 * The service worker (public/sw.js) keeps this page when the site is first
 * opened, and shows it for any page that needs a connection the phone does not
 * have and has not kept a copy of. So it is plain HTML with its own styles and
 * no script bundle: the site's stylesheet and scripts are renamed with every
 * deploy, and an offline phone may hold none of them.
 *
 * English only. It is kept once, so it cannot follow the language cookie the
 * way the pages do.
 */

export const dynamic = "force-static";

const escape = (text: string) =>
  text.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function GET() {
  const { deep, glow, canvas } = BRAND_COLOURS;
  const html = `<!doctype html>
<html lang="en-GH">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="${deep}">
<title>You're offline | ${escape(BRAND)} Skills Hub</title>
<link rel="icon" href="/icons/mark.svg" type="image/svg+xml">
<style>
*{box-sizing:border-box}
body{margin:0;min-height:100dvh;display:flex;flex-direction:column;background:${canvas};color:#171426;font:16px/1.5 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
header{display:flex;align-items:center;gap:10px;padding:14px 16px;color:#fff;background:radial-gradient(ellipse at 12% 0%,${glow},transparent 55%),${deep}}
header svg{width:36px;height:36px;display:block}
header strong{font-size:15px}
main{flex:1;display:flex;align-items:center;justify-content:center;padding:24px 16px}
.card{width:100%;max-width:26rem;background:#fff;border:1px solid #e0dcd4;border-radius:16px;padding:24px}
h1{margin:0 0 8px;font-size:1.375rem;line-height:1.25}
p{margin:0 0 20px;color:#57616f}
.actions{display:flex;flex-wrap:wrap;gap:10px}
button,a{min-height:44px;display:inline-flex;align-items:center;justify-content:center;padding:0 18px;border-radius:10px;font:inherit;font-weight:600;text-decoration:none;cursor:pointer}
button{border:0;background:${deep};color:#fff}
a{border:1px solid #e0dcd4;background:#fff;color:${deep}}
</style>
</head>
<body>
<header><span aria-hidden="true">${markSvg()}</span><strong>Skills Hub</strong></header>
<main>
<div class="card">
<h1>You're offline</h1>
<p>This page needs a connection, and your phone does not have one right now. Pages you have opened on this phone before still work without one.</p>
<div class="actions">
<button type="button" onclick="location.reload()">Try again</button>
<a href="/">Search for training</a>
</div>
</div>
</main>
</body>
</html>
`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
