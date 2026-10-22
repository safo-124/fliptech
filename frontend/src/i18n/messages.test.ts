/**
 * The message catalogue, checked as data.
 *
 * Keys are already checked by the compiler (see next-intl.d.ts). What the
 * compiler cannot see is the text: an unbalanced brace in an ICU message only
 * fails at render, on whichever page happens to use it. And when a second
 * language arrives, a key missing from it shows the visitor "Namespace.key".
 * Both are caught here instead.
 */

import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";

import {createTranslator, IntlErrorCode} from "next-intl";
import {describe, expect, it} from "vitest";

import en from "../../messages/en.json";

const MESSAGES_DIR = join(__dirname, "..", "..", "messages");

type Tree = {[key: string]: string | Tree};

function leaves(tree: Tree, prefix = ""): Array<[string, string]> {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [[path, value] as [string, string]] : leaves(value, path);
  });
}

const english = leaves(en as Tree);

describe("messages/en.json", () => {
  it("has no empty messages", () => {
    const empty = english.filter(([, text]) => text.trim() === "").map(([key]) => key);
    expect(empty).toEqual([]);
  });

  it("parses every message as ICU", () => {
    const invalid: string[] = [];
    const t = createTranslator({
      locale: "en",
      messages: en,
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
    expect(invalid).toEqual([]);
  });
});

describe("other languages", () => {
  const locales = readdirSync(MESSAGES_DIR)
    .filter((name) => name.endsWith(".json") && name !== "en.json")
    .map((name) => name.replace(/\.json$/, ""));

  const englishKeys = english.map(([key]) => key).sort();

  // Nothing to check until a second language exists; the loop below is what
  // holds messages/tw.json to English's shape the day it is added.
  it.each(locales.length ? locales : ["(none yet)"])("%s has exactly the English keys", (locale) => {
    if (locale === "(none yet)") return;
    const other = JSON.parse(readFileSync(join(MESSAGES_DIR, `${locale}.json`), "utf-8")) as Tree;
    expect(leaves(other).map(([key]) => key).sort()).toEqual(englishKeys);
  });
});
