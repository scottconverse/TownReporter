import { it } from "node:test";
import assert from "node:assert/strict";
import { cleanMissingFactNotes, stripReaderNotebook, stripReporterNotebook, stripYearNotes } from "./strip-draft.ts";
import { publicArticle } from "./public.ts";

it("moves the Pace Street schedule-year note out of the reader summary and leaves news copy intact", () => {
  const headline = "Pace Street asphalt plan calls for delays and intersection closures";
  const paceDek =
    "Longmont anticipates milling delays and two to three days of paving impacts near 9th and Mountain View avenues. The notice does not state the schedule year.";
  const note = "The notice does not state the schedule year.";
  const cleaned = cleanMissingFactNotes(`${headline}. ${note}`, paceDek);

  assert.equal(cleaned.headline, headline);
  assert.equal(
    cleaned.dek,
    "Longmont anticipates milling delays and two to three days of paving impacts near 9th and Mountain View avenues.",
  );
  assert.deepEqual(cleaned.notes, [note]);

  const printed = publicArticle({
    id: 1,
    slug: "pace-street",
    headline: `${headline}. ${note}`,
    dek: paceDek,
    body: "Crews will mill asphalt before paving near 9th and Mountain View avenues.",
    topic: "transportation",
    source_urls: "[]",
    status: "published",
    published_at: "2026-10-10T12:00:00Z",
  });
  assert.equal(printed.headline, headline);
  assert.equal(printed.dek, cleaned.dek);
  assert.deepEqual(cleanMissingFactNotes("", "The schedule year is unstated.").notes, [
    "The schedule year is unstated.",
  ]);

  const realNewsDeks = [
    "Longmont crews will mill Pace Street before paving near 9th and Mountain View avenues.",
    "Council's 5-2 vote sends the library plan to a public hearing next month.",
    "A two-week closure will reroute Route 324 while crews replace the downtown signal.",
  ];
  for (const dek of realNewsDeks) {
    assert.equal(cleanMissingFactNotes("Local project moves ahead", dek).dek, dek);
  }

  const body = "The city did not say when work starts.";
  assert.equal(stripReporterNotebook(body), body);
  assert.deepEqual(cleanMissingFactNotes("", body).notes, [body]);
});

// Scott, Oct 11 2026: no AI story tells readers a source "does not specify the year".
const fridaBody =
  "The Longmont Museum lists a screening of “Frida” for Thursday, Oct. 15, followed by a conversation with director Carla Gutiérrez and filmmaker MG Evangelista. The [event listing](https://longmontcolorado.gov/event/sundance-film-festival-frida-2024-r/) does not specify the year; the Times-Call’s Oct. 10, 2026, article describes the screening as taking place the following Thursday.\n\nTickets are free.";

it("drops the missing-year clause from the Frida story body and keeps the rest", () => {
  const out = stripReporterNotebook(fridaBody);
  assert.doesNotMatch(out, /specify the year/i);
  assert.match(out, /^The Longmont Museum lists a screening/);
  assert.match(out, /The Times-Call’s Oct\. 10, 2026, article describes the screening as taking place the following Thursday\./);
  assert.match(out, /\n\nTickets are free\.$/);
});

it("drops whole missing-year sentences and tail clauses in any wording", () => {
  const oct = new Date(2026, 9, 12);
  assert.equal(stripYearNotes("Paving starts Oct. 20. The notice does not state the schedule year.", oct), "Paving starts Oct. 20.");
  assert.equal(stripYearNotes("The year is not specified in the flyer. Doors open at 6 p.m.", oct), "Doors open at 6 p.m.");
  assert.equal(
    stripYearNotes("Comment closes Oct. 29 at the RTD office, though the page does not say which year.", oct),
    "Comment closes Oct. 29 at the RTD office.",
  );
  assert.equal(stripYearNotes("The council did not state a reason for the delay.", oct), "The council did not state a reason for the delay.");
});

it("keeps a year note at the turn of the year: a December story about a January date", () => {
  const body = "The listing gives Jan. 8 for the hearing but does not state the year; the city calendar puts it in 2027.";
  assert.equal(stripYearNotes(body, new Date(2026, 11, 20)), body);
  assert.doesNotMatch(stripYearNotes(body, new Date(2026, 9, 12)), /does not state the year/);
});

// Scott, Oct 16 2026 (TPT-3): the Test public page printed "The pages show month and day
// without a year." Same rule: the sentence goes, and the paragraph's other sentences stay.
const womensCircleBody =
  "Women's Recovery Circle meets weekly at Recovery Café Longmont for peer support. The pages show month and day without a year. Doors open at 6 p.m.";

it("drops 'The pages show month and day without a year.' from the public story body and keeps the other sentences", () => {
  assert.equal(
    stripReaderNotebook(womensCircleBody),
    "Women's Recovery Circle meets weekly at Recovery Café Longmont for peer support. Doors open at 6 p.m.",
  );
});

it("leaves that sentence in the desk and writer text, so what they save does not change", () => {
  assert.equal(stripReporterNotebook(womensCircleBody), womensCircleBody);
});

it("drops the other missing-year wordings a story can print", () => {
  const oct = new Date(2026, 9, 16);
  const wordings = [
    "The flyer lists Thursday, Oct. 16 without the year.",
    "The sign-up page gives the month and day with no year attached.",
    "The calendar shows only the month and day.",
    "Dates are listed as month and day only.",
    "The year is not shown on the flyer.",
    "The notice names the month and day but no year is printed.",
  ];
  for (const sentence of wordings) {
    assert.equal(stripReaderNotebook(`${sentence} Doors open at 6 p.m.`, oct), "Doors open at 6 p.m.", sentence);
  }
});

it("keeps a missing-year wording at the turn of the year when the date is January or February", () => {
  const janBody = "The listing shows Jan. 8 without a year. Doors open at 6 p.m.";
  const febBody = "The calendar shows only the month and day: Feb. 3. Doors open at 6 p.m.";
  assert.equal(stripReaderNotebook(janBody, new Date(2026, 11, 20)), janBody);
  assert.equal(stripReaderNotebook(febBody, new Date(2026, 11, 20)), febBody);
  assert.equal(stripReaderNotebook(janBody, new Date(2026, 9, 16)), "Doors open at 6 p.m.");
  assert.equal(stripReaderNotebook(febBody, new Date(2026, 9, 16)), "Doors open at 6 p.m.");
});

it("keeps sentences that only mention a year, a school year, a fiscal year, or a month and day", () => {
  const oct = new Date(2026, 9, 16);
  const keep = [
    "The program runs year-round at the library.",
    "The pool is open year-round, but the schedule is not listed online.",
    "Attendance rose from last year.",
    "The city adopted its fiscal year 2027 budget on Tuesday.",
    "Classes start Aug. 18, the first day of the school year.",
    "The farm had a year without rain, so crews are replanting.",
    "The crew had worked there without a year of training.",
    "The program with no years of experience is open to all.",
    "The council will review the year-end report next month.",
    "The year-end report is unclear on the parking budget.",
    "The ordinance lists the month and day of each holiday.",
  ];
  for (const sentence of keep) {
    assert.equal(stripReaderNotebook(sentence, oct), sentence);
  }
});
