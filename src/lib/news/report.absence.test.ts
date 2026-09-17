import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  reportAndDraft,
  reportResearchSystem,
  reportWriteSystem,
  type FetchedDoc,
  type ReportChat,
} from "./report.ts";
import type { LeadRow } from "./types.ts";

/*
  The 2026-09-05 story, run through the pipeline.

  Everything here is what actually happened, with the network mocked out: the
  research pass narrating its own missing tools into `unknowns`, a memo whose
  `follow` names the exact document nobody searched for, a body asserting that
  the document does not exist, and a city that was advertising it on its home
  page the whole time.
*/
const PAPER = {
  name: "TownReporter",
  city: "Longmont",
  state: "Colorado",
  officialDomains: ["longmontcolorado.gov"],
};

const SEED = "https://longmontcolorado.gov/news/";
const SURVEY =
  "https://longmontcolorado.gov/government/explore-longmonts-data-resources/customer-satisfaction-survey/";
const COMPARISON = "https://www.rochestermn.gov/citizen-survey";

const RESEARCH_BLOCKED =
  "RESEARCH BLOCKED: WebSearch and WebFetch permissions were not granted this session, so no Longmont primary document was retrieved.";
const FOLLOW =
  "Chase the city's own survey landing page and any press release announcing the launch.";
const FALSE_SENTENCE =
  "No city survey page, launch release or council agenda item confirming any of that was obtained for this piece.";

const DOCS: Record<string, FetchedDoc> = {
  [SEED]: {
    url: SEED,
    title: "City news",
    text: "City of Longmont news. Council approved a recycling ordinance amendment on Tuesday.",
    extras: [],
    notices: ["Take the 2026 Community Satisfaction Survey. Open through September 7."],
  },
  [SURVEY]: {
    url: SURVEY,
    title: "Customer Satisfaction Survey",
    text: "The 2026 Community Satisfaction Survey is open through September 7. Results are an input to the city's budget process.",
    extras: [],
    notices: [],
  },
  [COMPARISON]: {
    url: COMPARISON,
    title: "Rochester citizen survey",
    text: "Rochester runs an annual citizen survey.",
    extras: [],
    notices: [],
  },
};

const lead: LeadRow = {
  id: 1,
  headline: "City's 2026 community satisfaction survey closes Sept. 7",
  why: "An input to budget season",
  topic: "budget",
  status: "new",
  source_urls: JSON.stringify([SEED]),
  evidence: "",
  newsworthiness: 11,
  created_at: new Date().toISOString(),
};

const RESEARCH = JSON.stringify({
  news: "The city's 2026 community satisfaction survey closes Sept. 7.",
  why_it_matters: "It feeds budget season.",
  angle: "survey deadline",
  form: "brief",
  questions: [],
  fetch_urls: [],
  unknowns: [RESEARCH_BLOCKED],
  follow: FOLLOW,
  lanes: { context: [], stakeholders: [], contradiction: [], gaps: [] },
});

function draftJson(body: string) {
  return JSON.stringify({
    headline: "City's 2026 community satisfaction survey closes Sept. 7",
    dek: "An input to budget season.",
    body,
    topic: "budget",
    source_urls: [SEED],
    integrity_notes: "Web fetch/search were unavailable this session.",
    memory_entities: ["community satisfaction survey"],
    form: "brief",
    unanswered: [RESEARCH_BLOCKED],
    claims: [],
    reporting_trail: [],
  });
}

const FALSE_BODY = [
  "The city says its 2026 community satisfaction survey closes Sept. 7.",
  `${FALSE_SENTENCE} Readers should treat the Sept. 7 date as unverified.`,
  "Rochester and Richmond run comparable surveys, and both publish a landing page.",
  "Labor Day fell on Sept. 7 in some years, which may explain the date.",
].join("\n\n");

const HONEST_BODY = [
  "The city's 2026 community satisfaction survey is open through September 7, according to the city's own survey page.",
  "The city says results feed its budget process.",
  "Longmont publishes the survey at its customer-satisfaction-survey page.",
].join("\n\n");

type Run = {
  writes: string[];
  queries: string[];
  stages: string[];
  result: Awaited<ReturnType<typeof reportAndDraft>>;
};

/*
  `finds` decides which query the mocked city site answers, which is how the
  two halves of the fix are told apart: the pull the memo asked for (a query
  naming the landing page) and the gate's own check on the sentence in the
  body (a query naming the survey page it says was never obtained).
*/
async function run(finds: (query: string) => boolean): Promise<Run> {
  const writes: string[] = [];
  const queries: string[] = [];
  const stages: string[] = [];

  const chat: ReportChat = async (system, user) => {
    if (system === reportResearchSystem(PAPER)) return { ok: true, text: RESEARCH };
    if (system === reportWriteSystem(PAPER)) {
      writes.push(user);
      // The first draft is the story that shipped. A redraft, with the survey
      // page in evidence, is the story that should have.
      return { ok: true, text: draftJson(writes.length === 1 ? FALSE_BODY : HONEST_BODY) };
    }
    return { ok: true, text: "{}" };
  };

  const result = await reportAndDraft(
    { userId: "absence-test", lead, urls: [SEED], memory: [] },
    {
      paper: async () => PAPER,
      budgetMs: 120_000,
      ingest: async (url) => DOCS[url] ?? { url, title: url, text: "", extras: [], notices: [] },
      capture: async () => ({ version_id: null, capture_event_id: null }),
      hydrate: async () => [],
      onStage: (stage) => {
        stages.push(stage);
      },
      search: async (query) => {
        queries.push(query);
        if (finds(query)) return [{ title: "Customer Satisfaction Survey", url: SURVEY }];
        return [{ title: "Rochester citizen survey", url: COMPARISON }];
      },
      chat,
    },
  );
  return { writes, queries, stages, result };
}

const onCityDomain = (query: string) => /^site:longmontcolorado\.gov /i.test(query);
/** Answers the memo's ask for the landing page. */
const answersTheMemoAsk = (query: string) => onCityDomain(query) && /landing/i.test(query);
/** Answers the gate's check on "no city survey page ... was obtained". */
const answersTheGateCheck = (query: string) => onCityDomain(query) && !/landing/i.test(query);
const answersNothing = () => false;

describe("the draft pipeline cannot argue from an absence it never checked", { timeout: 30000 }, () => {
  it("chases the memo's own ask on the paper's city domain and puts the document in evidence", async () => {
    const { writes, queries, result } = await run(answersTheMemoAsk);
    assert.ok(!("error" in result), "error" in result ? result.error : "");
    if ("error" in result) return;

    // The query that never ran on 2026-09-05.
    const siteQueries = queries.filter(onCityDomain);
    assert.ok(siteQueries.length > 0, `no site: query ran; queries were ${queries.join(" | ")}`);
    assert.ok(siteQueries.some((q) => /survey/i.test(q)));

    const pulls = result.research_memo.pulls ?? [];
    assert.ok(pulls.some((p) => p.url === SURVEY && p.fetched === "ok"));
    assert.ok(pulls.every((p) => p.query.length > 0), "every pull records the query it ran");

    // The pulled document reaches the model under its own heading, with the
    // ask it answers, ahead of the comparison cities.
    assert.match(writes[0]!, /PRIMARY DOCUMENTS PULLED FOR THE MEMO'S ASKS/);
    assert.match(writes[0]!, /for: Chase the city's own survey landing page/);

    // The banner readability strips reached it too.
    assert.match(writes[0]!, /SITE NOTICES ON longmontcolorado\.gov/);
    assert.match(writes[0]!, /Open through September 7/);
  });

  it("redrafts once when the gate finds the page the story said nobody had", async () => {
    const { writes, stages, result } = await run(answersTheGateCheck);
    assert.ok(!("error" in result), "error" in result ? result.error : "");
    if ("error" in result) return;

    assert.equal(writes.length, 2, "exactly one redraft");
    assert.ok(
      stages.some((s) => s === `absence check found ${SURVEY}, redrafting`),
      `stages were ${stages.join(" | ")}`,
    );
    const gate = result.research_memo.gate ?? [];
    assert.ok(gate.some((g) => g.kind === "absence" && g.url === SURVEY));
    assert.doesNotMatch(result.body, /was obtained for this piece/);
    assert.doesNotMatch(result.body, /\bunverified\b/);
    // The redraft was written with the found document in evidence.
    assert.match(writes[1]!, /customer-satisfaction-survey/);
  });

  it("keeps tool-talk out of the story and out of the notes", async () => {
    const { result } = await run(answersTheGateCheck);
    if ("error" in result) return;
    assert.doesNotMatch(result.body, /WebSearch|WebFetch|permission|this session/i);
    assert.doesNotMatch(result.integrity_notes, /unavailable this session/i);
    assert.match(result.integrity_notes, /has not yet opened/);
    assert.equal(
      result.unanswered.some((u) => /RESEARCH BLOCKED|WebSearch|permission/i.test(u)),
      false,
    );
    const gate = result.research_memo.gate ?? [];
    assert.ok(gate.some((g) => g.kind === "tool-talk"));
  });

  it("rewrites the claim honestly and raises a check when the city really has nothing", async () => {
    const { writes, result } = await run(answersNothing);
    assert.ok(!("error" in result), "error" in result ? result.error : "");
    if ("error" in result) return;

    assert.equal(writes.length, 1, "nothing found means nothing to redraft from");
    assert.doesNotMatch(result.body, /was obtained for this piece/);
    assert.match(result.body, /did not find .* among the documents it opened/);
    assert.match(result.integrity_notes, /VERIFY BEFORE PRINT/);

    const gate = result.research_memo.gate ?? [];
    const claims = gate.filter((g) => g.kind === "absence" && g.needsCheck);
    assert.ok(claims.length > 0, "an unconfirmed claim of absence must be raised");
    assert.match(claims[0]!.query ?? "", /longmontcolorado\.gov|Longmont/);

    const pulls = result.research_memo.pulls ?? [];
    assert.ok(
      pulls.some((p) => p.url === null && p.fetched === "none"),
      "a search that found nothing is recorded as a search that found nothing",
    );
  });
});
