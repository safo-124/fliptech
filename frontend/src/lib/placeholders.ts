/**
 * Words that hold a place instead of saying something: "To be changed",
 * "tbc", "xxx", "n/a". The same list as the server's (backend
 * core/placeholders.py), so the trainer form says so beside the field before
 * saving, and the server refuses it if the form is skipped.
 *
 * Only a whole field counts: "Test welding" is a course name, "test" is not.
 */

const PLACEHOLDERS = new Set([
  "to be changed",
  "to be confirmed",
  "to be decided",
  "to be determined",
  "to be updated",
  "to be added",
  "to be announced",
  "will update",
  "will be updated",
  "update later",
  "change later",
  "change this",
  "change me",
  "edit me",
  "fill later",
  "coming soon",
  "tbc",
  "t b c",
  "tbd",
  "t b d",
  "tba",
  "test",
  "testing",
  "test test",
  "n a",
  "na",
  "none",
  "nil",
  "null",
  "placeholder",
  "sample",
  "dummy",
  "asdf",
  "qwerty",
]);

/** What a name box sometimes gets instead of a name. */
const ROLE_LABELS = new Set([
  "owner",
  "the owner",
  "manager",
  "the manager",
  "lead trainer",
  "trainer",
  "the trainer",
  "proprietor",
  "proprietress",
  "ceo",
  "boss",
  "master",
  "madam",
]);

function normal(text: string) {
  return text.toLowerCase().replace(/[^0-9a-z]+/g, " ").trim();
}

/** Whether a whole field is a stand-in. */
export function isPlaceholder(text: string | null | undefined): boolean {
  const raw = (text ?? "").trim();
  if (!raw) return false;
  const words = normal(raw);
  if (!words) return true; // only punctuation: "-", "...", "?"
  if (PLACEHOLDERS.has(words) || words.startsWith("lorem ipsum")) return true;
  const letters = words.replace(/ /g, "");
  return letters.length >= 2 && /^x+$/.test(letters);
}

/** Whether a name box holds a role ("Owner") rather than a name. */
export function isRoleLabel(text: string | null | undefined): boolean {
  return ROLE_LABELS.has(normal(text ?? ""));
}
