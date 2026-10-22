/**
 * Message keys are checked by the compiler.
 *
 * Every t("...") is typed against messages/en.json, so a misspelled or deleted
 * key fails `tsc` rather than rendering "Namespace.key" to a trainee. A future
 * messages/tw.json is held to the same shape by the catalogue test.
 */

import type messages from "../../messages/en.json";
import type { AppLocale } from "./config";

declare module "next-intl" {
  interface AppConfig {
    Locale: AppLocale;
    Messages: typeof messages;
  }
}
