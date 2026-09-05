import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  absenceClaims,
  askQueries,
  documentAsks,
  findOnCityDomain,
  namedDocument,
  notYetOpened,
  officialDomains,
  runAbsenceGate,
  splitSentences,
  TOOL_TALK,
  WORLD_ABSENCE,
} from "./absence-gate.ts";
import { extractSiteNotices } from "./article-extract.ts";
import { keepHumanTodos, parseNotes, toggleTodo, uncheckedGateTodos } from "./notes.ts";

/*
  The fixture is the incident, verbatim.

  2026-09-05: the desk drafted "City's 2026 community satisfaction survey -- an
  input to budget season -- closes Sept. 7" and told readers no city survey
  page, launch release or agenda item confirming it had been obtained, and that
  the deadline was unverified. The city had a survey landing page, a home-page
  banner, three dated news items and a short link, and a plain web search
  returned the page as a top hit. Nothing about the story was true except the
  date it doubted.
*/
const CITY = "Longmont";
const DOMAIN = "longmontcolorado.gov";
const SURVEY_URL = `https://${DOMAIN}/government/explore-longmonts-data-resources/customer-satisfaction-survey/`;
const BANNER =
  "Take the 2026 Community Satisfaction Survey. Open through September 7.";

const RESEARCH_BLOCKED =
  "RESEARCH BLOCKED: WebSearch and WebFetch permissions were not granted this session, so no Longmont primary document was retrieved for the survey page.";
const FOLLOW =
  "Chase the city's own survey landing page and any press release announcing the launch.";
const FALSE_SENTENCE =
  "No city survey page, launch release or council agenda item confirming any of that was obtained for this piece.";

const OPENED = ["Rochester citizen survey", "Richmond satisfaction survey", "Recycling ordinance"];

function searchFinding(): (q: string) => Promise<{ url: string; title: string }[]> {
  return async (query: string) => {
    if (/site:longmontcolorado\.gov/i.test(query) && /survey/i.test(query)) {
      return [{ url: SURVEY_URL, title: "Customer Satisfaction Survey" }];
    }
    return [{ url: "https://www.rochestermn.gov/survey", title: "Rochester survey" }];
  };
}

const searchFindingNothing = async () => [
  { url: "https://www.rochestermn.gov/survey", title: "Rochester survey" },
];

describe("tool-talk never describes the city", () => {
  it("catches the exact sentence the live research pass wrote", () => {
    assert.equal(TOOL_TALK.test(RESEARCH_BLOCKED), true);
    assert.equal(TOOL_TALK.test("Web fetch/search were unavailable this session."), true);
    assert.equal(
      TOOL_TALK.test("The council packet lists the contract at $2.4 million."),
      false,
      "ordinary reporting must not be mistaken for tool-talk",
    );
  });

  it("rewrites a blocked-research note into what the paper has not yet opened", () => {
    const line = notYetOpened(RESEARCH_BLOCKED, "TownReporter");
    assert.match(line, /^TownReporter has not yet opened /);
    assert.doesNotMatch(line, /permission|session|WebSearch|WebFetch/i);
  });

  it("names the paper it runs in, not the reference paper", () => {
    assert.match(notYetOpened(RESEARCH_BLOCKED, "Ashgrove Gazette"), /^Ashgrove Gazette/);
  });

  it("splits sentences without losing a character", () => {
    const text = "One thing happened. Then another!\n\nA third?";
    assert.equal(splitSentences(text).join(""), text);
  });
});

describe("the memo's document asks become site-restricted queries", () => {
  it("reads the ask the live memo actually wrote, and skips lines that name no document", () => {
    const asks = documentAsks([FOLLOW, "Call the city manager back."]);
    assert.equal(asks.length, 1);
    assert.match(asks[0]!, /survey landing page/i);
  });

  it("builds a site: query on the paper's own city domain", () => {
    const queries = askQueries(FOLLOW, [DOMAIN], CITY);
    assert.equal(queries[0]!.startsWith(`site:${DOMAIN} `), true);
    assert.match(queries[0]!, /survey/);
    assert.match(queries[queries.length - 1]!, /^Longmont /);
  });

  it("derives the city's domains and refuses a comparison city's", () => {
    const domains = officialDomains(CITY, [
      SURVEY_URL,
      "https://www.longmontleader.com/local-news/story-123",
      "https://en.wikipedia.org/wiki/Customer_satisfaction",
    ]);
    assert.deepEqual(domains, [DOMAIN]);
    assert.equal(officialDomains(CITY, ["https://en.wikipedia.org/wiki/x"]).length, 0);
  });

  it("takes the city-domain hit, never the comparison city", async () => {
    const found = await findOnCityDomain(FOLLOW, [DOMAIN], CITY, searchFinding());
    assert.equal(found.url, SURVEY_URL);
    assert.match(found.query, /^site:longmontcolorado\.gov /);
  });
});

describe("the claims-of-absence gate", () => {
  const base = {
    headline: "City's 2026 community satisfaction survey closes Sept. 7",
    dek: "An input to budget season.",
    body: `The city says its 2026 community satisfaction survey closes Sept. 7.\n\n${FALSE_SENTENCE} Readers should treat the Sept. 7 date as unverified.`,
    integrity_notes: "Web fetch/search were unavailable this session.",
    unanswered: [RESEARCH_BLOCKED],
    openedTitles: OPENED,
    knownUrls: ["https://www.rochestermn.gov/survey"],
    domains: [DOMAIN],
    city: CITY,
    paperName: "TownReporter",
  };

  it("recognises the live sentence as a claim of absence", () => {
    assert.equal(WORLD_ABSENCE.test(FALSE_SENTENCE), true);
    assert.equal(WORLD_ABSENCE.test("Readers should treat the Sept. 7 date as unverified."), true);
    assert.equal(WORLD_ABSENCE.test("The city does not publish a survey page."), true);
  });

  it("leaves a reporter saying what an opened document omits", () => {
    /*
      The first build of the regex rewrote this exact sentence -- it is in
      report.pipeline.test.ts and the suite caught it. Saying what a document
      you HAVE READ leaves out is the opposite of arguing from an absence you
      never checked, and a gate that eats it makes the paper worse.
    */
    assert.equal(
      WORLD_ABSENCE.test("What the announcing release does not say is which hydrants go offline."),
      false,
    );
    assert.equal(
      WORLD_ABSENCE.test("The packet does not show a cost for the third phase."),
      false,
    );
  });

  it("strips tool-talk from the story and rewrites it in the notes", async () => {
    const out = await runAbsenceGate({
      ...base,
      search: searchFindingNothing,
      redraftAllowed: false,
    });
    assert.doesNotMatch(out.integrity_notes, /unavailable this session/i);
    assert.match(out.integrity_notes, /has not yet opened/);
    assert.equal(out.unanswered.some((u) => /WebSearch|permission/i.test(u)), false);
    assert.match(out.unanswered[0]!, /has not yet opened/);
  });

  it("finds the survey page the story said nobody had, and asks for a redraft", async () => {
    const out = await runAbsenceGate({ ...base, search: searchFinding(), redraftAllowed: true });
    assert.equal(out.needsRedraft, true);
    assert.deepEqual(out.foundUrls, [SURVEY_URL]);
    const entry = out.gate.find((g) => g.kind === "absence");
    assert.ok(entry);
    assert.match(entry.action, /absence check found .*, redrafting/);
    assert.match(entry.query ?? "", /^site:longmontcolorado\.gov /);
  });

  it("rewrites the sentence honestly when the city really has nothing, and raises a check", async () => {
    const out = await runAbsenceGate({
      ...base,
      search: searchFindingNothing,
      redraftAllowed: false,
    });
    assert.equal(out.needsRedraft, false);
    assert.doesNotMatch(out.body, /was obtained for this piece/);
    assert.match(out.body, /TownReporter did not find .* among the documents it opened: /);
    assert.match(out.body, /Rochester citizen survey/);
    assert.match(out.integrity_notes, /VERIFY BEFORE PRINT/);
    assert.match(out.integrity_notes, new RegExp(DOMAIN.replace(/\./g, "\\.")));
    assert.equal(absenceClaims(out.gate).length > 0, true);
    for (const claim of absenceClaims(out.gate)) assert.equal(claim.needsCheck, true);
  });

  it("cannot ask for a second redraft", async () => {
    const out = await runAbsenceGate({ ...base, search: searchFinding(), redraftAllowed: false });
    assert.equal(out.needsRedraft, false);
    assert.match(out.body, /did not find/);
  });

  it("names the document in the sentence rather than inventing one", () => {
    assert.match(String(namedDocument(FALSE_SENTENCE)), /survey page/i);
    assert.equal(namedDocument("Nothing here at all."), null);
  });
});

describe("site notices survive the article extractor", () => {
  it("keeps the banner readability throws away", () => {
    const html = `<!doctype html><html><body>
      <nav><a href="/">Home</a></nav>
      <div class="alert-banner">${BANNER}</div>
      <main><article><p>${"The city council met on Tuesday to discuss the budget. ".repeat(12)}</p></article></main>
      </body></html>`;
    const notices = extractSiteNotices(html);
    assert.equal(
      notices.some((n) => n.includes("2026 Community Satisfaction Survey")),
      true,
      "the banner sentence must reach evidence",
    );
    assert.equal(
      notices.some((n) => n.includes("Open through September 7")),
      true,
    );
  });
});

describe("gate claims live in the reporting notes as checkboxes", () => {
  it("round-trips a gate to-do and keeps it through a redraft until it is ticked", () => {
    const packed = JSON.stringify({
      todo: [
        {
          t: `Claim of absence: ${FALSE_SENTENCE}`,
          done: false,
          src: "gate",
          q: "Searched: site:longmontcolorado.gov survey page",
        },
        { t: "Call the city clerk", done: false, src: "you" },
        { t: "Prior year survey results", done: false, src: "machine" },
      ],
    });
    const notes = parseNotes(packed);
    assert.equal(notes.todo[0]!.src, "gate");
    assert.match(String(notes.todo[0]!.q), /^Searched: site:longmontcolorado\.gov/);
    assert.equal(uncheckedGateTodos(notes).length, 1);
    // A redraft keeps the reporter's own lines and any unconfirmed claim.
    assert.deepEqual(
      keepHumanTodos(notes).map((t) => t.src),
      ["gate", "you"],
    );
    const ticked = toggleTodo(notes, 0);
    assert.equal(uncheckedGateTodos(ticked).length, 0);
    assert.deepEqual(
      keepHumanTodos(ticked).map((t) => t.src),
      ["you"],
    );
  });
});
