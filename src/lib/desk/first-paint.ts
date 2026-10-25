/**
 * D2 -- the side-nav Drafts count is right on the first paint after a reload.
 *
 * The nav's counts are read by the shell, and the shell mounts after the desk
 * gate (`routes/desk.tsx`) has its own reads back. Before this, the Drafts count
 * was one more read that started only then, so on a reload the Drafts item had no
 * number for one server round trip and then showed it. The gate now reads that
 * count with the reads it already waits on, and holds its first paint until the
 * count has settled, so the shell mounts with the number already in the cache.
 *
 * The rule: a read holds the first paint while it is pending. A read that failed
 * does not hold it -- a broken count must not keep the desk on its opening screen
 * (the shell then draws the item without a number, as it always did).
 *
 * Kept free of imports so a test can load it with `--experimental-strip-types`.
 */
export type FirstPaintRead = { readonly isPending: boolean };

export function holdsFirstPaint(...reads: readonly FirstPaintRead[]): boolean {
  return reads.some((read) => read.isPending);
}
