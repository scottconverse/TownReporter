import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { parseScanResult } from "./schema.ts";
import { buildScanUserMessage, SCAN_TOPIC_BRIEF_CAP } from "./desk-copy.ts";
import { fileScanLeads, type SqlTag } from "./lead-filing.ts";

/*
  The General scan used to hand the model a bare list of section KEYS and then,
  when the reply named no section it was allowed to file under, quietly file the
  lead under the first configured section. The lead then read as the desk's
  choice (`schema.ts`'s `allowedTopics[0]`) with nothing anywhere recording that
  a machine had guessed -- and the Queue row showed the guessed section as if
  the scan had picked it.

  These tests bind the three halves of the fix: the prompt now names each
  section (key + display name + capped brief), the parser records that the
  desk, not the model, chose the section, and the row carries that record to
  the editor.
*/

const ALLOWED = [
  "council",
  "budget",
  "housing",
  "utilities",
  "schools",
  "planning",
  "infrastructure",
  "elections",
];

/** The shipped sections, named the way migration 0045 names them. */
const SECTIONS = [
  { key: "council", name: "City Council", brief: "Votes, ordinances, contracts and appointments." },
  { key: "schools", name: "Schools", brief: "St. Vrain Valley Schools when the record is public." },
];

function reply(topic: string | undefined, headline = "Council takes up the water plant contract") {
  return {
    editor_summary: "One lead.",
    leads: [
      {
        headline,
        why: "it is on Tuesday's agenda",
        ...(topic === undefined ? {} : { topic }),
        source_urls: ["https://example.test/agenda"],
        evidence: "vote Tuesday",
        newsworthiness: 12,
      },
    ],
    proposed_sources: [],
  };
}

describe("a section the model did not choose is recorded, not silently guessed", () => {
  it("keeps a fallback key but marks the lead as not chosen by the model", () => {
    const parsed = parseScanResult(reply("cats"), ALLOWED);
    assert.equal(parsed.parseError, null, parsed.parseError ?? "parse failed");
    assert.equal(parsed.leads[0]!.topic, "council", "the column still needs a section");
    assert.equal(
      parsed.leads[0]!.topicUnchosen,
      true,
      "the desk picked that section; the lead must say so",
    );
  });

  it("marks a lead the model gave no topic for", () => {
    const parsed = parseScanResult(reply(undefined), ALLOWED);
    assert.equal(parsed.leads[0]!.topicUnchosen, true);
  });

  it("does not mark a lead the model filed under an allowed key", () => {
    const parsed = parseScanResult(reply("schools"), ALLOWED);
    assert.equal(parsed.leads[0]!.topic, "schools");
    assert.equal(parsed.leads[0]!.topicUnchosen, false);
  });

  it("accepts the display name the prompt now shows the model", () => {
    // A model told the section is called "City Council" answering with that
    // name chose a section; calling that a guess would put "Section not chosen"
    // on a lead that was filed exactly where it belongs.
    const parsed = parseScanResult(reply("City Council"), ALLOWED, SECTIONS);
    assert.equal(parsed.leads[0]!.topic, "council");
    assert.equal(parsed.leads[0]!.topicUnchosen, false);
  });

  it("does not let a name the newsroom does not have pick a section", () => {
    const parsed = parseScanResult(reply("Libraries"), ALLOWED, SECTIONS);
    assert.equal(parsed.leads[0]!.topicUnchosen, true);
  });
});

describe("the scan prompt names the sections it files under", () => {
  it("carries each section's key, display name and reporting brief", () => {
    const prompt = buildScanUserMessage({
      city: "Longmont",
      state: "CO",
      reread: false,
      memory: [],
      payload: "source text",
      topics: SECTIONS,
    });
    for (const section of SECTIONS) {
      assert.match(prompt, new RegExp(section.name), `the prompt must name ${section.name}`);
      assert.match(prompt, new RegExp(section.brief.replace(/[.]/g, "\\.")), `the prompt must carry the ${section.key} brief`);
      assert.match(prompt, new RegExp(`\\b${section.key}\\b`), "the key stays the value the model must return");
    }
    assert.match(prompt, /the exact key/i, "the model must be told to return the key, not the name");
  });

  it("caps a long reporting brief so one section cannot crowd out the rest", () => {
    const long = "y".repeat(SCAN_TOPIC_BRIEF_CAP + 400);
    const prompt = buildScanUserMessage({
      city: "Longmont",
      state: "CO",
      reread: false,
      memory: [],
      payload: "source text",
      topics: [{ key: "council", name: "City Council", brief: long }],
    });
    assert.match(prompt, new RegExp("y{" + SCAN_TOPIC_BRIEF_CAP + "}"), "the brief must reach the prompt");
    assert.doesNotMatch(
      prompt,
      new RegExp("y{" + (SCAN_TOPIC_BRIEF_CAP + 1) + "}"),
      "the brief must be cut at the cap",
    );
  });
});

describe("the filed row carries the record to the desk", () => {
  async function rowFor(lead: { topic: string; topicUnchosen?: boolean }) {
    const db = new PGlite();
    try {
      await db.exec(`create table leads (
        id serial primary key, user_id text, newsroom_id integer, scan_run_id integer,
        headline text, why text, topic text, source_urls text, evidence text,
        newsworthiness integer, status text, possible_duplicate_of integer,
        topic_unchosen boolean not null default false,
        resurfaced_count integer default 0, last_resurfaced_at timestamptz,
        last_resurfaced_scan_run_id integer
      )`);
      /*
        Migration 0094: fileScanLeads writes `dup_kind` on every row it files
        (the "possible" / "developing" duplicate kind), so a table built
        without it fails the insert with `column "dup_kind" of relation
        "leads" does not exist` -- a missing migration, not a filing bug. The
        migration file is applied here rather than its column hand-copied, the
        same way entity-identity-migration.test.ts applies 0044.
      */
      await db.exec(
        await readFile(
          new URL("../../../migrations/0094_lead_kill_record.sql", import.meta.url),
          "utf8",
        ),
      );
      const sql: SqlTag = async <T>(parts: TemplateStringsArray, ...values: unknown[]) => {
        const query = parts.reduce((out, part, i) => out + (i ? `$${i}` : "") + part, "");
        return (await db.query<T>(query, values)).rows;
      };
      await fileScanLeads(
        sql,
        { userId: "test" },
        1,
        903,
        [
          {
            headline: "Council takes up the water plant contract",
            why: "it is on Tuesday's agenda",
            ...lead,
          },
        ],
        [],
      );
      const rows = (await db.query("select topic,topic_unchosen from leads")).rows;
      return rows[0] as { topic: string; topic_unchosen: boolean };
    } finally {
      await db.close();
    }
  }

  it("records an unchosen section on the row", async () => {
    assert.deepEqual(await rowFor({ topic: "council", topicUnchosen: true }), {
      topic: "council",
      topic_unchosen: true,
    });
  });

  it("records a chosen section as chosen", async () => {
    assert.deepEqual(await rowFor({ topic: "schools", topicUnchosen: false }), {
      topic: "schools",
      topic_unchosen: false,
    });
  });
});
