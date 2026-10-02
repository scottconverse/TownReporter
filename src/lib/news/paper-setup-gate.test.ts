/*
  SG1 / Option A: an install that has not been set up must not spend.

  A fresh install that nobody has set up has NO town. Today the desk, scans,
  prompts and searches fall back to the shipped Longmont constants there
  (`getPaperConfig` is not gated on onboarded; `defaultConfig()` supplies
  Longmont), so a first scan on an un-set-up install searches the wrong town
  and spends credit.

  Option A: REFUSE to start a scan, a Dark Desk run or a draft until setup is
  done, in plain words.

  THE HARD CONSTRAINT. The live `paper_settings` row is `onboarded = true` with
  name, city and state EMPTY (the production auditor's read-only look,
  2026-10-02). Blank columns merge with the Longmont defaults in `mergeRow`, so
  the gate MUST read ONLY the `onboarded` flag -- never "is the city filled in"
  -- or live would lose Longmont and the paper would stop. Every test below
  that seeds `LIVE_SHAPED` exists to catch exactly that mistake.
*/
import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { PAPER } from "../paper.ts";
import {
  ensurePaperSettingsSchema,
  getPaperConfig,
  isOnboarded,
  PAPER_NOT_SET_UP_SENTENCE,
  PAPER_SETUP_UNCHECKABLE_SENTENCE,
  paperSetUpRefusal,
  PaperNotSetUpError,
  requirePaperSetUp,
} from "./paper-settings.ts";

const LIVE_SHAPED = 900_411; // onboarded, blank name/city/state — like production
const UNSET = 900_412; // no row at all: a brand-new install
const NOT_ONBOARDED = 900_413; // a row exists but onboarded = false

async function seed() {
  await ensurePaperSettingsSchema();
  const sql = await getSql();
  await sql`delete from paper_settings where newsroom_id in (${LIVE_SHAPED}, ${UNSET}, ${NOT_ONBOARDED})`;
  await sql`
    insert into paper_settings (newsroom_id, name, city, state, onboarded)
    values (${LIVE_SHAPED}, '', '', '', true)
  `;
  await sql`
    insert into paper_settings (newsroom_id, name, city, state, onboarded)
    values (${NOT_ONBOARDED}, '', '', '', false)
  `;
}

describe("requirePaperSetUp: the one server-side check", () => {
  before(seed);

  it("refuses when the newsroom has no paper_settings row at all", async () => {
    await assert.rejects(
      () => requirePaperSetUp(UNSET, "start the scan"),
      (err: unknown) => err instanceof PaperNotSetUpError,
    );
  });

  it("refuses when the row exists but onboarded is false", async () => {
    await assert.rejects(
      () => requirePaperSetUp(NOT_ONBOARDED, "start the scan"),
      (err: unknown) => err instanceof PaperNotSetUpError,
    );
  });

  it("refuses with ONE plain sentence naming the action and the way out", async () => {
    const err = await requirePaperSetUp(UNSET, "start the scan").then(
      () => null,
      (e: unknown) => e as Error,
    );
    assert.ok(err, "an un-set-up newsroom must be refused");
    assert.equal(err.message, PAPER_NOT_SET_UP_SENTENCE("start the scan"));
    assert.equal(
      err.message,
      "This paper has not been set up yet. Finish Paper setup first (Server > Paper setup), then start the scan.",
    );
    assert.equal(
      PAPER_NOT_SET_UP_SENTENCE("start a Dark Desk run"),
      "This paper has not been set up yet. Finish Paper setup first (Server > Paper setup), then start a Dark Desk run.",
    );
    // A refusal is one sentence, not a wall of them.
    assert.ok(!err.message.includes("\n"));
  });

  it("ALLOWS the live shape: onboarded = true with blank name, city and state", async () => {
    // This is the assertion the hard constraint exists for. A gate that asked
    // "is the city filled in" would throw here and take the live paper down.
    await requirePaperSetUp(LIVE_SHAPED, "start the scan");
    assert.equal(await isOnboarded(LIVE_SHAPED), true);
    const cfg = await getPaperConfig(LIVE_SHAPED);
    assert.equal(cfg.city, PAPER.city, "the live row still reads as Longmont");
    assert.equal(cfg.city.length > 0, true, "and its city is NOT blank after the merge");
  });

  it("FAILS CLOSED: a database that errors while reading onboarded is a refusal, not a pass", async () => {
    // The same rule the Server panel's Paper-setup section follows: "I could
    // not ask whether this paper is set up" is not "it is set up".
    await assert.rejects(
      () => requirePaperSetUp(UNSET, "start the scan", async () => {
        throw new Error("connection terminated unexpectedly");
      }),
      (err: unknown) => {
        assert.ok(err instanceof PaperNotSetUpError);
        assert.equal((err as Error).message, PAPER_SETUP_UNCHECKABLE_SENTENCE("start the scan"));
        assert.match((err as Error).message, /could not check/i);
        return true;
      },
    );
    // And the reader it replaces really does throw for a newsroom whose row
    // cannot be read: prove the seam is the only difference by checking the
    // default reader still says YES for the live shape (i.e. the seam is
    // consulted instead of the database only when a caller passes one).
    await requirePaperSetUp(LIVE_SHAPED, "start the scan");
  });
});

describe("paperSetUpRefusal: the non-throwing form the {ok:false,error} handlers use", () => {
  before(seed);

  it("returns the sentence for an un-set-up newsroom and null for the live shape", async () => {
    assert.equal(
      await paperSetUpRefusal(UNSET, "start the scan"),
      PAPER_NOT_SET_UP_SENTENCE("start the scan"),
    );
    assert.equal(await paperSetUpRefusal(LIVE_SHAPED, "start the scan"), null);
  });

  it("returns the could-not-check sentence when the read errors", async () => {
    assert.equal(
      await paperSetUpRefusal(UNSET, "draft this story", async () => {
        throw new Error("boom");
      }),
      PAPER_SETUP_UNCHECKABLE_SENTENCE("draft this story"),
    );
  });
});

describe("the gate reads onboarded ONLY", () => {
  /*
    Mutation guard, stated as a test: if `requirePaperSetUp` ever asks whether
    the city (or the name, or any other column) is filled in, the live-shaped
    row -- onboarded, all three blank -- stops being allowed and this fails.
  */
  it("lets a row through whose every identity column is blank", async () => {
    await seed();
    const sql = await getSql();
    await sql`
      insert into paper_settings (newsroom_id, name, city, state, location, timezone, tagline, kicker, onboarded)
      values (900_414, '', '', '', '', '', '', '', true)
      on conflict (newsroom_id) do update set onboarded = true,
        name = '', city = '', state = '', location = '', timezone = '', tagline = '', kicker = ''
    `;
    await requirePaperSetUp(900_414, "start the scan");
  });
});
