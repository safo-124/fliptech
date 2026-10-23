/**
 * Working with message catalogues as data: flattening, filling gaps, and
 * checking a translation against English.
 *
 * A translation is allowed to be unfinished. Whatever it leaves out is shown
 * in English, which is better than a trainee reading "EnquiryForm.phoneLabel"
 * and better than holding a whole language back for its last few strings.
 * What a translation is not allowed to do is change a message's shape: drop
 * the {name} a sentence needs, or a <strong> the page renders. That is what
 * catalogueProblems() catches, in the catalogue test and in the import script.
 */

export type MessageTree = { [key: string]: string | MessageTree };

/** Every message as [dotted.key, text]. */
export function leaves(tree: MessageTree, prefix = ""): Array<[string, string]> {
  return Object.entries(tree).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [[path, value] as [string, string]] : leaves(value, path);
  });
}

/**
 * English, with every message the translation has filled in put in its place.
 * Keys English does not have are dropped: they belong to text since removed.
 */
export function withFallback<T extends MessageTree>(english: T, translation: MessageTree): T {
  const out: MessageTree = {};
  for (const [key, value] of Object.entries(english)) {
    const theirs = translation[key];
    if (typeof value === "string") {
      out[key] = typeof theirs === "string" && theirs.trim() ? theirs : value;
    } else {
      out[key] = withFallback(value, typeof theirs === "object" && theirs ? theirs : {});
    }
  }
  return out as T;
}

/**
 * The arguments and tags a message uses: {name}, {count, plural, ...} and
 * <strong>. Plural and select branches may be worded differently in another
 * language, so only the argument names are compared, not what is inside.
 */
export function shapeOf(message: string): string[] {
  const names = new Set<string>();
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
  return [...names].sort();
}

/** What is wrong with a translation, as sentences a translator can act on. */
export function catalogueProblems(english: MessageTree, translation: MessageTree): string[] {
  const reference = new Map(leaves(english));
  const problems: string[] = [];
  for (const [key, text] of leaves(translation)) {
    const original = reference.get(key);
    if (original === undefined) {
      problems.push(`${key}: not in English, so it is never shown. Remove it.`);
      continue;
    }
    if (!text.trim()) continue;
    const want = shapeOf(original).join(" ");
    const have = shapeOf(text).join(" ");
    if (want !== have) {
      problems.push(`${key}: must use ${want || "no arguments or tags"}, but uses ${have || "none"}.`);
    }
  }
  return problems;
}

/** How much of English a translation covers, for reporting. */
export function coverage(english: MessageTree, translation: MessageTree) {
  const filled = new Set(
    leaves(translation)
      .filter(([, text]) => text.trim())
      .map(([key]) => key),
  );
  const total = leaves(english).length;
  const done = leaves(english).filter(([key]) => filled.has(key)).length;
  return { done, total };
}
