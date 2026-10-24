/**
 * The languages a workshop teaches in: providers.models.TeachingLanguage, in
 * the order the form offers them. Their names are in the "TeachingLanguages"
 * messages, so a trainee reading Twi sees "Twi" written in Twi.
 */
export const TEACHING_LANGUAGES = ["en", "tw", "fat", "gaa", "ee", "ha", "dag"] as const;

export type TeachingLanguage = (typeof TEACHING_LANGUAGES)[number];

export function isTeachingLanguage(code: string): code is TeachingLanguage {
  return (TEACHING_LANGUAGES as readonly string[]).includes(code);
}
