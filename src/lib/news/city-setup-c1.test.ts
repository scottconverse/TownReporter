/*
  CITY-SETUP slice C1: the REPORTING side (desk.ts / extract.ts / investigate.ts
  / paper.ts) reads the configured city and timezone instead of the hard-coded
  PAPER constant. Before this slice, a second city's paper still told the
  model "City: Longmont, Colorado" (desk.ts:530), still built search queries
  and ran the on-subject check against "Longmont" (desk.ts:854/937), and still
  rendered every date in America/Denver (extract.ts:245, investigate.ts:1288,
  paper.ts:191/202/215) no matter what the operator configured.
*/
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { PAPER } from "../paper.ts";
import { formatDate, formatDateTime, formatShortDate } from "../paper.ts";
import { ensurePaperSettingsSchema, getPaperConfig } from "./paper-settings.ts";
import { buildScanUserMessage } from "./desk-copy.ts";
import { isOnSubject, pullQueries } from "./pull-plan.ts";
import { nthWeekday } from "./extract.ts";
import { ensureInvestigateSchema, observeBaseline } from "./investigate.ts";

// 8:10pm Wednesday MDT (America/Denver) is already Thursday in UTC -- the
// same instant used in paper.test.ts, reused here so a wrong timezone shows
// up as a wrong weekday, not a wrong hour.
const DENVER_WED_UTC_THU = "2026-08-27T02:10:00.000Z";

describe("C1: model prompt carries the configured city, not Longmont", () => {
  it("a configured city/state reaches the scan prompt", () => {
    const msg = buildScanUserMessage({
      city: "Riverbend",
      state: "Oregon",
      reread: false,
      memory: [],
      payload: "(no source text this run)",
    });
    assert.match(msg, /^City: Riverbend, Oregon\./);
    assert.doesNotMatch(msg, /Longmont/);
  });

  it("falls back to the shipped constant when nothing is configured", async () => {
    // The exact values getPaperConfig() returns for a newsroom with no
    // paper_settings row -- proving the fallback path (not just the literal
    // PAPER constant) produces the unchanged Longmont prompt.
    const newsroomId = 900_301;
    await ensurePaperSettingsSchema();
    // observeBaseline writes to recurring_baselines, which no other suite in
    // this process has created yet under PGLite.
    await ensureInvestigateSchema();
    const sql = await getSql();
    await sql`delete from paper_settings where newsroom_id = ${newsroomId}`;
    const cfg = await getPaperConfig(newsroomId);
    const msg = buildScanUserMessage({
      city: cfg.city,
      state: cfg.state,
      reread: false,
      memory: [],
      payload: "",
    });
    assert.match(msg, new RegExp(`^City: ${PAPER.city}, ${PAPER.state}\\.`));
  });
});

describe("C1: on-subject check and pull queries follow the configured city", () => {
  it("a document naming only the configured city is on-subject for that city, not Longmont", () => {
    const text = "The Riverbend Planning Commission approved the permit at Tuesday's meeting.";
    assert.equal(isOnSubject(text, [], "Riverbend", "Oregon"), true);
    // The same text names neither Longmont nor Colorado -- the exact gap
    // that let three off-subject documents through before this gate existed.
    assert.equal(isOnSubject(text, [], "Longmont", "Colorado"), false);
  });

  it("pull queries anchor to the configured city", () => {
    const qs = pullQueries("Get the adopted resolution", [], "Riverbend");
    assert.match(qs[0]!, /Riverbend/);
    assert.doesNotMatch(qs[0]!, /Longmont/);
  });
});

describe("C1: date rendering follows the configured timezone", () => {
  it("paper.ts helpers default to PAPER.timezone with no override", () => {
    assert.equal(formatDate(DENVER_WED_UTC_THU), "Wednesday, August 26, 2026");
    assert.equal(formatShortDate(DENVER_WED_UTC_THU), "Aug 26, 2026");
    assert.match(formatDateTime(DENVER_WED_UTC_THU), /Aug 26, 2026, 8:10 PM/);
  });

  it("a configured timezone changes the rendered date", () => {
    assert.equal(formatDate(DENVER_WED_UTC_THU, "UTC"), "Thursday, August 27, 2026");
    assert.equal(formatShortDate(DENVER_WED_UTC_THU, "UTC"), "Aug 27, 2026");
    assert.match(formatDateTime(DENVER_WED_UTC_THU, "UTC"), /Aug 27, 2026, 2:10 AM/);
  });

  it("nthWeekday defaults to PAPER.timezone and moves under an explicit zone", () => {
    const denver = nthWeekday(new Date(DENVER_WED_UTC_THU));
    const utc = nthWeekday(new Date(DENVER_WED_UTC_THU), "UTC");
    assert.match(denver, /Wednesday$/);
    assert.match(utc, /Thursday$/);
    assert.notEqual(denver, utc);
  });
});

describe("C1: observeBaseline reads the configured timezone (default newsroom)", () => {
  it("records the weekday in the configured timezone instead of always Denver", async () => {
    await ensurePaperSettingsSchema();
    // observeBaseline writes to recurring_baselines, which no other suite in
    // this process has created yet under PGLite.
    await ensureInvestigateSchema();
    const sql = await getSql();
    // DEFAULT_NEWSROOM_ID (1): observeBaseline hardcodes this newsroom id
    // already (it does not take one as a parameter), so this is the row it
    // reads. Save whatever is there, restore it after -- this is the shared
    // singleton row other suites also touch read-only.
    const before = await sql<{ timezone: string | null }>`
      select timezone from paper_settings where newsroom_id = 1
    `;
    await sql`
      insert into paper_settings (newsroom_id, timezone) values (1, ${"UTC"})
      on conflict (newsroom_id) do update set timezone = excluded.timezone
    `;
    try {
      const cfg = await getPaperConfig(1);
      assert.equal(cfg.timezone, "UTC");
      const user = `c1-baseline-${Date.now()}`;
      const url = "https://riverbend.example.gov/agenda/packet.html";
      await observeBaseline(user, url, "City Council minutes", new Date(DENVER_WED_UTC_THU));
      const spec = await sql<{ usual_weekday: string | null }>`
        select usual_weekday from recurring_baselines
        where newsroom_id = 1 and key like ${"%agenda%"}
        order by id desc limit 1
      `;
      assert.equal(spec[0]?.usual_weekday, "Thursday");
    } finally {
      // Put back exactly what was there. The earlier version captured `before`
      // and then deleted regardless, which would have silently dropped another
      // suite's row.
      await sql`delete from paper_settings where newsroom_id = 1`;
      if (before[0]) {
        await sql`
          insert into paper_settings (newsroom_id, timezone) values (1, ${before[0].timezone})
        `;
      }
      if (before[0]?.timezone) {
        await sql`
          insert into paper_settings (newsroom_id, timezone) values (1, ${before[0].timezone})
          on conflict (newsroom_id) do update set timezone = excluded.timezone
        `;
      }
    }
  });
});
