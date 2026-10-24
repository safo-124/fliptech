import { ImageResponse } from "next/og";

import { BRAND_COLOURS } from "@/lib/brand";
import { markSvg } from "@/lib/brand-mark";

/**
 * The favicon and the app icons, all drawn from the header's own mark.
 *
 * Rendered once at build time rather than committed as PNGs, so a change to
 * the mark or the brand colours reaches the home-screen icon by itself. The
 * manifest (app/manifest.ts) and the layout's metadata link to these.
 *
 *   mark.svg              the favicon: the mark alone, for light and dark tabs
 *   192.png, 512.png      "any": a rounded tile, shown as it is by a desktop
 *                         or a launcher that does not mask
 *   maskable-512.png      full bleed, the mark well inside the circle Android
 *                         may crop the icon to
 *   apple-touch-icon.png  full bleed: iOS rounds the corners itself and fills
 *                         any transparency with black
 */

type Icon = { size: number; corner: number; mark: number };

const ICONS: Record<string, Icon> = {
  "192.png": { size: 192, corner: 0.22, mark: 0.72 },
  "512.png": { size: 512, corner: 0.22, mark: 0.72 },
  "maskable-512.png": { size: 512, corner: 0, mark: 0.62 },
  "apple-touch-icon.png": { size: 180, corner: 0, mark: 0.66 },
};

export const dynamic = "force-static";
export const dynamicParams = false;

export function generateStaticParams() {
  return ["mark.svg", ...Object.keys(ICONS)].map((name) => ({ name }));
}

export async function GET(_request: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;

  if (name === "mark.svg") {
    return new Response(markSvg(), { headers: { "Content-Type": "image/svg+xml" } });
  }

  const icon = ICONS[name];
  if (!icon) return new Response("Not found", { status: 404 });

  const { deep, glow } = BRAND_COLOURS;
  const markSize = Math.round(icon.size * icon.mark);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          // The header band's indigo, with its glow at the top left.
          backgroundColor: deep,
          backgroundImage: `radial-gradient(circle at 15% 0%, ${glow}, ${deep} 70%)`,
          borderRadius: Math.round(icon.size * icon.corner),
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- drawn by ImageResponse, not served to a page */}
        <img
          src={`data:image/svg+xml,${encodeURIComponent(markSvg())}`}
          width={markSize}
          height={markSize}
          alt=""
        />
      </div>
    ),
    { width: icon.size, height: icon.size },
  );
}
