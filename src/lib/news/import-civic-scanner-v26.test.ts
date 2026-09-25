import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEVELOPING_FLAG,
  UNVERIFIED_FLAG,
  claimsWarning,
  editorNotesFor,
  kindForTier,
  parseFinishedStories,
  readinessFromText,
  storyIdFromHeading,
  type ImportedStory,
} from "./import-stories.ts";
import { cardsFromReport, runBanner, type ReviewCard } from "./import-review.ts";
import { darkSeedFromCard } from "./dark-seed.ts";

/**
 * The v2.6 reports. `precleanMarkdown`/`splitParagraphs` fold CRLF to LF, so
 * every body this module hands back is LF while a Windows checkout writes the
 * fixture as CRLF -- folding here compares the two on the convention the reader
 * guarantees, byte-for-byte on the words.
 */
function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8").replace(
    /\r\n?/g,
    "\n",
  );
}

/** The full-pipeline run: two Tier 1 packets, a Tier 2, a Tier 3, a Black Desk. */
const FULL = fixture("civic-scanner-v26-full-pipeline-2026-09-25.md");

/** The real daily-scan run Scott pasted, Sept. 25 2026: three Tier 1 packets and a nine-row held table. */
const DAILY = fixture("civic-scanner-v26-longmont-2026-09-25.md");

/** A small full-pipeline JSON, in the shape of `report-schema.json`. */
const JSON_REPORT = fixture("civic-scanner-v26-report-2026-09-25.json");

function cards(text: string): ReviewCard[] {
  return cardsFromReport(parseFinishedStories(text));
}

function card(tag: string): ReviewCard {
  const found = cards(FULL).find((c) => c.storyId === tag);
  assert.ok(found, `the full-pipeline fixture has a ${tag} card`);
  return found!;
}

function storyOf(tag: string, text = FULL): ImportedStory {
  const found = parseFinishedStories(text).stories.find((s) => s.storyId === tag);
  assert.ok(found, `the report has a ${tag} story`);
  return found!;
}

describe("the tier the report states, whatever the word count says", () => {
  /*
    The safety rule this unit exists for. X3 classified a card by length
    (`IDEA_WORD_LIMIT`), so a 200-word Black Desk hypothesis -- a paragraph of
    speculation with no reporting behind it -- imported as a FINISHED, ticked
    story. The report's own editorial readiness tier is the statement that
    settles it, and it is read before the length is ever consulted.
  */
  it("offers a Tier 1 packet as a finished story, ticked", () => {
    for (const tag of ["S1", "S2"]) {
      const one = card(tag);
      assert.equal(one.readiness, 1, `${tag} is Tier 1`);
      assert.equal(one.kind, "story", `${tag} is offered as a finished story`);
      assert.equal(one.include, true, `${tag} opens ticked`);
      assert.equal(one.unverified, false);
      assert.equal(one.readinessFlag, "");
    }
  });

  it("offers a Tier 2 packet as a finished story, unticked, wearing its gaps", () => {
    const one = card("S3");
    assert.equal(one.readiness, 2);
    assert.equal(one.kind, "story", "the report wrote a draft, and the tier says developing");
    assert.equal(one.include, false, "nothing the report calls developing imports by default");
    assert.equal(one.includeByDefault, false);
    assert.equal(one.readinessFlag, DEVELOPING_FLAG);
    assert.match(one.readinessNote, /number of meals/);
  });

  it("offers a Tier 3 packet as a story idea, never a draft", () => {
    const one = card("S4");
    assert.equal(one.readiness, 3);
    assert.equal(one.kind, "idea");
    assert.equal(one.include, false);
    assert.equal(one.unverified, true);
    assert.equal(one.readinessFlag, UNVERIFIED_FLAG);
  });

  it("offers every Black Desk hypothesis as an unverified idea, however long it runs", () => {
    const built = cards(FULL);
    const black = built.filter((c) => /^BD\d+$/.test(c.storyId));
    assert.equal(black.length, 2, "the fixture's two hypotheses are cards");
    for (const one of black) {
      const words = one.body.split(/\s+/).filter(Boolean).length;
      assert.ok(words > 150, `${one.headline} runs longer than the 120-word idea limit`);
      assert.equal(one.kind, "idea", `${one.headline} is not a story, however long it is`);
      assert.equal(one.include, false);
      assert.equal(one.unverified, true);
      assert.equal(one.readinessFlag, UNVERIFIED_FLAG);
    }
  });

  it("reads the tier out of a paragraph, the tier table, and the words for it", () => {
    assert.deepEqual(readinessFromText("**Tier 1, ready for edit** as a service story; verify it."), {
      tier: 1,
      note: "as a service story; verify it.",
    });
    assert.equal(readinessFromText("**Tier 2, developing** — the dates are published.").tier, 2);
    assert.equal(readinessFromText("**Tier 3.** Only an index entry was read.").tier, 3);
    assert.equal(readinessFromText("**Tier 2 service brief / Tier 3 deeper angle.** Compare maps.").tier, 3);
    assert.equal(readinessFromText("Ready for edit as a service story.").tier, 1);
    assert.equal(readinessFromText("Nothing here states a tier.").tier, 0);
    assert.equal(readinessFromText("The council is developing a plan.").tier, 0);
  });

  it("still counts the words when the report states no tier at all", () => {
    const old = fixture("civic-scanner-longmont-2026-09-24.md");
    const built = cardsFromReport(parseFinishedStories(old));
    assert.equal(built.filter((c) => c.isStory && c.kind === "story").length, 7);
    assert.ok(built.every((c) => c.readiness === 0));
  });

  it("says what a card is in the review screen's own words", () => {
    assert.equal(
      kindForTier({ tier: 1, unverified: false, body: "One short line.", isStory: true }).kind,
      "story",
    );
    assert.equal(
      kindForTier({ tier: 2, unverified: false, body: "One short line.", isStory: true }).kind,
      "idea",
      "a developing row with no draft under it is a lead, not a story",
    );
    assert.equal(
      kindForTier({ tier: 3, unverified: true, body: "x ".repeat(400), isStory: true }).kind,
      "idea",
    );
    assert.equal(
      kindForTier({ tier: 3, unverified: true, body: "x ".repeat(400), isStory: true })
        .includeByDefault,
      false,
    );
  });
});

describe("the report's own filing label on a headline", () => {
  it("comes off the headline and is kept for the notes", () => {
    assert.deepEqual(storyIdFromHeading("L1 — New Longmont–airport bus begins Sunday"), {
      id: "L1",
      headline: "New Longmont–airport bus begins Sunday",
    });
    assert.deepEqual(storyIdFromHeading("**H3** SVVSD achievement and growth"), {
      id: "H3",
      headline: "SVVSD achievement and growth",
    });
    assert.deepEqual(storyIdFromHeading("21st Avenue rail crossing set for two closures"), {
      id: "",
      headline: "21st Avenue rail crossing set for two closures",
    });
    assert.deepEqual(storyIdFromHeading("BNSF completes rail safety work"), {
      id: "",
      headline: "BNSF completes rail safety work",
    });
  });

  it("leaves no ID on the card's headline, and keeps it in the notes", () => {
    assert.equal(card("S1").headline, "Council approves on-bill financing for efficiency upgrades");
    assert.match(card("S1").notes, /S1/);
    for (const one of cards(DAILY)) {
      assert.equal(/^\**\s*[LHSB]\d+\s*[—–-]/.test(one.headline), false, one.headline);
    }
  });
});

describe("the claims ledger the report attaches to a story", () => {
  it("reads the ledger table off the card and out of the published text", () => {
    const one = card("S1");
    assert.equal(one.claims.length, 3);
    assert.deepEqual(
      one.claims.map((c) => c.status),
      ["VERIFIED", "VERIFIED", "UNVERIFIED"],
    );
    assert.deepEqual(one.claims[0]!.sources, ["S1-A1"]);
    assert.equal(one.claims[2]!.text, "Interest rate and effective date.");
    assert.equal(one.body.includes("| Claim | Status |"), false, "the ledger is not published");
    assert.equal(one.body.includes("Claims and sources attached"), false);
    assert.match(one.body, /Longmont's city council gave final approval/);
  });

  it("puts the ledger, with its statuses, in the editor's notes", () => {
    const notes = card("S1").notes;
    assert.match(notes, /Claims ledger — never published/);
    assert.match(notes, /VERIFIED/);
    assert.match(notes, /UNVERIFIED/);
    assert.match(notes, /S1-A1/);
    assert.equal(notes.includes("| Claim |"), false);
  });

  it("raises a visible warning on a card carrying an unverified or contested claim", () => {
    assert.equal(claimsWarning(card("S1").claims), "1 claim is unverified or contested — read the claims ledger in the editor notes before publishing.");
    assert.match(claimsWarning(card("S3").claims), /^2 claims are/);
    assert.equal(claimsWarning([]), "");
    assert.equal(card("S1").claimsWarning, claimsWarning(card("S1").claims));
  });

  it("names the documents the report cited, and keeps the URLs as links", () => {
    const one = card("S1");
    assert.deepEqual(one.citations, [
      "S1-A1 · City of Longmont ordinance O-2026-63 (Tier A for the city's own ordinance)",
      "S1-A2 · Sept. 22 agenda packet (Tier A, cached copy only)",
    ]);
    assert.ok(one.links.some((l) => l.url.includes("ordinance-o-2026-63")));
  });

  it("takes the countercheck sentence out of the citations", () => {
    const one = storyOf("L1", DAILY);
    assert.deepEqual(one.citations, [
      "L1-A1 · RTD final service changes (Tier A for RTD's announced plan)",
      "L1-A2 · RTD upcoming schedules (Tier A)",
    ]);
    for (const citation of one.citations) assert.equal(/Countercheck/.test(citation), false);
  });
});

describe("the held and potential table", () => {
  it("gives every row its own card: lead-in headline, description, tier, next check", () => {
    const built = cards(DAILY);
    const held = built.filter((c) => /^H\d+$/.test(c.storyId));
    assert.equal(held.length, 9, "the report's nine held rows are nine cards");
    assert.deepEqual(
      held.map((c) => c.storyId),
      ["H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8", "H9"],
    );
    assert.equal(held[0]!.headline, "Dry Creek annexation amendments");
    assert.match(held[0]!.body, /^\[Secondary report\]|^Secondary report/);
    assert.ok(held[0]!.links.some((l) => l.url.includes("thebadger.news")));
    assert.equal(held[0]!.readiness, 2);
    assert.equal(held[0]!.readinessFlag, DEVELOPING_FLAG);
    assert.match(held[0]!.readinessNote, /Obtain a usable official recording/);
    assert.equal(held[1]!.readiness, 3);
    assert.equal(held[1]!.readinessFlag, UNVERIFIED_FLAG);
    assert.equal(held[0]!.kind, "idea");
    for (const one of held) {
      assert.equal(one.kind, "idea", `${one.storyId} has no draft-length body`);
      assert.equal(one.include, false, `${one.storyId} imports only if the editor ticks it`);
      assert.equal(one.includeByDefault, false);
    }
  });

  it("leaves no card holding the table, and keeps the section's closing prose", () => {
    const built = cards(DAILY);
    for (const one of built) {
      assert.equal(/\|\s*H\d+\s*\|/.test(one.body), false, `${one.headline} still carries table rows`);
    }
    const closing = built.find((c) => c.headline.startsWith("Held and potential stories"));
    assert.ok(closing, "the section's own prose is still a card");
    assert.match(closing!.body, /possible deeper investigations/);
  });
});

describe("the run's own status", () => {
  it("reads PARTIAL and what the run says remains", () => {
    const report = parseFinishedStories(FULL);
    assert.equal(report.runStatus, "PARTIAL");
    assert.ok(report.runRemains.some((line) => /council recording/.test(line)));
    const daily = parseFinishedStories(DAILY);
    assert.equal(daily.runStatus, "PARTIAL");
    assert.ok(daily.runRemains.some((line) => /meeting records/.test(line)));
  });

  it("finds no status on a report that states none", () => {
    const report = parseFinishedStories(fixture("civic-scanner-longmont-2026-09-24.md"));
    assert.equal(report.runStatus, "");
    assert.deepEqual(report.runRemains, []);
  });
});

describe("a full-pipeline JSON paste", () => {
  it("reads the same cards out of the schema's own shape", () => {
    const report = parseFinishedStories(JSON_REPORT);
    assert.equal(report.method, "json");
    const built = cards(JSON_REPORT);
    const s1 = built.find((c) => c.headline.startsWith("Council approves on-bill"))!;
    assert.equal(s1.readiness, 1);
    assert.equal(s1.kind, "story");
    assert.equal(s1.include, true);
    assert.equal(s1.claims.length, 3);
    assert.ok(s1.claims.some((c) => c.status === "UNVERIFIED"));
    assert.deepEqual(s1.citations, [
      "S1-A1 · City of Longmont ordinance O-2026-63 (Ordinance O-2026-63, final reading)",
      "S1-A2 · Sept. 22 council agenda packet (Item 9B, first reading)",
    ]);
    assert.ok(s1.links.some((l) => l.url.includes("ordinance-o-2026-63")));

    const s3 = built.find((c) => c.headline.startsWith("Students to prepare"))!;
    assert.equal(s3.readiness, 2);
    assert.equal(s3.kind, "story");
    assert.equal(s3.include, false);
    assert.match(s3.readinessNote, /Senior Services|meal count|eligibility/);

    const black = built.filter((c) => c.kind === "idea" && c.unverified);
    assert.equal(black.length, 3, "two Black Desk hypotheses and the Tier 3 held lead");
    for (const one of black) assert.equal(one.include, false);

    /*
      The held leads, by their own tiers: `scoring` is the tier field in the
      JSON shape, exactly as column 3 is in the markdown table. A Tier 2 hold is
      developing, not unverified -- it is a lead with gaps, and printing
      "Unverified — Black Desk" on it would be the desk inventing an accusation
      the report did not make.
    */
    const held = built.filter((c) => /^H\d+$/.test(c.storyId));
    assert.equal(held.length, 2, "the JSON's two held leads are two cards");
    assert.deepEqual(
      held.map((c) => c.storyId),
      ["H1", "H2"],
    );
    for (const one of held) {
      assert.equal(one.kind, "idea", `${one.storyId} has no draft under it`);
      assert.equal(one.include, false);
      assert.equal(one.includeByDefault, false);
    }
    assert.equal(held[0]!.headline, "Growing Shade free trees");
    assert.equal(held[0]!.readiness, 2);
    assert.equal(held[0]!.readinessFlag, DEVELOPING_FLAG);
    assert.match(held[0]!.readinessNote, /eligibility map and canopy method/);
    assert.equal(held[1]!.readiness, 3);
    assert.equal(held[1]!.readinessFlag, UNVERIFIED_FLAG);
    assert.match(held[1]!.readinessNote, /full measure texts/);
    assert.equal(report.runStatus, "PARTIAL");
  });

  it("tolerates fields the desk does not know, and refuses a paste that is not a report", () => {
    const extra = JSON.parse(JSON_REPORT) as Record<string, unknown>;
    extra.somethingNew = { from: "a later version" };
    const report = parseFinishedStories(JSON.stringify(extra));
    assert.equal(report.method, "json");
    assert.ok(report.stories.length > 0);
    const notAReport = parseFinishedStories('{"hello":"world"}');
    assert.equal(notAReport.method, "none");
    assert.equal(notAReport.stories.length, 0);
  });
});

describe("the Dark Desk handoff an unverified card carries", () => {
  it("seeds the start box with the hypothesis, its label and its next check", () => {
    const seed = darkSeedFromCard(card("H2"));
    assert.equal(
      seed.split("\n")[0],
      "Unverified — Black Desk · H2 — Election service and ballot explainer",
    );
    assert.match(seed, /lists four Nov\. 3 measures/);
    assert.match(seed, /Next check: Compare full measure texts/);
  });

  it("never writes a second next check over one the hypothesis already carries", () => {
    const seed = darkSeedFromCard(card("BD1"));
    assert.match(seed, /^Unverified — Black Desk · BD1 — The Dry Creek annexation/);
    assert.equal(seed.split("Next check:").length - 1, 1, "the report's own check, once");
    assert.match(seed, /obtain a usable official recording/);
  });

  it("banners a run that stopped early, and stays quiet on a whole one", () => {
    const banner = runBanner(parseFinishedStories(FULL));
    assert.equal(banner?.status, "PARTIAL");
    assert.ok(banner!.remains.some((line) => /council recording/.test(line)));
    assert.equal(runBanner(parseFinishedStories("A report with no status at all.")), null);
  });
});

describe("the notes an editor reads", () => {
  it("carries the ID, the tier, its qualifier, the ledger and the next step", () => {
    const one = storyOf("L1", DAILY);
    const notes = editorNotesFor(one);
    assert.match(notes, /L1/);
    assert.match(notes, /Editorial tier 1/);
    assert.match(notes, /verify the live timetable and fare immediately before publishing/);
    assert.match(notes, /Claims ledger/);
    assert.match(notes, /UNVERIFIED/);
  });
});
