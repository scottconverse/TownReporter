/*
  F4 / Option A guard: the production paper must not change.

  The live database has ONE paper_settings row with `onboarded = true` and EMPTY
  name, city and state columns (read-only look by the production auditor,
  2026-10-02). Every blank column falls back to the shipped Longmont constants
  in `mergeRow`, so the live paper reads as "TownReporter -- Longmont, Colorado"
  through defaultConfig(), not through its own stored values.

  The F4 fix (Server > Paper setup starts blank, blank-city sentences read
  cleanly) and the Option A refusal that follows it MUST therefore key off the
  `onboarded` flag and nothing else -- never off "is the city filled in" --
  or the live paper would lose Longmont at the next rollout. This pins exactly
  that shape.

  Columns the F4 change reads: `paper_settings.onboarded` (through isOnboarded,
  via firstRunSetupState) and nothing new besides. The sentences take the city
  from the same merged config the public pages already used.
*/
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getSql } from "../db.ts";
import { EDITOR_EMAIL, PAPER } from "../paper.ts";
import {
  clearerViewSentence,
  civicReportingLine,
  civicSourcesPhrase,
  datelineLine,
  newsInTownPlaceholder,
  topicReportingSentence,
} from "../paper-phrases.ts";
import {
  ensurePaperSettingsSchema,
  getPaperConfig,
  getPublicPaperConfig,
  isOnboarded,
} from "./paper-settings.ts";

const LIVE_SHAPED = 900_401; // onboarded, blank name/city/state, like production
const UNSET = 900_402; // no row at all: a brand-new install
const LIVE_NULL_EMAIL = 900_403; // the same row with editor_email NULL instead of ''

/*
  The columns, as the production auditor read them (2026-10-02, read-only):
  NULL: location, timezone, tagline, kicker, council_votes_url, youtube_channels,
  meeting_keywords, seed_sources; name/city/state empty; FILLED: deck, trust,
  named_outlets; editor_email "empty" (the auditor could not say '' from NULL, so
  both are pinned); onboarded = true. The filled values below are stand-ins of
  the same kind, not the live text.
*/
const LIVE_DECK = "Our own deck for this paper: what we cover and how, written by its editor.";
const LIVE_TRUST = "Civic news, edited by people.";
const LIVE_OUTLETS = [
  { name: "Riverbend Gazette", aliases: ["the Gazette"], domains: ["riverbendgazette.example"] },
];

async function seedLiveShape() {
  await ensurePaperSettingsSchema();
  const sql = await getSql();
  await sql`delete from paper_settings where newsroom_id in (${LIVE_SHAPED}, ${UNSET}, ${LIVE_NULL_EMAIL})`;
  // Columns the auditor reported as NULL are left NULL (the "fall back to the
  // shipped value" case); name, city, state and editor_email are empty strings.
  await sql`
    insert into paper_settings (newsroom_id, name, city, state, deck, trust, named_outlets, editor_email, onboarded)
    values (${LIVE_SHAPED}, '', '', '', ${LIVE_DECK}, ${LIVE_TRUST}, ${JSON.stringify(LIVE_OUTLETS)}::jsonb, '', true)
  `;
  await sql`
    insert into paper_settings (newsroom_id, name, city, state, deck, trust, named_outlets, editor_email, onboarded)
    values (${LIVE_NULL_EMAIL}, '', '', '', ${LIVE_DECK}, ${LIVE_TRUST}, ${JSON.stringify(LIVE_OUTLETS)}::jsonb, null, true)
  `;
}

describe("a paper that is onboarded but has blank name, city and state (the live shape)", () => {
  it("is onboarded, so the desk does not treat it as a first run", async () => {
    await seedLiveShape();
    assert.equal(await isOnboarded(LIVE_SHAPED), true);
    // The panel's `firstRun` is `needsSetup === true`, and needsSetup is
    // `!isOnboarded`, so the Paper setup form shows the saved/merged values.
    assert.equal(!(await isOnboarded(LIVE_SHAPED)), false);
  });

  it("still reads as Longmont on the desk, because blank columns merge with the shipped values", async () => {
    await seedLiveShape();
    const cfg = await getPaperConfig(LIVE_SHAPED);
    assert.equal(cfg.name, PAPER.name);
    assert.equal(cfg.city, PAPER.city);
    assert.equal(cfg.state, PAPER.state);
    assert.equal(cfg.location, PAPER.location);
    assert.equal(cfg.timezone, PAPER.timezone);
    assert.equal(cfg.kicker, PAPER.kicker);
  });

  it("keeps the FILLED deck, trust and named outlets over the shipped defaults", async () => {
    await seedLiveShape();
    for (const read of [getPaperConfig, getPublicPaperConfig]) {
      const cfg = await read(LIVE_SHAPED);
      assert.equal(cfg.deck, LIVE_DECK, "the stored deck wins, not the Longmont deck");
      assert.notEqual(cfg.deck, PAPER.deck);
      assert.equal(cfg.trust, LIVE_TRUST, "the stored trust line wins");
      assert.notEqual(cfg.trust, PAPER.trust);
      assert.deepEqual(cfg.namedOutlets.map((o) => o.name), ["Riverbend Gazette"], "the stored outlet list wins");
    }
  });

  it("an empty editor_email means no address (not the build-time one); a NULL one falls back to it -- unchanged by F4", async () => {
    await seedLiveShape();
    assert.equal((await getPublicPaperConfig(LIVE_SHAPED)).editorEmail, null);
    assert.equal((await getPublicPaperConfig(LIVE_NULL_EMAIL)).editorEmail, EDITOR_EMAIL);
  });

  it("still reads as Longmont on the public site: the placeholder is for un-onboarded papers only", async () => {
    await seedLiveShape();
    const pub = await getPublicPaperConfig(LIVE_SHAPED);
    assert.equal(pub.city, PAPER.city);
    assert.equal(pub.state, PAPER.state);
    assert.equal(pub.kicker, PAPER.kicker, "the masthead kicker is not blanked");
    assert.equal(pub.location, PAPER.location);
    assert.notEqual(pub.kicker, "Awaiting setup");
  });

  it("prints the same sentences as before the blank-city change, byte for byte", async () => {
    await seedLiveShape();
    const { city } = await getPublicPaperConfig(LIVE_SHAPED);
    assert.equal(city, "Longmont");
    assert.equal(datelineLine(city, "Sat, Sept. 26"), "Today in Longmont · Sat, Sept. 26");
    assert.equal(clearerViewSentence(city), "A clearer view of Longmont.");
    assert.equal(civicReportingLine(city), "Independent civic reporting for Longmont");
    assert.equal(civicSourcesPhrase(city), "Longmont civic sources");
    assert.equal(topicReportingSentence("council", city), "Reporting on council in Longmont.");
    assert.equal(newsInTownPlaceholder(city), "Why this is news in Longmont today");
  });
});

describe("contrast: a brand-new install (no paper_settings row) is the only case that goes blank", () => {
  it("is not onboarded and the public site shows the neutral placeholder with no town", async () => {
    await seedLiveShape();
    assert.equal(await isOnboarded(UNSET), false);
    const pub = await getPublicPaperConfig(UNSET);
    assert.equal(pub.city, "");
    assert.equal(pub.editorEmail, null);
    assert.equal(clearerViewSentence(pub.city), "A clearer view of your community.");
  });
});
