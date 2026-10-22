/**
 * Form validation messages, translated at the point they are shown.
 *
 * Zod schemas are module-level constants built before anyone knows what
 * language the page is in, so they cannot hold translated text. Each schema
 * message is a key into the "Validation" namespace instead, and the form turns
 * it into words when it renders the error. A message that is not a key — one
 * from a library default, say — is shown as it is rather than hidden.
 */

import type { useTranslations } from "next-intl";

import type messages from "../../messages/en.json";

export type ValidationKey = keyof (typeof messages)["Validation"];
export type ValidationTranslator = ReturnType<typeof useTranslations<"Validation">>;

/** A schema message, typed so a misspelled key fails the compiler. */
export function v(key: ValidationKey): ValidationKey {
  return key;
}

export function validationMessage(
  t: ValidationTranslator,
  message: string | undefined,
): string | undefined {
  if (!message) return undefined;
  return t.has(message as ValidationKey) ? t(message as ValidationKey) : message;
}
