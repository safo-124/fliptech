/**
 * The front door.
 *
 * Until the landing page lands here, this is the redirect that keeps `/`
 * working now that results live at `/training`. Anything with a search
 * parameter on it goes to the results it asked for; a plain visit goes to the
 * results page too, which is what `/` has always shown.
 */

import { permanentRedirect } from "next/navigation";

import { searchRedirectTarget } from "@/lib/search-redirect";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  // 308 rather than 307: the results page has moved for good, and a temporary
  // redirect would leave search engines indexing `/` for content that is no
  // longer served there.
  permanentRedirect(searchRedirectTarget(params) ?? "/training");
}
