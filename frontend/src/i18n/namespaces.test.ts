/**
 * A client component reading a namespace its page does not ship shows the
 * raw key ("VideoReport.open") instead of words. Each client subtree's list
 * (namespaces.ts) must cover every namespace its components read.
 */
import {readdirSync, readFileSync, statSync} from "node:fs";
import {join} from "node:path";

import {describe, expect, it} from "vitest";

import {LEARN_CLIENT_NAMESPACES, MESSAGES_CLIENT_NAMESPACES, SELLER_CLIENT_NAMESPACES} from "./namespaces";

const ROOT = join(__dirname, "..");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.tsx$/.test(name) && !/\.test\./.test(name) ? [path] : [];
  });
}

function clientNamespaces(dir: string) {
  const used = new Set<string>();
  for (const path of files(join(ROOT, dir))) {
    const source = readFileSync(path, "utf8");
    if (!source.includes('"use client"')) continue;
    for (const match of source.matchAll(/useTranslations\(\s*"([A-Za-z]+)"/g)) used.add(match[1]);
  }
  return used;
}

describe("each client subtree ships the messages its components read", () => {
  it.each([
    ["components/learn", LEARN_CLIENT_NAMESPACES],
    ["components/seller", SELLER_CLIENT_NAMESPACES],
    ["components/messages", MESSAGES_CLIENT_NAMESPACES],
  ] as const)("%s", (dir, shipped) => {
    const missing = [...clientNamespaces(dir)].filter((name) => !(shipped as readonly string[]).includes(name));
    expect(missing).toEqual([]);
  });
});
