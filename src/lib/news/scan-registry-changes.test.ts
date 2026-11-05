import { after, before, it } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { getSql } from "../db.ts";
import type { DeskJob } from "./jobs.ts";
import { applyMigrationsToTestPglite } from "../test-support/pglite-migrations.ts";
import { DUP_CHECK_SYSTEM, SAME_STORY_SYSTEM } from "./dup-check.ts";

/*
  NAV-P1 (spec 14): the scan feeds the registry.

  These run the real `performScanWork` on the test PGlite with a fake model.
  One source is both a news source and a registry source (guardrail 6). The
  fake reply carries a lead, a registry change that names a real service, and a
  registry change that cites a page this run never fetched. After the run:

  - the lead is filed exactly as before;
  - the matched change is a pending `resource_changes` row bound to this run,
    the source, and this fetch's capture;
  - the change that cites an unfetched page is rejected, and the run's own
    summary says so;
  - the service row is untouched and still unpublished (guardrail 2).
*/

await applyMigrationsToTestPglite();

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/"))
      specifier = new URL("../../" + specifier.slice(2), import.meta.url).href;
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (!specifier.startsWith(".") && !specifier.startsWith("file:")) throw error;
      const url = new URL(specifier, context.parentURL);
      for (const suffix of [".ts", ".tsx"]) {
        if (existsSync(fileURLToPath(url) + suffix)) return nextResolve(url.href + suffix, context);
      }
      throw error;
    }
  },
});

let scan: typeof import("./desk.ts").performScanWork;
before(async () => {
  scan = (await import("./desk.ts")).performScanWork;
});
after(() => hooks.deregister());

const ROOM = 9450;
const USER = "registry-scan-owner";
const SOURCE_URL = "https://registry-scan.test/resources";
const UNFETCHED_URL = "https://registry-scan.test/never-read";

it("a changed registry source proposes changes without writing the registry, and still files its leads", async () => {
  const sql = await getSql();
  await sql`insert into newsrooms(id,name) values(${ROOM},'Registry scan fixture')`;
  await sql`insert into newsroom_members(user_id,newsroom_id,role) values(${USER},${ROOM},'owner')`;

  const [source] = await sql<{ id: number }>`
    insert into sources(user_id,newsroom_id,url,title,kind,tier,status)
    values(${USER},${ROOM},${SOURCE_URL},'Resource navigation','news','B','accepted')
    returning id`;
  await sql`insert into resource_sources(newsroom_id,source_id,registry_role,directory_name)
    values(${ROOM},${source!.id},'directory','Resource navigation')`;

  const [org] = await sql<{ id: number }>`
    insert into organizations(newsroom_id,hsds_id,name) values(${ROOM},'org-scan','Example Org')
    returning id`;
  const [service] = await sql<{ id: number }>`
    insert into services(newsroom_id,hsds_id,organization_id,name)
    values(${ROOM},'svc-scan',${org!.id},'Weekly grocery pickup') returning id`;

  const [run] = await sql<{ id: number }>`
    insert into scan_runs(user_id,newsroom_id) values(${USER},${ROOM}) returning id`;
  const [job] = await sql<DeskJob>`
    insert into desk_jobs(user_id,newsroom_id,subject_id,kind,model_choice,model_choice_source,status,claim_token)
    values(${USER},${ROOM},${run!.id},'scan','grok','editor','running',${`registry-${ROOM}`})
    returning *`;

  const pageText =
    "Resource navigation. The pantry's phone number changed to 555-0199 this week. " +
    "The council also votes Tuesday on the water contract. ".repeat(20);

  let scanCalls = 0;
  const grokChat = async (system: string) => {
    if (system === SAME_STORY_SYSTEM || system === DUP_CHECK_SYSTEM) {
      return { ok: true as const, text: "[]" };
    }
    scanCalls += 1;
    return {
      ok: true as const,
      text: JSON.stringify({
        editor_summary: "The pantry has a new phone number and the council votes on water.",
        leads: [
          {
            headline: "Longmont council votes Tuesday on a new water contract",
            why: "The council will decide the contract Tuesday.",
            topic: "council",
            source_urls: [SOURCE_URL],
            evidence: "The council also votes Tuesday on the water contract.",
            newsworthiness: 9,
            is_event: true,
          },
        ],
        resource_changes: [
          {
            entity_type: "service",
            entity_hsds_id: "svc-scan",
            entity_name: "Weekly grocery pickup",
            field_name: "phone",
            before_value: "555-0100",
            after_value: "555-0199",
            change_kind: "contact_change",
            summary: "The pantry has a new phone number.",
            model_confidence: 0.92,
            source_url: SOURCE_URL,
          },
          {
            // Cites a page this run never fetched: no retained capture, so it
            // must be rejected rather than stored unverified.
            entity_type: "organization",
            entity_name: "Some Other Org",
            field_name: "website",
            before_value: null,
            after_value: "https://other.test/",
            change_kind: "field_change",
            summary: "A new website.",
            model_confidence: 0.8,
            source_url: UNFETCHED_URL,
          },
        ],
        proposed_sources: [],
      }),
    };
  };

  await scan(job!, {
    ingestUrl: async () => ({ text: pageText, titleHint: "Resource navigation", extras: [] }),
    grokChat: grokChat as never,
    setJobStage: async () => {},
    setJobModelChoice: async () => {},
  });

  assert.equal(scanCalls, 1, "one batch was read");

  // Guardrail 6: the source is both a news source and a registry source, and
  // its lead is still filed.
  const leads = await sql<{ headline: string }>`
    select headline from leads where scan_run_id = ${run!.id}`;
  assert.equal(leads.length, 1);

  const changes = await sql<{
    review_state: string;
    evidence_tier: string;
    entity_type: string;
    entity_id: number | null;
    scan_run_id: number;
    source_id: number;
    evidence_capture_id: number;
    lead_id: number | null;
    after_value: string | null;
  }>`
    select review_state,evidence_tier,entity_type,entity_id,scan_run_id,source_id,
           evidence_capture_id,lead_id,after_value
      from resource_changes where newsroom_id = ${ROOM}`;

  assert.equal(changes.length, 1, "the uncaptured change was rejected, not stored");
  const stored = changes[0]!;
  assert.equal(stored.review_state, "pending");
  assert.equal(stored.evidence_tier, "B");
  assert.equal(stored.entity_type, "service");
  assert.equal(Number(stored.entity_id), Number(service!.id));
  assert.equal(Number(stored.scan_run_id), Number(run!.id));
  assert.equal(Number(stored.source_id), Number(source!.id));
  assert.equal(stored.after_value, "555-0199");
  assert.equal(stored.lead_id, null, "lead filing from changes is Phase 2");

  const [snapshot] = await sql<{ id: number }>`
    select id from snapshots where source_id = ${source!.id} order by id desc limit 1`;
  assert.equal(Number(stored.evidence_capture_id), Number(snapshot!.id));

  // Guardrail 2: the registry itself was not written.
  const [savedService] = await sql<{ name: string; published: boolean }>`
    select name, published from services where id = ${service!.id}`;
  assert.deepEqual(savedService, { name: "Weekly grocery pickup", published: false });

  const [savedRun] = await sql<{ summary: string }>`
    select summary from scan_runs where id = ${run!.id}`;
  assert.match(String(savedRun!.summary), /1 registry change proposal filed for review/);
  assert.match(String(savedRun!.summary), /rejected for lack of a retained capture/);
});
