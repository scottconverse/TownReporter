import { test } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import {
  ensureInvestigateSchema,
  emptyPlan,
  observeBaseline,
  checkBaselines,
  rememberCapture,
  researchLoop,
  resurfaceDeadEnds,
  retrievePack,
  type HopPlan,
} from "./investigate.ts";

async function investigation(room: number) {
  await ensureInvestigateSchema();
  const sql = await getSql();
  const row = (
    await sql<{
      id: number;
    }>`insert into investigations(user_id,newsroom_id,title) values ('scope-editor',${room},'Scope file') returning id`
  )[0]!;
  return { sql, id: row.id };
}
async function run(room: number, id: number, plan: HopPlan) {
  return researchLoop({
    userId: "scope-editor",
    newsroomId: room,
    investigationId: id,
    hops: 1,
    search: async () => [],
    fetch: async () => ({ ok: false, status: 404, text: "", title: "", extras: [] }),
    archives: async () => [],
    planner: async () => plan,
  });
}

test(
  "the same editor can persist the same possible identity pair in two newsrooms",
  { timeout: 120000 },
  async () => {
    const first = await investigation(165);
    const second = await investigation(166);
    for (const room of [165, 166])
      await first.sql`
    insert into entities(user_id,newsroom_id,canonical,name,kind,why)
    values('scope-editor',${room},'shared identity holdings llc','Shared Identity Holdings LLC','company',${`KNOWN_ROOM_${room}`})`;
    for (const [room, id] of [
      [165, first.id],
      [166, second.id],
    ]) {
      const plan = emptyPlan();
      plan.entities = [
        { name: "Shared Identity Holdings Inc", kind: "company", why: `PRIVATE_ROOM_${room}` },
      ];
      await run(room!, id!, plan);
    }
    for (const table of ["entity_aliases", "entity_matches"]) {
      const rows = await first.sql.query<{ newsroom_id: number; evidence: string }>(
        `select newsroom_id,evidence from ${table} where user_id=$1 and newsroom_id in (165,166) order by newsroom_id`,
        ["scope-editor"],
      );
      assert.deepEqual(
        rows,
        [
          { newsroom_id: 165, evidence: "PRIVATE_ROOM_165" },
          { newsroom_id: 166, evidence: "PRIVATE_ROOM_166" },
        ],
        `${table} must retain both newsroom records for the same user and names`,
      );
    }
    const repeat = emptyPlan();
    repeat.entities = [
      { name: "Shared Identity Holdings Inc", kind: "company", why: "PRIVATE_ROOM_166" },
    ];
    await run(166, second.id, repeat);
    for (const table of ["entity_aliases", "entity_matches"]) {
      const rows = await first.sql.query<{ newsroom_id: number; count: number }>(
        `select newsroom_id,count(*)::integer as count from ${table} where user_id=$1 and newsroom_id in (165,166) group by newsroom_id order by newsroom_id`,
        ["scope-editor"],
      );
      assert.deepEqual(
        rows,
        [
          { newsroom_id: 165, count: 1 },
          { newsroom_id: 166, count: 1 },
        ],
        `${table} retries stay idempotent within each newsroom`,
      );
    }
  },
);

test(
  "plan writes and model history stay inside the owning newsroom",
  { timeout: 120000 },
  async () => {
    const { sql, id } = await investigation(82);
    const foreign = await investigation(1);
    const entity = (
      await sql<{
        id: number;
      }>`insert into entities(user_id,newsroom_id,canonical,name,kind,why) values ('other',1,'acme works','Acme Works','company','FOREIGN_PRIVATE_REASON') returning id`
    )[0]!.id;
    await sql`insert into investigation_entities(user_id,newsroom_id,investigation_id,entity_id) values ('other',1,${foreign.id},${entity})`;
    const plan = emptyPlan();
    plan.entities = [{ name: "Acme Works", kind: "company", why: "OWN_REASON" }];
    plan.claims = [
      { text: "Question about own company", kind: "HYPOTHESIS", evidence: "Unverified own quote" },
    ];
    plan.relationships = [
      { from: "Acme Works", to: "Board", kind: "question", evidence: "Own evidence" },
    ];
    plan.hypotheses = [
      { text: "Own hypothesis", supporting: "Own support", contradicting: "Own counter" },
    ];
    plan.dead_ends = [{ hypothesis: "Own closed question", reason: "Resolved own question" }];
    await run(82, id, plan);
    const entities = await sql<{
      newsroom_id: number;
      why: string;
    }>`select e.newsroom_id,e.why from entities e join investigation_entities ie on ie.entity_id=e.id where ie.investigation_id=${id}`;
    assert.equal(entities[0]?.newsroom_id, 82);
    for (const table of [
      "claims",
      "relationships",
      "hypotheses",
      "dead_ends",
      "frontier_items",
      "investigation_entities",
    ]) {
      const rows = await sql.query<{ newsroom_id: number }>(
        `select newsroom_id from ${table} where investigation_id=$1`,
        [id],
      );
      assert.ok(rows.length > 0, table);
      assert.ok(
        rows.every((r) => r.newsroom_id === 82),
        table,
      );
    }
    const pack = await retrievePack("scope-editor", id, ["Acme"]);
    assert.match(pack, /OWN_REASON/);
    assert.doesNotMatch(pack, /FOREIGN_PRIVATE_REASON/);
  },
);

test(
  "recurring baselines are separate even for the same source URL",
  { timeout: 120000 },
  async () => {
    const { sql } = await investigation(83);
    const url = "https://example.org/weekly-board/agenda";
    await observeBaseline(
      "scope-editor",
      url,
      "City Council agenda",
      new Date("2026-01-01"),
      [],
      1,
    );
    await observeBaseline(
      "scope-editor",
      url,
      "City Council agenda",
      new Date("2026-02-01"),
      [],
      83,
    );
    const rows = await sql<{
      newsroom_id: number;
      sightings: number;
    }>`select newsroom_id,sightings from recurring_baselines where typical_url=${url} order by newsroom_id`;
    assert.deepEqual(
      rows.map((r) => r.newsroom_id),
      [1, 83],
    );
    assert.ok(rows.every((r) => r.sightings === 1));
  },
);

test(
  "baseline checks do not create anomalies from another newsroom's schedule",
  { timeout: 120000 },
  async () => {
    const { id } = await investigation(89);
    await observeBaseline(
      "scope-editor",
      "https://example.org/private-council/agenda",
      "City Council agenda",
      new Date("2020-01-01"),
      [],
      1,
    );
    assert.equal(await checkBaselines("scope-editor", id, new Date("2026-09-01"), 89), 0);
  },
);

test(
  "a missing or foreign investigation stops before the planner runs",
  { timeout: 120000 },
  async () => {
    const { id } = await investigation(90);
    for (const inv of [id, -12345]) {
      await assert.rejects(run(91, inv, emptyPlan()), /not found in this newsroom/);
    }
  },
);

test(
  "a new room cannot resurrect another room's private dead end",
  { timeout: 120000 },
  async () => {
    const { sql, id } = await investigation(84);
    const other = await investigation(1);
    await sql`insert into dead_ends(user_id,newsroom_id,investigation_id,hypothesis,dismissed_because,entities) values ('other',1,${other.id},'Zephyr Components secret issue','PRIVATE_FOREIGN_REASON','Zephyr Components')`;
    assert.equal(await resurfaceDeadEnds("scope-editor", id, ["Zephyr Components"]), 0);
    await sql`insert into dead_ends(user_id,newsroom_id,investigation_id,hypothesis,dismissed_because,entities) values ('scope-editor',84,${id},'Zephyr Components own issue','OWN_REASON','Zephyr Components')`;
    assert.equal(await resurfaceDeadEnds("scope-editor", id, ["Zephyr Components"]), 1);
  },
);

test(
  "model-supplied foreign capture/version IDs cannot resolve private evidence",
  { timeout: 120000 },
  async () => {
    const { sql, id } = await investigation(85);
    const other = await investigation(86);
    const quote = "FOREIGN_PRIVATE_QUOTE contract amount is forty million dollars";
    const url = "https://example.org/private-foreign-capture";
    await rememberCapture({
      userId: "other",
      newsroomId: 86,
      investigationId: other.id,
      url,
      title: "Private source",
      text: quote,
      hash: "foreign-provenance",
      status: 200,
      outcome: "fetched",
    });
    const capture = (
      await sql<{
        id: number;
        version_id: number;
      }>`select id,version_id from capture_events where investigation_id=${other.id}`
    )[0]!;
    const plan = emptyPlan();
    plan.claims = [
      {
        text: "Foreign version attempt",
        kind: "FACT",
        evidence: quote,
        artifact_version_id: capture.version_id,
      },
      {
        text: "Foreign capture attempt",
        kind: "FACT",
        evidence: quote,
        capture_event_id: capture.id,
      },
      { text: "Foreign URL attempt", kind: "FACT", evidence: quote, source_url: url },
    ];
    await run(85, id, plan);
    const claims = await sql<{
      version_id: number | null;
      capture_event_id: number | null;
      provenance_status: string;
    }>`select version_id,capture_event_id,provenance_status from claims where investigation_id=${id}`;
    assert.equal(claims.length, 3);
    assert.ok(
      claims.every(
        (c) =>
          c.version_id === null &&
          c.capture_event_id === null &&
          c.provenance_status === "unresolved",
      ),
    );
  },
);

test(
  "a quote from source B cannot verify a citation to source A",
  { timeout: 120000 },
  async () => {
    const { sql, id } = await investigation(92);
    const quote = "SOURCE_B_ONLY_QUOTE the contract cost forty million dollars";
    for (const name of ["A", "B"]) {
      const text =
        name === "B" ? quote : "SOURCE_A_DIFFERENT_TEXT about the council meeting schedule";
      await rememberCapture({
        userId: "scope-editor",
        newsroomId: 92,
        investigationId: id,
        url: `https://example.org/wrong-citation-${name}`,
        title: name,
        text,
        hash: `citation-${name}`,
        status: 200,
        outcome: "fetched",
      });
    }
    const versionA = (
      await sql<{ id: number }>`select id from artifact_versions where newsroom_id=92 and title='A'`
    )[0]!.id;
    const plan = emptyPlan();
    plan.claims = [
      {
        text: "Wrong citation attempt",
        kind: "FACT",
        evidence: quote,
        artifact_version_id: versionA,
      },
    ];
    await run(92, id, plan);
    const claim = (
      await sql<{
        provenance_status: string;
      }>`select provenance_status from claims where investigation_id=${id}`
    )[0]!;
    assert.equal(claim.provenance_status, "unresolved");
  },
);
