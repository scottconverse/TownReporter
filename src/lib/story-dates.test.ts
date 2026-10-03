import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  collectStoryDates,
  hostOnly,
  storyDateRows,
  structuredDate,
  type StoryDateSource,
} from "./story-dates.ts";

/**
 * The panel's domain line, and the dates it hangs on.
 *
 * Unit BD3: "Dates in this story" printed a whole URL where the design prints a
 * domain, and the event text above it broke mid-word. `hostOnly` is the first
 * half of that fix; the second is CSS (`overflow-wrap: break-word` on
 * `.datewhat`, `anywhere` kept on `.datenote`) and is measured in a browser by
 * `scripts/paper-panels.mjs`.
 */
describe("hostOnly", () => {
  it("reduces a URL to its host, without www", () => {
    assert.equal(
      hostOnly("https://www.longmontcolorado.gov/agenda-1.pdf?rev=2#page=4"),
      "longmontcolorado.gov",
    );
    assert.equal(
      hostOnly("http://agendas.longmont.primegov.com/View.ashx?M=F&ID=1&GUID=abc"),
      "agendas.longmont.primegov.com",
    );
  });

  it("leaves a bare host, a name and junk exactly as they came", () => {
    assert.equal(hostOnly("longmont.primegov.com"), "longmont.primegov.com");
    assert.equal(hostOnly("Longmont City Council"), "Longmont City Council");
    assert.equal(hostOnly("  Boulder County  "), "Boulder County");
    assert.equal(hostOnly("not a url at all"), "not a url at all");
  });
});

describe("collectStoryDates notes", () => {
  it("prints the host for a URL-shaped organization and the name otherwise", () => {
    const items = collectStoryDates([
      {
        slug: "story-1",
        section: "council",
        records: [
          {
            title: "Council packet",
            organization: "https://www.longmontcolorado.gov/agenda-1.pdf",
            document_date: "2026-09-28",
          },
          {
            title: "Staff report",
            organization: "Longmont City Council",
            document_date: "2026-09-29",
          },
        ],
      },
    ]);
    assert.deepEqual(
      items.map((i) => i.note),
      ["longmontcolorado.gov", "Longmont City Council"],
    );
  });

  it("still drops a record with no usable date", () => {
    const items = collectStoryDates([
      {
        slug: "story-1",
        section: "council",
        records: [
          { title: "Undated", organization: "longmontcolorado.gov", document_date: "early Sept" },
        ],
      },
    ]);
    assert.deepEqual(items, []);
    assert.equal(structuredDate("2026-02-31"), "");
  });
});

/**
 * Unit BX: the dates a printed story's records actually carry.
 *
 * The live front page printed "No published story carries a date in the next
 * seven days" over a grid whose own stories named Oct. 1, Oct. 3 and Sept. 29.
 * The records were there; the reader only accepted a value that STARTED with an
 * ISO day. `document_date` is a free-form string (`report.ts` stores
 * `String(o.document_date ?? "")` and asks for no format), so these are the
 * shapes it arrives in.
 */
describe("structuredDate: days written out", () => {
  it("reads the forms a document bears", () => {
    assert.equal(structuredDate("2026-10-01"), "2026-10-01");
    assert.equal(structuredDate("2026-10-01T09:00:00-06:00"), "2026-10-01");
    assert.equal(structuredDate("10/1/2026"), "2026-10-01");
    assert.equal(structuredDate("October 1, 2026"), "2026-10-01");
    assert.equal(structuredDate("Oct. 1, 2026"), "2026-10-01");
    assert.equal(structuredDate("Thursday, October 1st, 2026"), "2026-10-01");
    assert.equal(structuredDate("1 October 2026"), "2026-10-01");
    assert.equal(structuredDate("Oct 1 26"), "2026-10-01");
    // A first number that cannot be a month is the day, not the month.
    assert.equal(structuredDate("17/10/2026"), "2026-10-17");
  });

  it("reads a day with no year against the reference day, and drops it without one", () => {
    assert.equal(structuredDate("Sept. 29", "2026-09-27"), "2026-09-29");
    assert.equal(structuredDate("10/1", "2026-09-27"), "2026-10-01");
    assert.equal(structuredDate("Sept. 29"), "");
  });

  it("still refuses a value that names no day, or no real day", () => {
    assert.equal(structuredDate("early Sept"), "");
    assert.equal(structuredDate("September 2026"), "");
    assert.equal(structuredDate("last week"), "");
    assert.equal(structuredDate("2026-02-31"), "");
    assert.equal(structuredDate("2026-11-31"), "");
    assert.equal(structuredDate("13/45/2026"), "");
  });

  it("prints the days printed stories name, inside the next seven days", () => {
    const items = collectStoryDates(
      [
        {
          slug: "hearing",
          section: "council",
          records: [
            {
              title: "Funding hearing packet",
              organization: "longmontcolorado.gov",
              document_date: "October 1, 2026",
            },
          ],
        },
        {
          slug: "event",
          section: "events",
          records: [
            { title: "Canvassing day", organization: "Example", document_date: "Oct. 3, 2026" },
          ],
        },
        {
          slug: "deadline",
          section: "council",
          records: [
            {
              title: "Applications close",
              organization: "longmontcolorado.gov",
              document_date: "Sept. 29",
            },
          ],
        },
        {
          slug: "later",
          section: "council",
          records: [
            { title: "Second reading", organization: "Example", document_date: "Oct. 6, 2026" },
          ],
        },
      ],
      { from: "2026-09-27", days: 7 },
    );
    // The second reading is on day nine and stays out; the other three are in.
    assert.deepEqual(
      items.map((i) => i.date),
      ["2026-09-29", "2026-10-01", "2026-10-03"],
    );
  });
});

/**
 * Unit BX2: the dates a printed story names in its own words.
 *
 * The live paper's twelve newest published articles carry no `document_date` at
 * all -- every record's value is `''` -- so the panel beside them stayed empty
 * while the stories named their own dates out loud. These are the five strings
 * the coordinator quoted off the live page, plus the three cases that keep the
 * reader honest: a date inside the story but outside the week, a date that
 * belongs to the coming year, and text that only looks like a date.
 */
describe("the story's own words (unit BX2)", () => {
  const story = (over: Partial<StoryDateSource>): StoryDateSource => ({
    slug: "story",
    section: "council",
    records: [],
    ...over,
  });

  it("reads the dates the live stories name in their headlines and deks", () => {
    const items = collectStoryDates(
      [
        story({
          slug: "hiring",
          headline:
            "Longmont Hiring Director of Power Delivery and Operations; Applications Close Sept. 29",
          published_on: "2026-09-27",
        }),
        story({
          slug: "ranked",
          headline:
            "Ranked-choice campaign schedules Sept. 26 canvassing day and Oct. 3 Brighton event for 3C and 3D",
          published_on: "2026-09-25",
        }),
        story({
          slug: "reading",
          // A headline every real story carries (unlike this fixture before unit
          // BZ, item 6): with none to fall back to, a bare dek clause like
          // "public hearing and second reading" had nowhere better to go.
          headline: "Council Weighs Rate Study Ahead Of Public Hearing",
          dek: "The unanimous vote sends the plan to an Oct. 6 public hearing and second reading at the council.",
          published_on: "2026-09-25",
        }),
        story({
          slug: "packet",
          headline: "Housing And Human Services Board Posts Funding Hearing Packet",
          dek: "The board has posted an Oct. 1 funding hearing packet ahead of the meeting.",
          published_on: "2026-09-26",
        }),
        story({
          slug: "class",
          headline:
            "Longmont Public Media lists beginner DaVinci Resolve editing class for Sept. 29",
          published_on: "2026-09-27",
        }),
      ],
      // Ten days so the Oct. 6 second reading is inside the sweep; the Sept. 26
      // canvassing day is behind the window's first day either way.
      { from: "2026-09-27", days: 10 },
    );
    assert.deepEqual(
      items.map((i) => [i.date, i.what]),
      [
        /*
          Unit CV, item 2. Each row now names its own event instead of reprinting
          a whole headline over every day the story mentions:

          - "hiring" is the one case left on the headline. The story's clause for
            Sept. 29 is "Applications Close" -- two words, no verb the fragment
            test knows -- and rule (c) prints the headline, which names the 29th,
            so it is about the day the row is on.
          - "class" and "ranked" take rule (a): their headlines name the day, so
            the row is the headline's own clause for it minus the date.
          - "packet" takes rule (b): its headline names no day, and the sentence
            carrying the 1st ("The board has posted an Oct. 1 funding hearing
            packet ahead of the meeting.") is complete inside the word bound.
          - "reading" stays on the headline: its dek clause for Oct. 6 runs to
            sixteen words, past the bound, and its headline names no day.
        */
        [
          "2026-09-29",
          "Longmont Hiring Director of Power Delivery and Operations; Applications Close Sept. 29",
        ],
        ["2026-09-29", "Longmont Public Media lists beginner DaVinci Resolve editing class"],
        ["2026-10-01", "The board has posted a funding hearing packet ahead of the meeting"],
        ["2026-10-03", "Ranked-choice campaign schedules Sept. 26 canvassing day and Oct. 3 Brighton event for 3C and 3D"],
        ["2026-10-06", "Council Weighs Rate Study Ahead Of Public Hearing"],
      ],
    );
    // Every item links back to the story whose words printed it.
    assert.deepEqual(
      items.map((i) => i.slug),
      ["hiring", "class", "packet", "ranked", "reading"],
    );
  });

  it("gives the 26th its own line and its own day when the window is open", () => {
    // Sept. 26 is inside the story and outside the week the front page prints.
    const headline =
      "Ranked-choice campaign schedules Sept. 26 canvassing day and Oct. 3 Brighton event for 3C and 3D";
    const source = story({ slug: "ranked", headline, published_on: "2026-09-25" });
    assert.deepEqual(
      collectStoryDates([source], { from: "2026-09-27", days: 7 }).map((i) => i.date),
      ["2026-10-03"],
    );
    // Unit CV, item 2, rule (a): the headline names both days, so each row is
    // the headline's own clause for its own day -- the 26th owns "canvassing
    // day"; the 3rd falls back to the headline because its clause is a fragment.
    assert.deepEqual(
      collectStoryDates([source]).map((i) => [i.date, i.what]),
      [
        ["2026-09-26", "Ranked-choice campaign schedules canvassing day"],
        ["2026-10-03", "Ranked-choice campaign schedules Sept. 26 canvassing day and Oct. 3 Brighton event for 3C and 3D"],
      ],
    );
  });

  it("reads a year-less day against the story's own publish day", () => {
    // Filed in December, "Jan. 5" cannot mean the January eleven months gone.
    assert.deepEqual(
      collectStoryDates([
        story({
          slug: "budget",
          headline: "Council sets the budget adoption vote for Jan. 5",
          published_on: "2026-12-15",
        }),
      ]).map((i) => [i.date, i.what]),
      // The words before the date are the line: the day rolls, the clause does not.
      [["2027-01-05", "Council sets the budget adoption vote"]],
    );
    // A day a month or two behind its story is still this year's.
    assert.deepEqual(
      collectStoryDates([
        story({
          slug: "august",
          headline: "The council revisited its Aug. 1 decision",
          published_on: "2026-09-27",
        }),
      ]).map((i) => i.date),
      ["2026-08-01"],
    );
    // A written year is the date's own and is never rolled. Its line is the
    // sentence the date sits in, with the date expression taken out (unit CV,
    // item 2, rule (b)): "Records for the hearing are posted" is complete, and
    // the year between the day and the noun it belongs to goes with the date.
    assert.deepEqual(
      collectStoryDates([
        story({
          slug: "written",
          headline: "Records for the Oct. 8, 2026 hearing are posted",
          published_on: "2026-12-15",
        }),
      ]).map((i) => [i.date, i.what]),
      [["2026-10-08", "Records for the hearing are posted"]],
    );
  });

  it("reads no date out of words that only look like one", () => {
    const noise = [
      "Section 8 of the code covers the fee",
      "Prop 123 is on the ballot",
      "3C and 3D are the two questions",
      "The March 2026 packet is posted",
      "Mayor Ferrell said the plan may need 5 more weeks",
    ];
    for (const text of noise) {
      assert.deepEqual(
        collectStoryDates([story({ headline: text, published_on: "2026-09-27" })]),
        [],
        `read a date out of: ${text}`,
      );
    }
  });

  it("prints one day once for a story whose record and headline name it", () => {
    const items = collectStoryDates(
      [
        story({
          slug: "hearing",
          headline: "Council sets an Oct. 1 hearing on the rate study",
          dek: "The Oct. 1 hearing is the second of two readings.",
          published_on: "2026-09-27",
          records: [
            {
              title: "Funding hearing packet",
              organization: "longmontcolorado.gov",
              document_date: "2026-10-01",
            },
          ],
        }),
      ],
      { from: "2026-09-27", days: 7 },
    );
    // The record's own title is the better line, and it is printed alone.
    assert.deepEqual(
      items.map((i) => [i.date, i.what, i.note]),
      [["2026-10-01", "Funding hearing packet", "longmontcolorado.gov"]],
    );
  });

  it("reads a whole date expression, not just the day it starts on", () => {
    // A RANGE names its first day. The headline is the shape BX3 built: the
    // live page printed "-2 instrument collection drive" under Oct. 1.
    //
    // Each dash is read on its own story: two identical rows from two stories
    // collapse into one, so a single call cannot tell which dash was read.
    // "instrument collection drive" and "regular meeting" are bare scraps
    // (unit BZ, item 6) and fall back to the headline, which here is nothing
    // but the date expression and the scrap -- the honest printed text for a
    // headline this short, and still an improvement (a reader sees the whole
    // headline instead of a fragment of it).
    for (const [slug, headline] of [
      ["drive", "Oct. 1-2 instrument collection drive"],
      ["drive-en", "Oct. 1–2 instrument collection drive"],
    ] as const) {
      assert.deepEqual(
        collectStoryDates([story({ slug, headline, published_on: "2026-09-27" })]).map((i) => [
          i.date,
          i.what,
        ]),
        [["2026-10-01", headline]],
        `read a range out of: ${headline}`,
      );
    }
    // A LIST names a day per number, and each gets its own row on that day --
    // the same line, because it is one clause about one thing. The live page
    // printed "8 regular meeting" under Oct. 1.
    for (const headline of ["Oct. 1 and 8 regular meeting", "Oct. 1, 8 regular meeting"]) {
      assert.deepEqual(
        collectStoryDates([story({ headline, published_on: "2026-09-27" })]).map((i) => [
          i.date,
          i.what,
        ]),
        [
          ["2026-10-01", headline],
          ["2026-10-08", headline],
        ],
        `read a list out of: ${headline}`,
      );
      // The second day is a day like any other: outside the week, it is not
      // printed, and the first day's line is not the list's tail.
      assert.deepEqual(
        collectStoryDates([story({ headline, published_on: "2026-09-27" })], {
          from: "2026-09-28",
          days: 7,
        }).map((i) => [i.date, i.what]),
        [["2026-10-01", headline]],
        `read a list out of: ${headline}`,
      );
    }
    // The tail reader does not run a date into the next one: two rows, one for
    // each day, and -- since unit CV, item 2 -- each row naming its own event
    // out of the headline's own clause for its day.
    {
      const headline =
        "Ranked-choice campaign schedules Sept. 26 canvassing day and Oct. 3 Brighton event for 3C and 3D";
      assert.deepEqual(
        collectStoryDates([story({ slug: "ranked", headline, published_on: "2026-09-25" })]).map(
          (i) => [i.date, i.what],
        ),
        [
          ["2026-09-26", "Ranked-choice campaign schedules canvassing day"],
          ["2026-10-03", "Ranked-choice campaign schedules Sept. 26 canvassing day and Oct. 3 Brighton event for 3C and 3D"],
        ],
      );
    }
  });

  it("prints the headline when the clause is a place and not an event", () => {
    // The shapes BX3 quotes off the live page: the words after the date name
    // where the reader goes, not what happens when they get there.
    //
    // The third is the REAL string, not a shape. "Longmont Senior Center to
    // begin free meal pickups Oct. 2" is the desk's own headline for that story
    // (`src/lib/news/fixtures/civic-scanner-v26-longmont-2026-09-25.md:59`, and
    // the design handoff's own front page), and it is where the live paper's
    // Fri 2 line "Longmont Senior Center" came from: with the date at the END
    // the words before it are the sentence's subject, and the STOP_WORDS loop
    // cut the verb phrase off it. It printed that name until unit BX3.
    //
    // Unit CV, item 2 changes what the third one prints, and only the third:
    // the headline NAMES Oct. 2, so rule (a) builds the row out of the
    // headline's own clause for that date -- "Longmont Senior Center to begin
    // free meal pickups", the whole subject and its verb phrase, with the date
    // expression (which the panel prints in its own column) taken out. The
    // first two still print the headline: "Longmont Senior Center" and "Clark
    // Centennial Park" are names of places, three words with no verb, and rule
    // (b) refuses them as fragments.
    //
    // The Clark Centennial Park source string is NOT in this repo -- grep for
    // it over every tracked file finds it only in the design handoff's rendered
    // front page, which carries the row ("Growing Shade tree pickup, Clark
    // Centennial Park", `docs/design/handoff-2026-09-26/design/Front
    // Daily.dc.html:130`) and not the story text behind it. So Sat 3 is the
    // sanctioned shape, and the row the handoff prints is what the shape is
    // trying to reach.
    for (const [slug, text, date, printed] of [
      ["meal-dek", "on Oct. 2 at the Longmont Senior Center", "2026-10-02", null],
      ["tree-shape", "Oct. 3 at Clark Centennial Park", "2026-10-03", null],
      [
        "meal-real",
        "Longmont Senior Center to begin free meal pickups Oct. 2",
        "2026-10-02",
        "Longmont Senior Center to begin free meal pickups",
      ],
    ] as const) {
      assert.deepEqual(
        collectStoryDates([story({ slug, headline: text, published_on: "2026-09-27" })]).map(
          (i) => [i.date, i.what],
        ),
        [[date, printed ?? text]],
        `printed the headline for: ${text}`,
      );
    }
    // The desk's own title case still tells a clause ("Applications Close")
    // from a name ("Longmont Senior Center"). But unit BZ, item 6 (owner review,
    // 2026-09-27) found that a two-word clause is still too short to stand alone
    // as a row's only text: "Applications Close" does not say applications for
    // WHAT, so it is a bare fragment (`isBareFragment`). Under unit CV, item 2
    // rule (c) the row falls to the headline -- which is safe here because the
    // headline names Sept. 29, the day the row is on.
    assert.deepEqual(
      collectStoryDates([
        story({
          slug: "applications",
          headline:
            "Longmont Hiring Director of Power Delivery and Operations; Applications Close Sept. 29",
          published_on: "2026-09-27",
        }),
      ]).map((i) => [i.date, i.what]),
      [
        [
          "2026-09-29",
          "Longmont Hiring Director of Power Delivery and Operations; Applications Close Sept. 29",
        ],
      ],
    );
    // A line left as a fragment of a longer sentence is refused too, and the row
    // keeps the sentence it was cut from instead (unit CV, item 2, rule (b)):
    // the date is a date the story names, and the words around it are a
    // complete clause rather than a scrap.
    assert.deepEqual(
      collectStoryDates([
        story({
          slug: "written",
          headline: "Records for the Oct. 8, 2026 hearing are posted",
          published_on: "2026-12-15",
        }),
      ]).map((i) => [i.date, i.what]),
      [["2026-10-08", "Records for the hearing are posted"]],
    );
  });

  it("links a row to its story, except on the page the story is printed on", () => {
    const items = collectStoryDates([
      story({
        slug: "reading",
        headline: "Council takes up the rate study",
        dek: "The vote sends the plan to an Oct. 6 public hearing and second reading.",
        published_on: "2026-09-27",
      }),
    ]);
    // The front page splits the day into the panel's two columns and links the
    // row back to the story whose words named it. The row's text is the sentence
    // the date sits in (unit CV, item 2, rule (b)) -- twelve words, the bound
    // the brief sets, and a complete clause rather than the bare scrap "public
    // hearing and second reading" the old cut left.
    assert.deepEqual(
      storyDateRows(items).map((r) => [r.dow, r.day, r.what, r.slug]),
      [["Tue", "6", "The vote sends the plan to a public hearing and second reading", "reading"]],
    );
    // ...and the article page, which IS that story, prints the same row plain.
    assert.deepEqual(
      storyDateRows(items, "reading").map((r) => [r.dow, r.day, r.slug]),
      [["Tue", "6", undefined]],
    );
  });
});

/**
 * Unit BZ, item 5: a row's line must be about the day the row is on.
 *
 * The audit's case is the live front page's Thu Oct. 1 row, whose line was the
 * headline "Longmont Housing Board Cancels Oct. 8 Regular Meeting; ..." under a
 * row about the 1st: the story named Oct. 1 in its dek (a funding hearing) and
 * Oct. 8 in its headline (a cancelled regular meeting), and -- in the audit's
 * own words -- "a clause that failed the clean-line test falls back to the
 * headline", so the reader got a sentence about the 8th under the 1st.
 *
 * The headline and dek below are written to that case rather than recovered
 * from it: the live story's own text is not in this repo (`grep` for "Housing
 * Board" over every tracked file finds it in the audit note and nowhere else),
 * and the audit quotes the headline only to its ellipsis. What the dek is
 * written to is the mechanism the audit names: its clause for the 1st is one
 * the clean-line test refuses, which is why the old code printed the headline.
 */
describe("a row the headline is not about (unit BZ, item 5)", () => {
  const story = (over: Partial<StoryDateSource>): StoryDateSource => ({
    slug: "story",
    section: "council",
    records: [],
    ...over,
  });
  /** The desk's headline for the cancelled meeting, quoted as the audit quotes it. */
  const HOUSING_HEADLINE =
    "Longmont Housing Board Cancels Oct. 8 Regular Meeting; Funding Hearings Still On";

  it("gives a day the headline is not about the dek's own clause for it", () => {
    const items = collectStoryDates([
      story({
        slug: "housing",
        headline: HOUSING_HEADLINE,
        // The 1st's clause is all-capital, which `cleanLine` reads as a NAME and
        // refuses; the 8th is named by the headline, which the row keeps.
        dek: "Oct. 1 Funding Hearing Packet Posted; Oct. 8 Regular Meeting Cancelled.",
        published_on: "2026-09-27",
      }),
    ]);
    // The 8th is named by the headline, so unit CV, item 2 rule (a) builds the
    // row out of the headline's own clause for that date -- "Longmont Housing
    // Board Cancels Regular Meeting", which is the day's own event with the date
    // expression taken out, rather than the whole headline with a second day's
    // business still glued to its tail.
    assert.deepEqual(
      items.map((i) => [i.date, i.what, i.slug]),
      [
        ["2026-10-01", "Funding Hearing Packet Posted", "housing"],
        ["2026-10-08", "Longmont Housing Board Cancels Regular Meeting", "housing"],
      ],
      "the 1st printed words about the 8th",
    );
  });

  it("names the event in the words the day's own clause gives", () => {
    // The normal case, and the live one: the desk's own meal-pickup headline
    // names Oct. 2, so the row is the headline's clause for that date (unit CV,
    // item 2, rule (a)) -- the subject and its verb phrase, no date.
    const meal = "Longmont Senior Center to begin free meal pickups Oct. 2";
    assert.deepEqual(
      collectStoryDates([story({ slug: "meal", headline: meal, published_on: "2026-09-27" })]).map(
        (i) => [i.date, i.what],
      ),
      [["2026-10-02", "Longmont Senior Center to begin free meal pickups"]],
    );
    // A row read out of the dek whose headline names NO day falls to rule (b):
    // the sentence carrying the 6th is "A hearing is set for Oct. 6", and what
    // it prints is that sentence with the date expression taken out. The line
    // keeps a subject and a verb, so it is a clause rather than the fragment the
    // brief forbids -- the date it no longer carries is the thing the panel
    // prints in its own day column, and rule (c)'s headline is only the answer
    // when no clause reads at all. `isBareFragment` records why refusing a line
    // for ending on its verb was tried and taken back out.
    const dateless = story({
      slug: "fee",
      headline: "Council weighs the fee schedule",
      dek: "A hearing is set for Oct. 6; the vote comes later.",
      published_on: "2026-09-27",
    });
    assert.deepEqual(
      collectStoryDates([dateless]).map((i) => [i.date, i.what]),
      [["2026-10-06", "A hearing is set"]],
    );
  });

  it("drops a day the dek gives no clause for rather than printing another day's words", () => {
    // A dek that names the day and nothing else leaves one word when the date is
    // taken out -- a fragment, not a line -- so the row goes rather than being
    // printed under the headline's Oct. 8 sentence.
    const items = collectStoryDates([
      story({
        slug: "posted",
        headline: HOUSING_HEADLINE,
        dek: "Posted Oct. 1.",
        published_on: "2026-09-27",
      }),
    ]);
    // "Posted" is the whole of the 1st's clause once the date comes out of it,
    // and one word is a fragment, not a name (unit CV, item 2: "never output a
    // fragment"). The 8th keeps the headline's own clause for it.
    assert.deepEqual(
      items.map((i) => [i.date, i.what]),
      [["2026-10-08", "Longmont Housing Board Cancels Regular Meeting"]],
      "a day with no clause of its own was printed anyway",
    );
  });
});

/**
 * Unit BZ, item 6, kept under unit CV, item 2: a row title must not be a fragment.
 *
 * Owner review of the staged front page at 1790px (2026-09-27): "This week"
 * printed lower-case scraps and bare nouns lifted from a clause -- a reader
 * who has not read the story cannot tell what "Brighton event" is an event
 * FOR, or what is closing in "Applications Close". Each of the four exact
 * fragments the review named is still its own test here, against the real
 * headline and dek text that produced it.
 *
 * What changed is what prints INSTEAD. Until unit CV the answer was always the
 * story's headline, which is where the designer's second complaint came from:
 * the same headline over every day a story mentions names no event in
 * particular ("one row per event, with a short complete event name"). The
 * clause rules now run first -- the headline's own clause for that date, then
 * the sentence carrying the date -- and the headline is the last resort, for a
 * day whose words are genuinely a scrap or whose sentence is too long to print.
 */
describe("a row title must read as a headline, not a bare fragment (unit BZ, item 6)", () => {
  const story = (over: Partial<StoryDateSource>): StoryDateSource => ({
    slug: "story",
    section: "council",
    records: [],
    ...over,
  });

  it('never prints "funding hearing packet" as a row', () => {
    const headline = "Housing And Human Services Board Posts Funding Hearing Packet";
    const items = collectStoryDates([
      story({
        slug: "packet",
        headline,
        dek: "The board has posted an Oct. 1 funding hearing packet ahead of the meeting.",
        published_on: "2026-09-26",
      }),
    ]);
    // Rule (b): the dek's sentence for the 1st is complete and inside the word
    // bound, so the row is that sentence -- the scrap with the verb and subject
    // it was missing, and an article mended at the join ("an" becomes "a" in
    // front of "funding").
    assert.deepEqual(
      items.map((i) => [i.date, i.what]),
      [["2026-10-01", "The board has posted a funding hearing packet ahead of the meeting"]],
    );
  });

  it('keeps "St." with its name and drops the word that introduced the date (0.6.82)', () => {
    const items = collectStoryDates([
      story({
        slug: "open-houses",
        headline: "St. Vrain lists upcoming school open houses beginning Oct. 1",
        published_on: "2026-09-27",
      }),
    ]);
    assert.deepEqual(
      items.map((i) => [i.date, i.what]),
      [["2026-10-01", "St. Vrain lists upcoming school open houses"]],
    );
  });

  it('reads "Main St." at the end of a sentence as the end (0.6.82, Codex P2)', () => {
    const headline = "Crews repave Main St. The council meets Oct. 1 on the budget";
    const items = collectStoryDates([
      story({ slug: "main-st", headline, published_on: "2026-09-27" }),
    ]);
    // The headline itself is an allowed fallback (rule c); a clause built across
    // the two sentences ("Crews repave Main St. The council meets on the budget")
    // is not.
    assert.ok(
      items.every((i) => i.what === headline || !/Main St/.test(i.what)),
      `the Oct. 1 row must not reach back into the previous sentence: ${JSON.stringify(items)}`,
    );
  });

  it('never prints "instrument collection drive" as a row', () => {
    const headline = "Oct. 1-2 instrument collection drive";
    const items = collectStoryDates([
      story({ slug: "drive", headline, published_on: "2026-09-27" }),
    ]);
    // The headline is nothing but the date expression and the scrap, so there
    // is no clause to build from and rule (c) prints the headline: a reader
    // sees the whole line rather than three bare words out of it.
    assert.deepEqual(
      items.map((i) => [i.date, i.what]),
      [["2026-10-01", headline]],
    );
  });

  it('never prints "Brighton event" as a row', () => {
    const headline =
      "Ranked-choice campaign schedules Sept. 26 canvassing day and Oct. 3 Brighton event for 3C and 3D";
    const items = collectStoryDates([
      story({ slug: "ranked", headline, published_on: "2026-09-25" }),
    ]);
    // The first clause stands alone; the second falls back to the headline.
    assert.deepEqual(
      items.map((i) => [i.date, i.what]),
      [
        ["2026-09-26", "Ranked-choice campaign schedules canvassing day"],
        ["2026-10-03", "Ranked-choice campaign schedules Sept. 26 canvassing day and Oct. 3 Brighton event for 3C and 3D"],
      ],
    );
  });

  it('never prints "Applications Close" as a row', () => {
    const headline =
      "Longmont Hiring Director of Power Delivery and Operations; Applications Close Sept. 29";
    const items = collectStoryDates([
      story({ slug: "hiring", headline, published_on: "2026-09-27" }),
    ]);
    // Rule (a) finds "Applications Close" and rule (b) cannot mend it -- two
    // words, no verb the fragment test knows -- so the row takes the headline,
    // which names the 29th and is therefore about the day it is on.
    assert.deepEqual(
      items.map((i) => [i.date, i.what]),
      [["2026-09-29", headline]],
    );
  });
});

/**
 * Unit CN, item 2: a "This week" row that is a sentence cut in half.
 *
 * Owner review of the staged 0.6.80 front page (2026-09-27): the Thu Oct. 1 row
 * read "8 regular meeting is cancelled, while agency funding hearings remain
 * listed for" -- the tail of a longer sentence, stopping on the word "for". Two
 * shapes reach the panel that way, one at each end of the line: a line that
 * opens on a day NUMBER, left there when the punctuation `clauseName` cuts on
 * separates the "Oct." from its own day, and a line that ENDS on a function
 * word, because a sentence does not end on the joint to its next word. Both are
 * checked in `isBareFragment`, and since unit CV, item 2 that test is the last
 * word on every name the three rules produce -- so a day whose only text is a
 * cut sentence goes, rather than being printed under a headline about another
 * day or handed a fragment to print.
 */
describe("a This week row that is a sentence cut in half (unit CN, item 2)", () => {
  const story = (over: Partial<StoryDateSource>): StoryDateSource => ({
    slug: "story",
    section: "council",
    records: [],
    ...over,
  });

  const HOUSING_HEADLINE =
    "Longmont Housing Board Cancels Oct. 8 Regular Meeting; Funding Hearings Still Listed";
  // The exact row the staged 0.6.80 page printed, on its own day (Thu Oct. 1),
  // from the dek below on the story above.
  const STAGED_ROW =
    "8 regular meeting is cancelled, while agency funding hearings remain listed for";

  it("never prints the staged 0.6.80 row, and keeps the day the headline is about", () => {
    const items = collectStoryDates([
      story({
        slug: "housing",
        headline: HOUSING_HEADLINE,
        dek: "The Oct. 8 regular meeting is cancelled, while agency funding hearings remain listed for Oct. 1 and Oct. 15.",
        published_on: "2026-09-27",
      }),
    ]);
    const rows = items.map((i) => [i.date, i.what]);
    assert.equal(
      rows.some(([, what]) => what === STAGED_ROW),
      false,
      "the cut sentence was printed as a row",
    );
    // Two more rows came out of that one sentence before this fix: an Oct. 1 row
    // reading the cut sentence, and an Oct. 15 row reading "1 and" (the tail of
    // "Oct. 1 and" with the month cut off it). Both are gone. The one row left
    // is the day the story is actually about, and since unit CV, item 2 its
    // text is the headline's own clause for that date rather than the headline
    // with the second day's business still on its tail.
    assert.deepEqual(rows, [["2026-10-08", "Longmont Housing Board Cancels Regular Meeting"]]);
  });

  it("drops a day whose clause for it stops on a preposition", () => {
    // The headline is about Oct. 8, so it is no answer for Oct. 22, and the
    // dek's own clause for the 22nd -- "funding hearings remain listed for" --
    // is a sentence cut off at its object, not a line.
    const items = collectStoryDates([
      story({
        slug: "housing-later",
        headline: HOUSING_HEADLINE,
        dek: "The Oct. 8 regular meeting is cancelled; funding hearings remain listed for Oct. 22.",
        published_on: "2026-09-27",
      }),
    ]);
    assert.deepEqual(
      items.map((i) => [i.date, i.what]),
      [["2026-10-08", "Longmont Housing Board Cancels Regular Meeting"]],
      "a clause cut off at a preposition was printed as a row's only text",
    );
  });

  it("falls back to the headline for a line cut off at a conjunction", () => {
    // "Public Hearing Set while" is this story's line for Oct. 12 -- four words,
    // capitalised, no verb the short-line test knows, so only the trailing
    // conjunction tells it apart from a line. The headline names no day, so it
    // is safe for the row and is what the row prints.
    const headline = "Council Sets the Budget Adoption Vote";
    const items = collectStoryDates([
      story({
        slug: "budget-hearing",
        headline,
        dek: "The plan goes to an Oct. 12 Public Hearing Set while, separately, the budget vote follows.",
        published_on: "2026-09-27",
      }),
    ]);
    assert.deepEqual(
      items.map((i) => [i.date, i.what]),
      [["2026-10-12", headline]],
      "a line cut off at a conjunction was printed as the row's text",
    );
  });
});

/**
 * Unit CV, item 2: the five strings the owner review quoted, and the row each
 * one prints now.
 *
 * The review of the staged 0.6.81 front page (2026-09-28) read the "This week"
 * list as phrases lifted out of stories rather than names: "Applications Close",
 * "Brighton event", "funding hearing packet", "instrument collection drive", and
 * the tail of a sentence, "8 regular meeting is cancelled, while agency funding
 * hearings remain listed for". The same extraction feeds "Dates in this story".
 * Each case is written against the story that produced the live row, so the
 * table is the before/after the report prints.
 */
describe("the five strings the review quoted (unit CV, item 2)", () => {
  const story = (over: Partial<StoryDateSource>): StoryDateSource => ({
    slug: "story",
    section: "council",
    records: [],
    ...over,
  });

  const cases: [string, StoryDateSource, [string, string][]][] = [
    [
      "Applications Close",
      story({
        slug: "hiring",
        headline:
          "Longmont Hiring Director of Power Delivery and Operations; Applications Close Sept. 29",
        published_on: "2026-09-27",
      }),
      [
        [
          "2026-09-29",
          "Longmont Hiring Director of Power Delivery and Operations; Applications Close Sept. 29",
        ],
      ],
    ],
    [
      "Brighton event",
      story({
        slug: "ranked",
        headline:
          "Ranked-choice campaign schedules Sept. 26 canvassing day and Oct. 3 Brighton event for 3C and 3D",
        published_on: "2026-09-27",
      }),
      [
        ["2026-09-26", "Ranked-choice campaign schedules canvassing day"],
        ["2026-10-03", "Ranked-choice campaign schedules Sept. 26 canvassing day and Oct. 3 Brighton event for 3C and 3D"],
      ],
    ],
    [
      "funding hearing packet",
      story({
        slug: "packet",
        headline: "Housing And Human Services Board Posts Funding Hearing Packet",
        dek: "The board has posted an Oct. 1 funding hearing packet ahead of the meeting.",
        published_on: "2026-09-27",
      }),
      [["2026-10-01", "The board has posted a funding hearing packet ahead of the meeting"]],
    ],
    [
      "instrument collection drive",
      story({
        slug: "drive",
        headline: "Growing Shade Tree Program Sets Fall Pickup",
        dek: "The Oct. 1-2 instrument collection drive returns to Clark Centennial Park.",
        published_on: "2026-09-27",
      }),
      [["2026-10-01", "The instrument collection drive returns to Clark Centennial Park"]],
    ],
    [
      "8 regular meeting is cancelled, while agency funding hearings remain listed for",
      story({
        slug: "staged",
        headline:
          "Longmont Housing Board Cancels Oct. 8 Regular Meeting; Funding Hearings Still Listed",
        dek: "The Oct. 8 regular meeting is cancelled, while agency funding hearings remain listed for Oct. 1 and Oct. 15.",
        published_on: "2026-09-27",
      }),
      [["2026-10-08", "Longmont Housing Board Cancels Regular Meeting"]],
    ],
  ];

  for (const [quoted, source, expected] of cases) {
    it(`prints a name rather than ${quoted}`, () => {
      const rows = collectStoryDates([source]).map((i) => [i.date, i.what]);
      assert.equal(
        rows.some((row) => row[1] === quoted),
        false,
        `the quoted string was still a whole row: ${quoted}`,
      );
      assert.deepEqual(rows, expected);
    });
  }
});

/**
 * Unit CV, item 3: the time beside the name.
 *
 * The design's example is "Funding hearing: Education agencies, 6 p.m." -- a
 * sentence-case name with the time the story gives on the end. The clock comes
 * out of the clause it was read from, because the row prints it itself.
 */
describe("the time the story gives (unit CV, item 3)", () => {
  const story = (over: Partial<StoryDateSource>): StoryDateSource => ({
    slug: "story",
    section: "council",
    records: [],
    ...over,
  });

  it("prints the clock once, with the name, when it sits by the date", () => {
    const items = collectStoryDates([
      story({
        slug: "agencies",
        headline: "Education Agencies Funding Hearing",
        dek: "The hearing for education agencies is set for Oct. 6 at 6 p.m.",
        published_on: "2026-09-27",
      }),
    ]);
    // Not "…is set for at 6 p, 6 p.m.": the clock's own words are out of the
    // clause before the clause's end is looked for, and the row appends them
    // once.
    assert.deepEqual(
      items.map((i) => [i.date, i.what]),
      [["2026-10-06", "The hearing for education agencies is set, 6 p.m."]],
    );
  });

  it("reads a clock written straight after the date as a time, not a second day", () => {
    const items = collectStoryDates([
      story({
        slug: "agencies2",
        headline: "Education Agencies Funding Hearing Set",
        dek: "Education agencies get their funding hearing Oct. 6, 6 p.m. at the civic center.",
        published_on: "2026-09-27",
      }),
    ]);
    // The list-tail reader would take the clock's hour as the next day of the
    // expression ("Oct. 6 and 6"), which left the row printing the stump "p".
    assert.deepEqual(
      items.map((i) => [i.date, i.what]),
      [["2026-10-06", "Education agencies get their funding hearing, 6 p.m."]],
    );
  });

  it("leaves a clock in another sentence to the event it belongs to", () => {
    const items = collectStoryDates([
      story({
        slug: "agencies3",
        headline: "Education Agencies Funding Hearing",
        dek: "The hearing for education agencies is set for Oct. 6. The doors open at 6 p.m.",
        published_on: "2026-09-27",
      }),
    ]);
    assert.deepEqual(
      items.map((i) => [i.date, i.what]),
      [["2026-10-06", "The hearing for education agencies is set"]],
    );
  });
});

/**
 * Unit CV, item 1: one row per story per day, and one row per event.
 *
 * The review found two entries on Thu Oct. 1 pointing at the same Housing board
 * story. A story's day and a story's event may not be printed twice, and where
 * two rows collide the more specific one stays -- a record the newsroom kept
 * over the story's own words.
 */
describe("one row per event (unit CV, item 1)", () => {
  const story = (over: Partial<StoryDateSource>): StoryDateSource => ({
    slug: "story",
    section: "council",
    records: [],
    ...over,
  });

  it("prints a day once for a story that names it twice", () => {
    const items = collectStoryDates([
      story({
        slug: "both",
        headline: "Council Reviews the Oct. 1 Funding Hearing Packet",
        dek: "The Oct. 1 funding hearing packet goes to the council.",
        published_on: "2026-09-27",
      }),
    ]);
    assert.deepEqual(
      items.map((i) => [i.date, i.what]),
      [["2026-10-01", "Council Reviews the Funding Hearing Packet"]],
    );
  });

  it("keeps the record and drops the story's own words for the same day", () => {
    const items = collectStoryDates([
      story({
        slug: "rec",
        headline: "Council Reviews the Oct. 1 Funding Hearing Packet",
        dek: "The Oct. 1 funding hearing packet goes to the council.",
        records: [
          {
            title: "Funding hearing packet",
            document_date: "2026-10-01",
            organization: "https://example.test/housing",
          },
        ],
        published_on: "2026-09-27",
      }),
    ]);
    assert.deepEqual(
      items.map((i) => [i.date, i.what, i.note]),
      [["2026-10-01", "Funding hearing packet", "example.test"]],
    );
  });

  it("prints an event once for the paper when two stories name it in the same words", () => {
    const items = collectStoryDates([
      story({
        slug: "same-one",
        headline: "Rate Study Heads To Council",
        dek: "The plan goes to the Oct. 6 public hearing and second reading.",
        published_on: "2026-09-27",
      }),
      story({
        slug: "same-two",
        headline: "Council Sets The Rate Study Vote",
        dek: "The plan goes to the Oct. 6 public hearing and second reading.",
        published_on: "2026-09-27",
      }),
    ]);
    assert.deepEqual(
      items.map((i) => [i.date, i.what, i.slug]),
      [["2026-10-06", "The plan goes to the public hearing and second reading", "same-one"]],
    );
  });

  it("prints the Housing story's Oct. 1 once, in its record's words", () => {
    // The review's own duplicate: two Oct. 1 entries out of one Housing board
    // story. The record the newsroom kept is the more specific row for the day.
    const items = collectStoryDates([
      story({
        slug: "week-housing-cv",
        headline: "Housing And Human Services Board Posts Funding Hearing Packet",
        dek: "The board has posted an Oct. 1 funding hearing packet ahead of the meeting.",
        records: [
          {
            title: "Oct. 1 Funding Hearing Packet",
            document_date: "2026-10-01",
            organization: "Housing and Human Services Advisory Board",
          },
        ],
        published_on: "2026-09-27",
      }),
    ]);
    assert.deepEqual(
      items.map((i) => [i.date, i.what, i.note]),
      [
        [
          "2026-10-01",
          "Oct. 1 Funding Hearing Packet",
          "Housing and Human Services Advisory Board",
        ],
      ],
    );
  });
});
