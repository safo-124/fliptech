import styles from "./Stamp.module.css";

/**
 * A rubber stamp: the first line large, the rest small beneath it.
 *
 * `empty` draws the dashed outline of a stamp nobody has pressed, for
 * something not done or not claimed. Saying so in the same shape as the real
 * thing is the point: a trainee sees at once that a box is empty, rather than
 * not noticing that it is missing. Styles in Stamp.module.css.
 */
export function Stamp({
  tone,
  lines,
  empty = false,
  className = "",
}: {
  tone: "visit" | "gov" | "muted";
  lines: readonly [string, ...string[]];
  empty?: boolean;
  className?: string;
}) {
  const [title, ...rest] = lines;
  return (
    <span className={`${styles.stamp} ${styles[tone]} ${empty ? styles.empty : ""} ${className}`}>
      <span>{title}</span>
      {rest.map((line) => (
        <span key={line} className={styles.line}>
          {line}
        </span>
      ))}
    </span>
  );
}

/** "Ama Mensah" → "A.M.": a stamp carries initials, the sentence beside it the name. */
export function initialsOf(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((word) => `${word[0]!.toUpperCase()}.`)
    .join("");
}
