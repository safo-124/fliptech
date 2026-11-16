/**
 * Pages that show a signed-in person's own things. They are never kept by
 * the browser (next.config sends Cache-Control: no-store), and one brought
 * back by Back or Forward after signing out checks the session again
 * (components/PrivatePageGuard.tsx). Keep the two lists the same: this one.
 */
export const PRIVATE_PREFIXES = [
  "/account",
  "/trainee",
  "/trainer",
  "/sell",
  "/inbox",
  "/dashboard",
  "/learn/mine",
] as const;

export function isPrivatePath(path: string) {
  return PRIVATE_PREFIXES.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
