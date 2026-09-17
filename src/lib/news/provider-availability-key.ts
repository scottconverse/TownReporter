/** Shared React Query key. Keep this module dependency-free so client bundles
 * can import it without pulling server-only provider discovery code. */
export const PROVIDER_AVAILABILITY_QUERY_KEY = ["provider-availability"] as const;
