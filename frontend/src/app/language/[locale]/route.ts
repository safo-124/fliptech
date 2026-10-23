/**
 * /language/<code>: remember a visitor's language and take them back.
 *
 * The footer's language links point here. The choice is a cookie rather than
 * a path prefix (see i18n/request.ts), and setting it on the server means it
 * works without JavaScript. The API reads the same cookie, so its messages
 * follow too.
 *
 * Only back to a page on this site: the Referer is used for its path alone,
 * so a crafted link cannot bounce a visitor somewhere else.
 */

import { NextResponse, type NextRequest } from "next/server";

import { enabledLocales, isAppLocale, LOCALE_COOKIE } from "@/i18n/config";

const ONE_YEAR = 60 * 60 * 24 * 365;

export async function GET(request: NextRequest, { params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  let back = "/";
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      const from = new URL(referer);
      if (from.host === request.nextUrl.host) back = `${from.pathname}${from.search}`;
    } catch {
      // An unreadable Referer is the same as none.
    }
  }

  const response = NextResponse.redirect(new URL(back, request.nextUrl.origin), 303);
  if (isAppLocale(locale) && enabledLocales().includes(locale)) {
    response.cookies.set(LOCALE_COOKIE, locale, {
      path: "/",
      maxAge: ONE_YEAR,
      sameSite: "lax",
    });
  }
  return response;
}
