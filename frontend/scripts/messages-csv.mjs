#!/usr/bin/env node
/**
 * Translations by spreadsheet, so translators never have to edit JSON.
 *
 *   pnpm messages:export tw > twi.csv     one row per message: key, English, Twi
 *   pnpm messages:import tw twi.csv       writes messages/tw.json from the file
 *   pnpm messages:status                  how far each language has got
 *
 * Open the CSV in Google Sheets (or Excel, saving as "CSV UTF-8"), fill in the
 * third column, download it as CSV and import it. A row left empty stays in
 * English on the site. The import refuses a row whose {arguments} or <tags>
 * differ from English, the same rule as src/i18n/catalogue.ts and the
 * catalogue test, and names the row and what is wrong with it.
 *
 * Self-contained on purpose: plain Node, nothing to build.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const MESSAGES = join(dirname(fileURLToPath(import.meta.url)), "..", "messages");
const NAMES = { tw: "Twi", gaa: "Ga" };

function load(locale) {
  return JSON.parse(readFileSync(join(MESSAGES, `${locale}.json`), "utf-8"));
}

function leaves(tree, prefix = "") {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [[path, value]] : leaves(value, path);
  });
}

/** The arguments and tags a message uses. Mirrors shapeOf in catalogue.ts. */
function shapeOf(message) {
  const names = new Set();
  let depth = 0;
  for (let i = 0; i < message.length; i++) {
    const char = message[i];
    if (char === "'" && message[i + 1] === "'") {
      i++;
    } else if (char === "{") {
      if (depth === 0) {
        const name = /^\{\s*([A-Za-z_][\w]*)/.exec(message.slice(i))?.[1];
        if (name) names.add(`{${name}}`);
      }
      depth++;
    } else if (char === "}") {
      depth = Math.max(0, depth - 1);
    }
  }
  for (const [, tag] of message.matchAll(/<\/?([a-zA-Z][\w-]*)>/g)) names.add(`<${tag}>`);
  return [...names].sort().join(" ");
}

function cell(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const source = text.replace(/^﻿/, "");
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((value) => value.trim()));
}

function setPath(tree, path, value) {
  const parts = path.split(".");
  let node = tree;
  for (const part of parts.slice(0, -1)) node = node[part] ??= {};
  node[parts.at(-1)] = value;
}

function exportCsv(locale) {
  const theirs = new Map(leaves(load(locale)));
  const lines = [[cell("key"), cell("English"), cell(NAMES[locale] ?? locale)].join(",")];
  for (const [key, english] of leaves(load("en"))) {
    lines.push([cell(key), cell(english), cell(theirs.get(key) ?? "")].join(","));
  }
  // The byte-order mark makes Excel read the file as UTF-8, so ɛ and ɔ survive.
  process.stdout.write(`﻿${lines.join("\r\n")}\r\n`);
}

function importCsv(locale, file) {
  const english = new Map(leaves(load("en")));
  const rows = parseCsv(readFileSync(file, "utf-8"));
  const translated = new Map();
  const problems = [];
  rows.slice(1).forEach(([key, , text = ""], index) => {
    const line = index + 2;
    const value = text.trim();
    if (!value) return;
    if (!english.has(key)) {
      problems.push(`row ${line}, ${key}: not in English any more, so it is never shown.`);
      return;
    }
    const want = shapeOf(english.get(key));
    const have = shapeOf(value);
    if (want !== have) {
      problems.push(`row ${line}, ${key}: must use ${want || "no arguments or tags"}, but uses ${have || "none"}.`);
      return;
    }
    translated.set(key, value);
  });
  if (problems.length) {
    console.error(`Nothing written. Fix these rows and import again:\n${problems.join("\n")}`);
    process.exit(1);
  }
  // In English's order, so a diff of the file reads like the English one.
  const tree = {};
  for (const key of english.keys()) if (translated.has(key)) setPath(tree, key, translated.get(key));
  writeFileSync(join(MESSAGES, `${locale}.json`), `${JSON.stringify(tree, null, 2)}\n`);
  console.log(`messages/${locale}.json: ${translated.size} of ${english.size} messages translated.`);
}

function status() {
  const total = leaves(load("en")).length;
  for (const locale of Object.keys(NAMES)) {
    const done = leaves(load(locale)).filter(([, text]) => text.trim()).length;
    console.log(`${NAMES[locale].padEnd(4)} ${String(done).padStart(5)} of ${total}  (${Math.round((done / total) * 100)}%)`);
  }
}

const [command, locale, file] = process.argv.slice(2);
if (command === "export" && NAMES[locale]) exportCsv(locale);
else if (command === "import" && NAMES[locale] && file) importCsv(locale, file);
else if (command === "status") status();
else {
  console.error("Usage: messages-csv.mjs export <tw|gaa> | import <tw|gaa> <file.csv> | status");
  process.exit(2);
}
