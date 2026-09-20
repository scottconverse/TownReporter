/**
 * Pure safety logic for the desk production regression.
 *
 * Extracted from scripts/desk-production-regression.mjs so the claims the walk
 * makes about itself can be tested directly:
 *   - it does not claim no-side-effects when snapshots could not be collected;
 *   - it compares deterministic hashes as well as counts;
 *   - it records observed request methods and fails on mutating ones;
 *   - it discloses the intentionally mutating first-run setup step.
 */

export function snapshotTableSpecs() {
  return [
    {
      table: "articles",
      countSql: "select count(*)::int as count from articles",
      hashSql: "select coalesce(md5(string_agg(t::text, '|' order by t.id)), md5('')) as hash from articles t",
    },
    {
      table: "leads",
      countSql: "select count(*)::int as count from leads",
      hashSql: "select coalesce(md5(string_agg(t::text, '|' order by t.id)), md5('')) as hash from leads t",
    },
    {
      table: "scan_runs",
      countSql: "select count(*)::int as count from scan_runs",
      hashSql: "select coalesce(md5(string_agg(t::text, '|' order by t.id)), md5('')) as hash from scan_runs t",
    },
    {
      table: "drafts",
      countSql: "select count(*)::int as count from drafts",
      hashSql: "select coalesce(md5(string_agg(t::text, '|' order by t.id)), md5('')) as hash from drafts t",
    },
  ];
}

export function assertNoSideEffects(before, after) {
  if (!before?.counts || !after?.counts) {
    throw new Error(
      "side-effect snapshot was not collected; refusing to claim no-side-effects (set DATABASE_URL to a disposable database)",
    );
  }
  if (!before?.hashes || !after?.hashes) {
    throw new Error(
      "side-effect snapshot hashes were not collected; refusing to claim no-side-effects",
    );
  }
  const diffs = [];
  for (const key of Object.keys(before.counts)) {
    if (before.counts[key] !== after.counts[key]) {
      diffs.push(`${key} count: ${before.counts[key]} -> ${after.counts[key]}`);
    }
  }
  for (const key of Object.keys(before.hashes)) {
    if (before.hashes[key] !== after.hashes[key]) {
      diffs.push(`${key} hash changed`);
    }
  }
  if (diffs.length) throw new Error(`side effects detected: ${diffs.join("; ")}`);
  return { passed: true, note: "counts and deterministic hashes identical before and after" };
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

export function assertNoMutatingRequests(requests) {
  const mutating = requests.filter((r) => !READ_METHODS.has(String(r.method).toUpperCase()));
  if (mutating.length) {
    throw new Error(
      `mutating request detected: ${mutating.map((r) => `${r.method} ${r.url}`).join(", ")}`,
    );
  }
  return [];
}

export function setupStepDisclosure(usedSetupStep) {
  return usedSetupStep
    ? "intentionally mutating setup step: creates a throwaway owner and completes first-run setup on the disposable database"
    : null;
}
