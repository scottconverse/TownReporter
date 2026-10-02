/** Shared React Query key. Keep this module dependency-free so client bundles
 * can import it without pulling server-only provider discovery code. */
export const PROVIDER_AVAILABILITY_QUERY_KEY = ["provider-availability"] as const;

/**
 * The F3b first-run picker default, keyed per surface so the four desk pages
 * that open a picker share one read when they mount together (Today draws the
 * story picker; a page that opens two shares it too).
 */
export function firstRunPickerKey(surface: string): readonly [string, string] {
  return ["first-run-picker-default", surface];
}
