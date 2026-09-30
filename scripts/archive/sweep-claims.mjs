/**
 * Apply the claim hygiene rules to claims written before those rules existed.
 *
 * Three rules, all already enforced on new claims:
 *   - a claim about the investigation is not a claim
 *   - a FACT with no document behind it is an INFERENCE
 *   - confidence may not exceed its own label's ceiling
 *
 * Archives rather than deletes. The filter is a regex and regexes are wrong
 * sometimes — an earlier version of this one ate "Hops are grown in the county",
 * a real claim about the town. Anything it removes stays in `discarded_claims`
 * with the reason, so a bad call is visible and reversible.
 *
 *   node scripts/with-app-env.mjs node scripts/sweep-claims.mjs --dry
 *   node scripts/with-app-env.mjs node scripts/sweep-claims.mjs --apply
 */
import { getSql } from "../src/lib/db.ts";
import { isSelfReferential, labelAfterCitationCheck } from "../src/lib/news/claim-hygiene.ts";
import { clampConfidenceToLabel } from "../src/lib/news/investigate.ts";

const apply = process.argv.includes("--apply");
const sql = await getSql();

await sql`
  create table if not exists discarded_claims (
    id integer primary key,
    investigation_id integer,
    body text not null,
    kind text not null,
    confidence real,
    source_url text,
    reason text not null,
    discarded_at timestamptz not null default now()
  )
`;

const all = await sql`
  select id, investigation_id, kind, body, confidence, source_url, version_id, capture_event_id
  from claims order by id
`;

const drop = [];
const relabel = [];
const recap = [];

for (const c of all) {
  if (isSelfReferential(c.body)) {
    drop.push(c);
    continue;
  }
  const kind = labelAfterCitationCheck(c.kind, {
    source_url: c.source_url,
    artifact_version_id: c.version_id,
    capture_event_id: c.capture_event_id,
  });
  if (kind !== c.kind) relabel.push({ ...c, kind });
  const conf = clampConfidenceToLabel(
    kind,
    c.confidence == null ? undefined : Number(c.confidence),
  );
  if (conf != null && c.confidence != null && Math.abs(conf - Number(c.confidence)) > 0.001) {
    recap.push({ ...c, kind, conf });
  }
}

console.log(`${all.length} claims read`);
console.log(`  archive (about the investigation, not the town): ${drop.length}`);
console.log(`  relabel (uncited FACT -> INFERENCE):             ${relabel.length}`);
console.log(`  lower confidence to its ceiling:                 ${recap.length}`);
console.log(`  untouched:                                       ${all.length - drop.length - relabel.length}`);

if (!apply) {
  console.log("\nDRY RUN — nothing changed. Re-run with --apply.");
  console.log("\nsample of what would be archived:");
  drop.slice(0, 5).forEach((c) => console.log(`  [${c.kind}] ${c.body.slice(0, 95)}`));
  console.log("\nsample of what would be KEPT:");
  all.filter((c) => !isSelfReferential(c.body)).slice(0, 5)
    .forEach((c) => console.log(`  [${c.kind}] ${c.body.slice(0, 95)}`));
  process.exit(0);
}

for (const c of drop) {
  await sql`
    insert into discarded_claims (id, investigation_id, body, kind, confidence, source_url, reason)
    values (${c.id}, ${c.investigation_id}, ${c.body}, ${c.kind}, ${c.confidence}, ${c.source_url},
            'about the investigation, not the town')
    on conflict (id) do nothing
  `;
  await sql`delete from claims where id = ${c.id}`;
}
for (const c of relabel) {
  await sql`update claims set kind = ${c.kind} where id = ${c.id}`;
}
for (const c of recap) {
  await sql`update claims set confidence = ${c.conf} where id = ${c.id}`;
}

const left = (await sql`select count(*)::int as n from claims`)[0].n;
const kept = (await sql`select count(*)::int as n from discarded_claims`)[0].n;
console.log(`\nApplied. ${left} claims remain, ${kept} archived in discarded_claims.`);
process.exit(0);
