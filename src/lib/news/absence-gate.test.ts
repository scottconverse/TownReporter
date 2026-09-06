import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  absenceClaims,
  askQueries,
  documentAsks,
  findAbsenceEvidence,
  findOnCityDomain,
  namedDocument,
  notYetOpened,
  officialDomains,
  pressDomains,
  runAbsenceGate,
  splitSentences,
  synonymVariation,
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

/*
  The absence ladder (0.6.23): "don't make extra work for the editor making
  them check something you can check first." Before this, a claim of absence
  ran ONE site:<domain> search; a miss handed the editor a checkbox the app
  could often have cleared itself. These tests exercise the ladder in
  isolation (findAbsenceEvidence) before the full gate tests below check it
  wired into runAbsenceGate.
*/
describe("the absence ladder exhausts every rung before giving up", () => {
  const DOMAIN_B = "otherville.gov";
  const PRESS = "longmontleader.com";

  it("runs one query per official domain, in order, and stops at the first hit", async () => {
    const calls: string[] = [];
    const search = async (q: string) => {
      calls.push(q);
      if (q.startsWith(`site:${DOMAIN_B}`)) return [{ url: `https://${DOMAIN_B}/survey` }];
      return [];
    };
    const found = await findAbsenceEvidence("survey page", [DOMAIN, DOMAIN_B], CITY, [], search);
    assert.equal(found.url, `https://${DOMAIN_B}/survey`);
    assert.equal(calls.length, 2, "the ladder should stop at the domain that hit, not run every rung");
    assert.deepEqual(
      found.steps.map((s) => s.hit),
      [false, true],
    );
  });

  it("widens past site: to an unrestricted city query when no official domain has it", async () => {
    const calls: string[] = [];
    const search = async (q: string) => {
      calls.push(q);
      if (!q.includes("site:") && q.includes(CITY)) return [{ url: SURVEY_URL }];
      return [];
    };
    const found = await findAbsenceEvidence("survey page", [DOMAIN], CITY, [], search);
    assert.equal(found.url, SURVEY_URL);
    assert.equal(calls.length, 2, "one site: miss, then the unrestricted rung that hit");
    assert.doesNotMatch(calls[1]!, /site:/);
  });

  it("tries a synonym variation before giving up", async () => {
    const calls: string[] = [];
    const search = async (q: string) => {
      calls.push(q);
      // Only the packet-swapped query finds anything -- the plain "agenda"
      // query and the site: rungs come back empty.
      if (/\bpacket\b/i.test(q)) return [{ url: `https://${DOMAIN}/packet` }];
      return [];
    };
    const found = await findAbsenceEvidence("council agenda item", [DOMAIN], CITY, [], search);
    assert.equal(found.url, `https://${DOMAIN}/packet`);
    assert.equal(calls.length, 3, "site: miss, unrestricted miss, then the synonym rung that hit");
  });

  it("tries one local-press-tier query as the last rung, only when the paper has press domains", async () => {
    const calls: string[] = [];
    const search = async (q: string) => {
      calls.push(q);
      if (q.includes(`site:${PRESS}`)) return [{ url: `https://${PRESS}/survey-story` }];
      return [];
    };
    const found = await findAbsenceEvidence("survey page", [DOMAIN], CITY, [PRESS], search);
    assert.equal(found.url, `https://${PRESS}/survey-story`);
    assert.equal(calls.length, 4, "site:, unrestricted, synonym, then the press rung that hit");
    assert.match(calls[3]!, new RegExp(`site:${PRESS.replace(/\./g, "\\.")}`));
  });

  it("skips the press rung entirely when the paper has no press-tier domains", async () => {
    const calls: string[] = [];
    const search = async (q: string) => {
      calls.push(q);
      return [];
    };
    const found = await findAbsenceEvidence("survey page", [DOMAIN], CITY, [], search);
    assert.equal(found.url, null);
    assert.equal(calls.length, 3, "no press domains configured, so no fourth rung is ever queried");
  });

  it("comes back empty, with every rung it tried on the record, when nothing anywhere hits", async () => {
    const found = await findAbsenceEvidence("survey page", [DOMAIN, DOMAIN_B], CITY, [PRESS], async () => []);
    assert.equal(found.url, null);
    assert.equal(found.steps.length, 5, "2 domains + unrestricted + synonym + press = 5 rungs");
    assert.ok(found.steps.every((s) => s.hit === false));
  });

  it("swaps the document word for the next synonym, deterministically", () => {
    assert.match(synonymVariation("council agenda item"), /\bpacket\b/i);
    assert.doesNotMatch(synonymVariation("council agenda item"), /\bagenda\b/i);
    // No document word at all -- the ladder still tries something.
    assert.match(synonymVariation("customer satisfaction survey"), /\bagenda\b/i);
  });

  it("derives press-tier hosts from the watch list's Tier B entries, same as the Dark Desk engine", () => {
    const hosts = pressDomains([
      { url: `https://www.${PRESS}/local-news`, tier: "B" },
      { url: SURVEY_URL, tier: "A" },
      { url: "not a url", tier: "B" },
    ]);
    assert.deepEqual(hosts, [PRESS]);
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

  it("finds evidence further down the ladder (not just the first site: query) and redrafts once, no checkbox", async () => {
    // The site:domain query misses; only the unrestricted city query hits.
    // Before the ladder, this claim would have gone straight to the editor.
    const search = async (q: string) =>
      !q.includes("site:") && q.includes(CITY) ? [{ url: SURVEY_URL, title: "Survey" }] : [];
    const out = await runAbsenceGate({ ...base, search, redraftAllowed: true });
    assert.equal(out.needsRedraft, true);
    assert.deepEqual(out.foundUrls, [SURVEY_URL]);
    const entry = out.gate.find((g) => g.kind === "absence");
    assert.ok(entry);
    assert.equal(entry.needsCheck, undefined, "a redrafted claim must not also raise an editor checkbox");
    assert.ok(entry.steps && entry.steps.length >= 2, "the miss before the hit should be on the record");
    assert.equal(entry.steps![0]!.hit, false);
    assert.equal(entry.steps![entry.steps!.length - 1]!.hit, true);
  });

  it("records every rung of the ladder and writes the honest 'searched N more ways' summary when it all comes up empty", async () => {
    const out = await runAbsenceGate({ ...base, search: searchFindingNothing, redraftAllowed: false });
    const entry = absenceClaims(out.gate)[0];
    assert.ok(entry);
    // base has one official domain and no press domains: site:, unrestricted,
    // synonym = 3 rungs, so the summary should say "2 more ways".
    assert.equal(entry!.steps?.length, 3);
    assert.ok(entry!.steps!.every((s) => s.hit === false));
    assert.equal(
      entry!.summary,
      `TownReporter searched ${DOMAIN} and 2 more ways and found nothing. Confirm you checked ` +
        `yourself before this prints.`,
    );
  });

  it("counts a local-press-tier rung into the summary when the paper has one configured", async () => {
    const PRESS = "longmontleader.com";
    const out = await runAbsenceGate({
      ...base,
      pressDomains: [PRESS],
      search: searchFindingNothing,
      redraftAllowed: false,
    });
    const entry = absenceClaims(out.gate)[0];
    assert.ok(entry);
    // site:, unrestricted, synonym, press = 4 rungs -> "3 more ways".
    assert.equal(entry!.steps?.length, 4);
    assert.match(entry!.summary ?? "", /and 3 more ways and found nothing/);
  });
});

/*
  The 2026-09-05 incident sentence must still be caught, and the four
  sentences it could be confused with -- a document that WAS opened, saying
  what it does not cover -- must never be. Named as fixtures rather than
  buried in a regex test so a future change to WORLD_ABSENCE has to look at
  this exact list.
*/
describe("the absence trigger tells 'nobody looked' from 'I read it and it doesn't say'", () => {
  const MUST_NOT_FLAG = [
    "What the announcing release does not say is which hydrants go offline",
    "The packet does not list the vendor",
    "The minutes are silent on the vote count",
    "The agenda gives no start time",
  ];

  for (const sentence of MUST_NOT_FLAG) {
    it(`does not flag: "${sentence}"`, () => {
      assert.equal(WORLD_ABSENCE.test(sentence), false);
    });
  }

  it("still flags the live incident sentence", () => {
    assert.equal(WORLD_ABSENCE.test(FALSE_SENTENCE), true);
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

  it("round-trips the ladder's exact queries through notes storage (0.6.23)", () => {
    const packed = JSON.stringify({
      todo: [
        {
          t: `Claim of absence: ${FALSE_SENTENCE}`,
          done: false,
          src: "gate",
          q: "TownReporter searched longmontcolorado.gov and 2 more ways and found nothing. Confirm you checked yourself before this prints.",
          queries: [
            { query: "site:longmontcolorado.gov survey", hit: false },
            { query: "survey Longmont", hit: false },
            { query: "packet Longmont", hit: false },
          ],
        },
      ],
    });
    const notes = parseNotes(packed);
    assert.equal(notes.todo[0]!.queries?.length, 3);
    assert.deepEqual(
      notes.todo[0]!.queries!.map((q) => q.query),
      ["site:longmontcolorado.gov survey", "survey Longmont", "packet Longmont"],
    );
    assert.ok(notes.todo[0]!.queries!.every((q) => q.hit === false));
  });
});
