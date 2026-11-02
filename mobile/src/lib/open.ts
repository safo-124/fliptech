import * as WebBrowser from "expo-web-browser";

import { colors } from "@/theme/tokens";

import { SITE_URL } from "./config";

/** Open one of the website's pages inside the app, in the brand's colours. */
export function openOnSite(path: string) {
  return WebBrowser.openBrowserAsync(`${SITE_URL}${path}`, {
    toolbarColor: colors.brandDeep,
    controlsColor: colors.brand,
    showTitle: true,
    enableBarCollapsing: true,
  });
}
