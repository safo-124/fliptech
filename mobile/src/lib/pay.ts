import * as WebBrowser from "expo-web-browser";

import { colors } from "@/theme/tokens";

/** Where the website sends the phone back once Paystack is done (app-return). */
export const PAID_URL = "fliiptech://paid";

/**
 * Pay on Paystack's own page, in a browser sheet over the app. Paystack
 * returns to the website's /app-return, which opens fliiptech://paid and
 * closes the sheet. Whatever happened, the caller then asks the API: the
 * redirect says the person came back, not that the money arrived.
 *
 * Returns false only when they closed the sheet without finishing.
 */
export async function payOnPaystack(authorizationUrl: string): Promise<boolean> {
  const result = await WebBrowser.openAuthSessionAsync(authorizationUrl, PAID_URL, {
    toolbarColor: colors.brandDeep,
    controlsColor: colors.brand,
    showTitle: true,
  });
  return result.type === "success";
}
