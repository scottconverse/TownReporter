import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  UNGROUNDED_MARKER,
  findSpecifics,
  groundPlan,
  markUngroundedSpecifics,
  placeCorpus,
  prepareCorpus,
  queryNamesUngroundedSpecific,
  specificIsGrounded,
  stripUngroundedMarker,
  ungroundedSpecifics,
  unmarkGroundedSpecifics,
} from "./dark-specific-grounding.ts";
import {
  emptyPlan,
  ensureInvestigateSchema,
  frontierDedupKey,
  groundingCorpus,
  persistDiscovery,
} from "./investigate.ts";
import { getSql } from "../db.ts";
import { ensureDarkSchema, readDarkDials, synthesizeSignals } from "./dark.ts";
import { verifyRunSignals } from "./dark-verify.ts";

/*
  The MEDIUM and LOW findings of the batch-7 pre-merge audit
  (`briefs/A-B7-AUDIT.md`), pinned to the audit's own inputs.

  Every fixture below is a string the audit ran. They are here rather than in
  `dark-specific-grounding.test.ts` so the rule's original evidence and the
  audit's counterexamples stay separately readable: the first file is what DD1
  must catch, this one is what DD1 must NOT.

  The corpus is the audit's: a capture that carries the licensing record of the
  real property, one amount, one date and one licence number.
*/

const CAPTURE =
  "COLORADO SHINES PROGRAM DETAIL — Kid City USA Longmont. " +
  "1941 Terry St, Longmont, CO 80501. Assessed value $1,200,000. " +
  "A recommendation for probation dated October 2, 2026. License 2024-ABC-12345.";

/** The paper's own place, from newsroom settings -- never hard-coded here. */
const PLACE = placeCorpus({ city: "Longmont", state: "Colorado", county: "Boulder" });

const CORPUS = prepareCorpus(CAPTURE, PLACE);

/** Is this text grounded, judged the way a query is? */
const namesNothing = (text: string) => queryNamesUngroundedSpecific(text, CORPUS);

describe("M4 — the same thing written two ways, and two things that are not the same", () => {
  it("grounds the amounts that are the same amount", () => {
    assert.equal(namesNothing("The assessed value is $1.2 million"), null);
    assert.equal(namesNothing("The assessed value is $1200000"), null);
    assert.equal(namesNothing("The assessed value is $1,200,000"), null);
  });

  /*
    A dropped digit is the whole reason this module exists: the walkthrough's
    invented address was a real address minus its leading 1. `String.includes`
    grounded both of these, because "200 000" really is inside "1 200 000" and
    "941 terry street" really is inside "1941 terry street".

    THE MUTATION: replacing `containsTokens` with a plain `.includes` in
    `isSpecificGrounded` fails these four assertions and nothing else.
  */
  it("refuses the amounts that are not", () => {
    assert.ok(namesNothing("The assessed value is $200,000"), "$200,000 was grounded by $1,200,000");
    assert.ok(namesNothing("The assessed value is $1.2 million and $200,000"));
  });

  it("refuses the address with a digit dropped from the street number", () => {
    const named = namesNothing("The letter was left at 941 Terry Street");
    assert.ok(named, "941 Terry Street was grounded by 1941 Terry Street");
    assert.match(named!, /941 Terry Street/);
  });

  it("grounds every spelling of the same date", () => {
    for (const date of ["October 2, 2026", "October 2nd, 2026", "Oct. 2, 2026", "2026-10-02", "10/2/2026"]) {
      assert.equal(namesNothing(`The recommendation is dated ${date}`), null, `${date} was called invented`);
    }
  });

  it("refuses a date the capture does not carry", () => {
    assert.ok(namesNothing("The recommendation is dated October 3, 2026"));
  });

  it("grounds a street address written with a directional prefix or suffix", () => {
    for (const address of [
      "1941 Terry Street",
      "1941 Terry St",
      "1941 Terry St.",
      "1941 N. Terry Street",
      "1941 North Terry Street",
    ]) {
      assert.equal(namesNothing(`The letter was left at ${address}`), null, `${address} was called invented`);
    }
  });

  it("does not drop a directional that is part of a different name", () => {
    // "West Virginia" is not "Virginia": a directional only folds when it sits
    // right after the house number, so a corpus that carries Virginia does not
    // thereby carry West Virginia.
    const virginia = prepareCorpus("The capital of Virginia is Richmond.");
    assert.equal(specificIsGrounded({ kind: "name", text: "West Virginia" }, virginia), false);
    // ... and the folded comparison itself is what is asserted above: the two
    // spellings of the SAME address still agree.
    assert.equal(namesNothing("The letter was left at 1941 North Terry Street"), null);
  });
});

describe("M5 — an institution is not an invented person", () => {
  /*
    Each of these was RAN against a corpus holding "Longmont, CO" and came back
    as a dropped query naming an invented person. The hop then ended with
    nothing to run, which reads to the editor as a low-yield round.
  */
  it("does not read a public body, a statute or a form as a person", () => {
    for (const query of [
      "Colorado Open Records Act request",
      "Boulder County Public Health",
      "Public Records Request",
      "Search Colorado Secretary of State business search for Kid City USA",
      "Secretary of State",
      "Search Colorado Shines licensing records",
    ]) {
      assert.ok(!findSpecifics(query).some((s) => s.kind === "name"), `read as a person: ${query}`);
      assert.equal(namesNothing(query), null, `dropped as invented: ${query}`);
    }
  });

  it("does not drop the town and state the paper publishes from", () => {
    // The run is still shaped like a name -- "Longmont Colorado" is two
    // capitalised words and no list of institutions can say otherwise -- but it
    // is grounded, which is the outcome that matters: the query runs and no
    // marker is written.
    const query = "Longmont Colorado business license";
    assert.equal(namesNothing(query), null);
    assert.equal(markUngroundedSpecifics(query, CORPUS), query);
  });

  it("still reads a two-word name of a person as a person", () => {
    const found = findSpecifics("Audrey Bruner signed the letter.").filter((s) => s.kind === "name");
    assert.deepEqual(found.map((s) => s.text), ["Audrey Bruner"]);
  });

  it("still reads a four-word name of a person as a person", () => {
    const found = findSpecifics("Gregory P. Halloran signed it.").filter((s) => s.kind === "name");
    assert.deepEqual(found.map((s) => s.text), ["Gregory P. Halloran"]);
  });

  it("grounds the paper's own town and state, from settings rather than a list", () => {
    assert.equal(namesNothing("Longmont Colorado business license"), null);
    assert.equal(specificIsGrounded({ kind: "name", text: "Longmont Colorado" }, CORPUS), true);
  });

  it("does not ground an invented surname by putting the town beside it", () => {
    // The town is a place word; "Doe" is not. The rule is not a free pass.
    assert.equal(specificIsGrounded({ kind: "name", text: "Doe Longmont" }, CORPUS), false);
    assert.equal(specificIsGrounded({ kind: "name", text: "Exampleton Colorado" }, CORPUS), false);
  });

  it("has no place name baked into the rule", async () => {
    const fs = await import("node:fs");
    const source = fs
      .readFileSync(new URL("./dark-specific-grounding.ts", import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, " ")
      .replace(/\/\/[^\n]*/g, " ");
    for (const word of ["longmont", "colorado", "boulder"]) {
      assert.equal(
        new RegExp(`\\b${word}\\b`, "i").test(source),
        false,
        `"${word}" is hard-coded in the grounding rule; the paper's place must come from its settings`,
      );
    }
  });
});

describe("M2 — a marker never goes inside a URL", () => {
  const PACKET =
    "https://www.longmont.gov/DocumentCenter/View/123456/Kid-City-Agenda.pdf";

  it("leaves a URL frontier label byte-for-byte alone", () => {
    const plan = emptyPlan();
    plan.frontier.push({
      label: PACKET,
      kind: "url",
      why: "The council packet for the 123456 hearing",
      priority: 9,
    });
    const out = groundPlan(plan, CORPUS).plan;
    assert.equal(out.frontier[0]!.label, PACKET, "the URL the fetcher is given was edited");
    // ... and the prose beside it is still held to the rule.
    assert.match(out.frontier[0]!.why, /123456 \(not in any capture yet\)/);
  });

  it("never splices the marker into a URL inside a sentence", () => {
    const text = `The packet is at ${PACKET} and the licence number is 1770463.`;
    const marked = markUngroundedSpecifics(text, CORPUS);
    assert.equal(marked.includes(`View/123456 ${UNGROUNDED_MARKER}`), false, marked);
    assert.equal(marked.includes("www.longmont.gov/DocumentCenter/View/123456/Kid-City-Agenda.pdf"), true);
  });

  it("leaves an email address alone", () => {
    const text = "Write to planning-2026@longmont.gov about it.";
    assert.equal(markUngroundedSpecifics(text, CORPUS), text);
  });
});

describe("M3 — the marker is never part of a search term", () => {
  const LABEL = `Front Range Municipal Solutions LLC ${UNGROUNDED_MARKER}`;

  it("takes the marker back off stored text", () => {
    assert.equal(stripUngroundedMarker(LABEL), "Front Range Municipal Solutions LLC");
    assert.equal(stripUngroundedMarker(`a ${UNGROUNDED_MARKER} b ${UNGROUNDED_MARKER}`), "a b");
    assert.equal(stripUngroundedMarker("nothing marked here"), "nothing marked here");
  });

  it("takes the marker off when a later capture corroborates the specific", () => {
    const marked = `The operator at 1749 Main Street ${UNGROUNDED_MARKER} changed hands.`;
    // The hop that later reads the parcel record; the statement is no longer
    // true and the marker must not survive into the next query built from it.
    const later = `${marked}\n\nPARCEL RECORD: 1749 Main Street, Longmont, parcel 1205-33-4-01.`;
    assert.equal(
      unmarkGroundedSpecifics(marked, later),
      "The operator at 1749 Main Street changed hands.",
    );
    // Nothing carries it: the marker stays, because the statement still stands.
    assert.equal(unmarkGroundedSpecifics(marked, "Nothing here."), marked);
    // And the specific that WAS grounded in the same string keeps its marker.
    const two = `1749 Main Street ${UNGROUNDED_MARKER} and 941 Terry Street ${UNGROUNDED_MARKER}.`;
    assert.equal(
      unmarkGroundedSpecifics(two, "PARCEL RECORD: 1749 Main Street, Longmont."),
      `1749 Main Street and 941 Terry Street ${UNGROUNDED_MARKER}.`,
    );
  });
});

describe("L4 — a name run does not walk over a sentence end", () => {
  it("stops the run at the full stop", () => {
    const text = "Searched Colorado Shines. Zip 80501 applies.";
    const names = findSpecifics(text).filter((s) => s.kind === "name").map((s) => s.text);
    assert.deepEqual(names, [], `a run crossed the sentence end: ${names.join(" | ")}`);
  });

  it("still reads one name with an initial in it", () => {
    const names = findSpecifics("Gregory P. Halloran agreed.").filter((s) => s.kind === "name");
    assert.deepEqual(names.map((s) => s.text), ["Gregory P. Halloran"]);
  });

  it("still reads a name whose first word follows a sentence end", () => {
    const names = findSpecifics("It closed. Audrey Bruner signed it.")
      .filter((s) => s.kind === "name")
      .map((s) => s.text);
    assert.deepEqual(names, ["Audrey Bruner"]);
  });
});

describe("M1 — the verification lane cannot search an invented specific", () => {
  const ROOM = 91094;

  it("strips the marker and the specific out of a subject", async () => {
    const { adversarialSubject } = await import("./dark-gates.ts");
    const marked = `Operator transition at 1749 Main Street ${UNGROUNDED_MARKER}`;
    const subject = adversarialSubject({ name: marked, observation: "" });
    assert.equal(subject.includes("1749"), false, `the invented address reached the subject: ${subject}`);
    assert.equal(subject.includes("capture"), false, `the marker's own words became search terms: ${subject}`);

    // The audit's fallback leak: the name carries no content word, so the lane
    // falls back to a marked OBSERVATION.
    const fallback = adversarialSubject({
      name: "",
      observation: `The facility at 1749 Main Street ${UNGROUNDED_MARKER} changed hands`,
    });
    assert.equal(fallback.includes("1749"), false, fallback);
    assert.equal(fallback.includes("capture"), false, fallback);
    assert.ok(fallback.length > 0, "the fallback subject went empty");
  });

  it("marks the signal name and runs no query naming the address", async () => {
    const user = `m1-verify-${Date.now()}`;
    await ensureDarkSchema();
    await ensureInvestigateSchema();
    const sql = await getSql();
    const [inv] = await sql<{ id: number }>`
      insert into investigations (user_id, newsroom_id, title)
      values (${user}, ${ROOM}, 'Kid City USA Longmont closing') returning id
    `;
    // What the file actually holds: the licensing record of the REAL address.
    await sql`
      insert into artifacts
        (user_id, investigation_id, newsroom_id, url, title, content_hash, full_text, classification, fetch_status)
      values (
        ${user}, ${inv!.id}, ${ROOM}, ${"https://fixture.example/shines"}, ${"Colorado Shines"},
        ${"hash-m1"}, ${CAPTURE}, ${"discovered"}, ${200}
      )
    `;
    const [run] = await sql<{ id: number }>`
      insert into dark_runs (user_id, newsroom_id) values (${user}, ${ROOM}) returning id
    `;
    const reply = JSON.stringify({
      editor_summary: "One signal this round.",
      inventory_gaps: [],
      signals: [
        {
          name: "Operator transition at 1749 Main Street",
          posture: "whisper",
          type: "records",
          strength: 8,
          confidence: 0.4,
          observation: "The facility at 1749 Main Street changed hands.",
          pattern: "Two operators, one parcel",
          linkage_map: "",
          alternatives: "A routine sale",
          counter_narrative: "",
          what_would_kill: "The deed",
          pathway: "Ask the clerk",
          privacy_review: "Public record",
          handoff: "HOLD FOR PATTERN",
        },
      ],
      promises: [],
    });
    const stored = await synthesizeSignals(
      user,
      run!.id,
      inv!.id,
      "",
      await readDarkDials(ROOM),
      "local-model",
      null,
      ROOM,
      undefined,
      undefined,
      undefined,
      null,
      { chat: async () => ({ ok: true as const, text: reply }) },
    );
    assert.equal(stored.error, undefined, "the synthesis must have reached the model");

    // The name is written down MARKED, like every other prose field of the row.
    const [signal] = await sql<{ id: number; name: string }>`
      select id, name from dark_signals where run_id = ${run!.id}
    `;
    assert.match(
      signal!.name,
      new RegExp(`1749 Main Street ${UNGROUNDED_MARKER.replace(/[()]/g, "\\$&")}`),
      `the signal name was written unmarked: ${signal!.name}`,
    );

    // ... and the lane that reads it back runs no query naming it. The marker
    // is stripped out of the subject, so the address is not in a query at all --
    // the signal is still verified, and nothing invented was spent on it.
    const searched: string[] = [];
    await verifyRunSignals({
      userId: user,
      newsroomId: ROOM,
      runId: run!.id,
      investigationId: inv!.id,
      place: { city: "Longmont", state: "Colorado", county: "Boulder" },
      deps: {
        search: async (query) => {
          searched.push(query);
          return [];
        },
        model: async () => JSON.stringify({ gates: {}, counter_narrative: "", newsworthiness: {} }),
      },
    });
    assert.ok(searched.length > 0, "the signal was not verified at all");
    assert.equal(searched.some((q) => q.includes("1749")), false, searched.join(" | "));
    assert.equal(searched.some((q) => q.includes("capture")), false, searched.join(" | "));

    /*
      The gate underneath, which is what catches a name written by some other
      door. This row is the audit's exact input, unmarked: with the gate removed
      the four queries run and the address is spent on a provider one stage
      after the hop lane refused to spend it.
    */
    await sql`update dark_signals set stage = ${"black-desk"}, verification_status = ${"unverified"} where run_id = ${run!.id}`;
    await sql`update dark_signals set name = ${"Operator transition at 1749 Main Street"} where run_id = ${run!.id}`;
    const refusedSearch: string[] = [];
    const refused = await verifyRunSignals({
      userId: user,
      newsroomId: ROOM,
      runId: run!.id,
      investigationId: inv!.id,
      place: { city: "Longmont", state: "Colorado", county: "Boulder" },
      deps: {
        search: async (query) => {
          refusedSearch.push(query);
          return [];
        },
        model: async () => JSON.stringify({ gates: {}, counter_narrative: "", newsworthiness: {} }),
      },
    });
    assert.equal(refusedSearch.length, 0, `an invented specific reached a provider: ${refusedSearch.join(" | ")}`);
    assert.match(refused.summary, /were not run/i, "the run record does not say the queries were refused");

    await sql`delete from dark_signals where run_id = ${run!.id}`;
    await sql`delete from dark_runs where id = ${run!.id}`;
    await sql`delete from artifacts where investigation_id = ${inv!.id}`;
    await sql`delete from investigations where id = ${inv!.id}`;
  });
});

describe("the audit's own corpus is still read the way DD1 reads it", () => {
  it("marks the invented address and keeps the captured ones", () => {
    const text = "The letter at 941 Terry Street was about 1941 Terry Street.";
    const marked = markUngroundedSpecifics(text, CORPUS);
    assert.match(marked, /941 Terry Street \(not in any capture yet\)/);
    assert.match(marked, /about 1941 Terry Street\./);
    assert.equal(ungroundedSpecifics(text, CORPUS).filter((s) => /1941/.test(s.text)).length, 0);
  });
});

describe("N1 — a title in front of a name does not hide the name", () => {
  /*
    The batch-7 re-audit's own input and its own corpus. M5 stopped institutions
    being read as invented people, and it over-corrected: a run containing any
    `INSTITUTION_WORD` was rejected outright, and `mayor`, `sheriff`, `clerk`,
    `superintendent`, `attorney`, `treasurer`, `secretary` and `governor` are
    all in that list -- so "title + invented name", the commonest shape of an
    invented person in civic copy, came back unmarked. `cutAtSentenceEnd` had
    the second half of it: "Dr.", "Sen." and "Gov." are two-letter tokens with a
    period, which the L4 fix reads as a sentence end, so the name behind them
    was cut off before it was ever judged.
  */
  const COUNCIL = prepareCorpus("The council met in Longmont.");

  it("marks an invented official however the desk titles them", () => {
    for (const text of [
      "Mayor Jane Doe approved the permit.",
      "Sheriff Jim Beam said so.",
      "Superintendent Mary Jones",
      "County Clerk Jane Doe filed it.",
      "Dr. Jane Doe approved it.",
      "Sen. John Smith said",
      "Gov. Jim Beam",
    ]) {
      assert.match(
        markUngroundedSpecifics(text, COUNCIL),
        /\(not in any capture yet\)/,
        `the title hid the name: ${text}`,
      );
    }
  });

  it("refuses a query that names one of them", () => {
    const named = queryNamesUngroundedSpecific("Mayor Jane Doe Longmont", COUNCIL);
    assert.ok(named, "a titled invented name was allowed as a search term");
    assert.match(named!, /Mayor Jane Doe/);
  });

  it("keeps the title in the text and marks the name whole", () => {
    // The title is part of what the editor reads; what the marker says is that
    // nothing here carries the person, and it reads the same either way.
    assert.equal(
      markUngroundedSpecifics("Mayor Jane Doe approved the permit.", COUNCIL),
      "Mayor Jane Doe (not in any capture yet) approved the permit.",
    );
  });

  it("does not read a title on its own as a person", () => {
    for (const text of ["The mayor said so.", "The county clerk filed it.", "Sheriff"]) {
      const names = findSpecifics(text).filter((s) => s.kind === "name");
      assert.deepEqual(names.map((s) => s.text), [], `a bare title was read as a person: ${text}`);
    }
  });

  it("still does not read an institution as an invented person", () => {
    // The titles are stripped only in FRONT of a name, so M5's cases stand.
    for (const text of [
      "Boulder County Public Health",
      "Public Records Request",
      "Colorado Secretary of State",
      "Secretary of State",
      "City of Longmont",
      "City Council",
      "Police Department",
    ]) {
      const names = findSpecifics(text).filter((s) => s.kind === "name");
      assert.deepEqual(names.map((s) => s.text), [], `read as a person: ${text}`);
    }
  });
});

/*
  A paper in a two-word city: the place rule has to answer for each WORD, or
  "Grand Junction" could never be named in a first-hop query.
*/
describe("the paper's place, when the town has two words", () => {
  it("grounds a run made of the town's own words", () => {
    const grand = prepareCorpus(
      "GRAND JUNCTION — The council met Tuesday.",
      placeCorpus({ city: "Grand Junction", state: "Colorado", county: "Mesa" }),
    );
    assert.equal(queryNamesUngroundedSpecific("Grand Junction business license", grand), null);
    assert.equal(queryNamesUngroundedSpecific("Grand Junction Colorado business license", grand), null);
    // ... and the rule is still not a free pass for a surname beside the town.
    assert.equal(specificIsGrounded({ kind: "name", text: "Doe Junction" }, grand), false);
  });
});

/*
  M6 of the audit: the route by which an entity's own name laundered itself.

  `persistPlan` keeps an entity's `name` unmarked on purpose -- it is the key
  the resolver merges on -- and files an unresolved identity as a frontier item
  labelled with that name. `groundingCorpus` read the frontier table, so the
  model's next hop found the address in its own notes and called it grounded.
*/
describe("M6 — an invented entity cannot ground the next hop's query", () => {
  const ROOM = 91093;

  it("leaves an entity's own name out of the corpus, and keeps everything else", async () => {
    const user = `m6-entity-${Date.now()}`;
    await ensureInvestigateSchema();
    const sql = await getSql();
    const [inv] = await sql<{ id: number }>`
      insert into investigations (user_id, newsroom_id, title)
      values (${user}, ${ROOM}, 'Kid City USA Longmont closing') returning id
    `;
    await sql`
      insert into artifacts
        (user_id, investigation_id, newsroom_id, url, title, content_hash, full_text, classification, fetch_status)
      values (
        ${user}, ${inv!.id}, ${ROOM}, ${"https://fixture.example/shines"}, ${"Colorado Shines"},
        ${"hash-m6"}, ${CAPTURE}, ${"discovered"}, ${200}
      )
    `;
    // The planner's entity, exactly as `persistPlan` writes it: name unmarked.
    await sql`
      insert into entities (user_id, newsroom_id, canonical, name, kind, why)
      values (${user}, ${ROOM}, ${"1749 main street"}, ${"1749 Main Street"}, ${"address"}, ${"The parcel the model believes changed hands"})
    `;
    // ... and the frontier item it files, labelled with that name.
    await sql`
      insert into frontier_items (user_id, newsroom_id, investigation_id, label, label_norm, kind, why, priority, status)
      values (${user}, ${ROOM}, ${inv!.id}, ${"1749 Main Street"}, ${frontierDedupKey("address", "1749 Main Street").norm}, ${"address"},
              ${"Unresolved identity vs another row (possible-same) — keep both possibilities alive"},
              ${8}, ${"open"})
    `;
    // A lead filed from a capture is NOT an entity name, and must stay readable
    // back: `investigate.loop.test.ts` pins that as a product property.
    await sql`
      insert into frontier_items (user_id, newsroom_id, investigation_id, label, label_norm, kind, why, priority, status)
      values (${user}, ${ROOM}, ${inv!.id}, ${"Colorado Shines"}, ${frontierDedupKey("agency", "Colorado Shines").norm}, ${"agency"},
              ${"The licensing record names it"}, ${7}, ${"open"})
    `;

    const corpus = await groundingCorpus(inv!.id, ROOM, {
      city: "Longmont",
      state: "Colorado",
      county: "Boulder",
    });
    const named = queryNamesUngroundedSpecific(
      "Kid City USA Longmont 1749 Main Street lease termination",
      corpus,
    );
    assert.ok(named, "an entity's own name grounded the query for itself");
    assert.match(named!, /1749 Main Street/);
    // The capture still grounds what it carries, and a non-entity lead is still
    // in the corpus.
    assert.equal(queryNamesUngroundedSpecific("Kid City USA Longmont 1941 Terry Street lease", corpus), null);
    assert.equal(queryNamesUngroundedSpecific("Colorado Shines licensing record", corpus), null);

    await sql`delete from frontier_items where investigation_id = ${inv!.id}`;
    await sql`delete from entities where newsroom_id = ${ROOM} and canonical = ${"1749 main street"}`;
    await sql`delete from artifacts where investigation_id = ${inv!.id}`;
    await sql`delete from investigations where id = ${inv!.id}`;
  });
});

/*
  N2 of the batch-7 re-audit: M6's narrowing relies on "model-written labels are
  stored MARKED", and that is true of a planner's frontier labels, hypotheses
  and claims (`groundPlan` marks them) but false of the two rows `persistPlan`
  writes from a relationship or an unresolved identity. `persistPlan` files an
  unresolved relationship as `${from} ${kind} ${to}` with both ends unmarked --
  deliberately, because a relationship's names are keys -- so the frontier table
  carried an invented address the model could read back on the next hop and call
  grounded. The synthesis pass had the same door standing open a second time:
  its corpus was the PACK, and the pack lists RELATIONSHIPS, FRONTIER, CLAIMS,
  HYPOTHESES and ANOMALIES -- every one of them the model's own earlier notes.

  Both fixtures below are the audit's, run against PGlite through the real
  `persistDiscovery`, the real `groundingCorpus` and the real `synthesizeSignals`.
*/
describe("N2 — a relationship-derived label cannot ground the next hop", () => {
  const ROOM = 91095;
  const INVENTED = "1749 Main Street leased by Front Range Holdings";

  it("leaves the relationship's own label out of the corpus, and keeps the captures", async () => {
    const user = `n2-relationship-${Date.now()}`;
    await ensureInvestigateSchema();
    const sql = await getSql();
    const [inv] = await sql<{ id: number }>`
      insert into investigations (user_id, newsroom_id, title)
      values (${user}, ${ROOM}, 'Kid City USA Longmont closing') returning id
    `;
    await sql`
      insert into artifacts
        (user_id, investigation_id, newsroom_id, url, title, content_hash, full_text, classification, fetch_status)
      values (
        ${user}, ${inv!.id}, ${ROOM}, ${"https://fixture.example/shines"}, ${"Colorado Shines"},
        ${"hash-n2"}, ${CAPTURE}, ${"discovered"}, ${200}
      )
    `;
    /*
      Exactly what `persistPlan` files for a relationship whose provenance is
      unresolved: the label is built from the model's `from` and `to` and is
      written unmarked.
    */
    await persistDiscovery(user, inv!.id, {
      kind: "unresolved-provenance",
      label: INVENTED,
      why: "Relationship provenance unresolved; keep investigating",
      evidence: "Front Range Holdings — 1749 Main Street",
      priority: 7,
    });

    const corpus = await groundingCorpus(inv!.id, ROOM, {
      city: "Longmont",
      state: "Colorado",
      county: "Boulder",
    });
    const named = queryNamesUngroundedSpecific("1749 Main Street lease", corpus);
    assert.ok(named, "a relationship label grounded the address it named");
    assert.match(named!, /1749 Main Street/);
    assert.match(
      markUngroundedSpecifics("The lease at 1749 Main Street ended", corpus),
      /1749 Main Street \(not in any capture yet\)/,
    );
    // The capture is still what grounds the file, and the label itself is still
    // filed for the editor to read.
    assert.equal(queryNamesUngroundedSpecific("Kid City USA Longmont 1941 Terry Street lease", corpus), null);
    const [filed] = await sql<{ label: string }>`
      select label from frontier_items where investigation_id = ${inv!.id} limit 1
    `;
    assert.equal(filed?.label, INVENTED, "the relationship row was not filed at all");

    await sql`delete from frontier_items where investigation_id = ${inv!.id}`;
    await sql`delete from artifacts where investigation_id = ${inv!.id}`;
    await sql`delete from investigations where id = ${inv!.id}`;
  });

  it("grounds the synthesis pass on the captures, not on the model's own notes", async () => {
    const user = `n2-synthesis-${Date.now()}`;
    await ensureDarkSchema();
    await ensureInvestigateSchema();
    const sql = await getSql();
    const [inv] = await sql<{ id: number }>`
      insert into investigations (user_id, newsroom_id, title)
      values (${user}, ${ROOM}, 'Kid City USA Longmont closing') returning id
    `;
    await sql`
      insert into artifacts
        (user_id, investigation_id, newsroom_id, url, title, content_hash, full_text, classification, fetch_status)
      values (
        ${user}, ${inv!.id}, ${ROOM}, ${"https://fixture.example/shines"}, ${"Colorado Shines"},
        ${"hash-n2b"}, ${CAPTURE}, ${"discovered"}, ${200}
      )
    `;
    // The invented address, in the model's own earlier notes: a relationship
    // row, which `buildDarkSynthesisPack` prints into its RELATIONSHIPS section.
    await sql`
      insert into relationships
        (user_id, newsroom_id, investigation_id, from_name, to_name, kind, evidence, provenance_status)
      values (
        ${user}, ${ROOM}, ${inv!.id}, ${"Front Range Holdings"}, ${"1749 Main Street"},
        ${"leases"}, ${"The lease names it"}, ${"unresolved"}
      )
    `;
    const [run] = await sql<{ id: number }>`
      insert into dark_runs (user_id, newsroom_id) values (${user}, ${ROOM}) returning id
    `;
    const reply = JSON.stringify({
      // The REAL address, which the capture carries: the control for the two
      // assertions below, because a corpus that marks everything is as useless
      // as one that grounds everything.
      editor_summary: "The licensing record at 1941 Terry Street lists one operator.",
      inventory_gaps: [],
      signals: [
        {
          name: "Lease ended at 1749 Main Street",
          posture: "whisper",
          type: "records",
          strength: 8,
          confidence: 0.4,
          observation: "The lease at 1749 Main Street ended.",
          pattern: "One parcel, two operators",
          linkage_map: "",
          alternatives: "A routine sale",
          counter_narrative: "",
          what_would_kill: "The deed",
          pathway: "Ask the clerk",
          privacy_review: "Public record",
          handoff: "HOLD FOR PATTERN",
        },
      ],
      promises: [],
    });
    const stored = await synthesizeSignals(
      user,
      run!.id,
      inv!.id,
      "",
      await readDarkDials(ROOM),
      "local-model",
      null,
      ROOM,
      undefined,
      undefined,
      undefined,
      null,
      { chat: async () => ({ ok: true as const, text: reply }) },
    );
    assert.equal(stored.error, undefined, "the synthesis must have reached the model");
    const [signal] = await sql<{ name: string; observation: string }>`
      select name, observation from dark_signals where run_id = ${run!.id}
    `;
    assert.match(
      signal!.name,
      /1749 Main Street \(not in any capture yet\)/,
      `the model's own note grounded the address: ${signal!.name}`,
    );
    assert.match(
      signal!.observation,
      /1749 Main Street \(not in any capture yet\)/,
      `the model's own note grounded the observation: ${signal!.observation}`,
    );
    // ... and the capture still grounds what it carries: the pass's own summary
    // names the real address, and it is not marked.
    assert.match(stored.summary, /1941 Terry Street/, "the pass summary did not keep the model's sentence");
    assert.equal(
      stored.summary.includes(UNGROUNDED_MARKER),
      false,
      `a captured address was marked: ${stored.summary}`,
    );

    await sql`delete from dark_signals where run_id = ${run!.id}`;
    await sql`delete from dark_runs where id = ${run!.id}`;
    await sql`delete from relationships where investigation_id = ${inv!.id}`;
    await sql`delete from artifacts where investigation_id = ${inv!.id}`;
    await sql`delete from investigations where id = ${inv!.id}`;
  });
});
