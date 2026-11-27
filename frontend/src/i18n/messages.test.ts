/**
 * The message catalogue, checked as data.
 *
 * Keys are already checked by the compiler (see next-intl.d.ts). What the
 * compiler cannot see is the text: an unbalanced brace in an ICU message only
 * fails at render, on whichever page happens to use it. And a translation can
 * drop the {name} a sentence needs. Both are caught here instead. A
 * translation may be unfinished: its gaps are shown in English (catalogue.ts).
 */

import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";

import {createTranslator, IntlErrorCode} from "next-intl";
import {describe, expect, it} from "vitest";

import en from "../../messages/en.json";

import {catalogueProblems, leaves, withFallback, type MessageTree as Tree} from "./catalogue";
import {LOCALES, type AppLocale} from "./config";

const MESSAGES_DIR = join(__dirname, "..", "..", "messages");

/**
 * Keys written twice in one object of en.json. JSON keeps only the last, so a
 * second "metaTitle" silently replaces the first, and the page using the first
 * shows the other's words. Read from the pretty-printed text, by indentation.
 */
function duplicateKeys(text: string): string[] {
  const seen: Set<string>[] = [];
  const found: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const depth = (line.length - line.trimStart().length) / 2;
    if (line.trim().startsWith("{")) {
      seen.length = depth + 1;
      continue;
    }
    const key = line.match(/^\s*"((?:[^"\\]|\\.)*)":/)?.[1];
    if (key === undefined) continue;
    seen.length = depth + 1;
    seen[depth] ??= new Set();
    if (seen[depth].has(key)) found.push(key);
    seen[depth].add(key);
  }
  return found;
}

describe("en.json", () => {
  it("writes no key twice in the same place", () => {
    expect(duplicateKeys(readFileSync(join(MESSAGES_DIR, "en.json"), "utf8"))).toEqual([]);
  });

  it("would catch a key written twice", () => {
    expect(duplicateKeys('{\n  "A": {\n    "x": "1",\n    "x": "2"\n  },\n  "B": {\n    "x": "3"\n  }\n}')).toEqual(["x"]);
  });
});

const english = leaves(en as Tree);

function parseAll(locale: AppLocale, messages: Tree) {
  const invalid: string[] = [];
  const t = createTranslator({
    locale,
    messages,
    onError(error) {
      // Missing arguments are expected here: no values are passed. A message
      // that cannot be parsed at all is the failure this test is for.
      if (error.code === IntlErrorCode.INVALID_MESSAGE) invalid.push(error.message);
    },
    getMessageFallback: ({key}) => key,
  });
  for (const [key] of english) {
    // markup() formats rich-text tags as well as plain arguments, so a
    // message using <strong> is parsed rather than rejected for its tags.
    (t.markup as (key: string) => string)(key);
  }
  return invalid;
}

describe("messages/en.json", () => {
  it("has no empty messages", () => {
    const empty = english.filter(([, text]) => text.trim() === "").map(([key]) => key);
    expect(empty).toEqual([]);
  });

  it("parses every message as ICU", () => {
    expect(parseAll("en", en as Tree)).toEqual([]);
  });
});

describe("other languages", () => {
  const locales = readdirSync(MESSAGES_DIR)
    .filter((name) => name.endsWith(".json") && name !== "en.json")
    .map((name) => name.replace(/\.json$/, ""));

  it("has a file for every language in config.ts, and none it does not know", () => {
    expect(locales.sort()).toEqual(LOCALES.filter((locale) => locale !== "en").sort());
  });

  it.each(locales)("%s keeps every message's arguments and tags, and no stale keys", (locale) => {
    const other = JSON.parse(readFileSync(join(MESSAGES_DIR, `${locale}.json`), "utf-8")) as Tree;
    expect(catalogueProblems(en as Tree, other)).toEqual([]);
  });

  it.each(locales)("%s, with English filling its gaps, parses as ICU", (locale) => {
    const other = JSON.parse(readFileSync(join(MESSAGES_DIR, `${locale}.json`), "utf-8")) as Tree;
    expect(parseAll(locale as AppLocale, withFallback(en as Tree, other))).toEqual([]);
  });
});
