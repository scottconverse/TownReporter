/**
 * The one list of deliberate differences between our registry rows and a
 * literal HSDS 3.0 bundle (spec sections 7.3 and 15.3).
 *
 * The compatibility test imports a sample bundle, rebuilds it, and asserts no
 * field is lost or renamed. Each entry below names something the test does not
 * require to survive that round trip, and why.
 */

export interface Divergence {
  /** Where the difference shows up, in HSDS terms. */
  area: string;
  /** What does not round-trip. */
  difference: string;
  /** Why we accept it. */
  reason: string;
}

export const HSDS_DIVERGENCES: readonly Divergence[] = [
  {
    area: "verification metadata",
    difference:
      "last_verified_at, verification_method, last_verified_by, source_id and source_capture_id are not HSDS fields and are not exported.",
    reason:
      "HSDS has no concept of provenance or verification. Ours sit alongside the HSDS fields, never inside them (section 7.2).",
  },
  {
    area: "published",
    difference: "The published flag is ours and is not exported.",
    reason:
      "Export ships only published, verified rows, so the flag itself has nothing to say once a row is in a bundle (section 15.2).",
  },
  {
    area: "phones without an id",
    difference:
      "A nested phone that carries no id in the source bundle comes back with a generated id (\"<parent>:phone:<index>\").",
    reason:
      "The importer needs a stable key to match a re-import against, and HSDS does not require an id on a nested phone.",
  },
  {
    area: "accessibility on both a service and a location",
    difference:
      "An accessibility row that names both a service and a location is rebuilt under the service only.",
    reason:
      "The nested bundle has no place for a row that belongs to both; the pair is kept in the row, only the nesting is lossy.",
  },
  {
    area: "taxonomies",
    difference:
      "A bundle with no taxonomies comes back with no taxonomies key at all.",
    reason: "An absent array and an empty array mean the same thing in HSDS.",
  },
] as const;
