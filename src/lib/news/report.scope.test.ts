import { it } from "node:test";
import assert from "node:assert/strict";
import { reportAndDraft, REPORT_RESEARCH_SYSTEM, REPORT_WRITE_SYSTEM, REPORT_EDIT_SYSTEM, linkOutletInBody, type FetchedDoc } from "./report.ts";
import type { LeadRow } from "./types.ts";
import { runAbsenceGate } from "./absence-gate.ts";
import { draftSourceInputs } from "./draft-input.ts";
import { parseNotes } from "./notes.ts";
import { parseWriteStoryInput } from "./write-story.ts";

const lead: LeadRow = { id: 1, headline: "Library hours change on Tuesday", why: "Editor's supplied notice", topic: "community", status: "new", source_urls: "[]", evidence: "", newsworthiness: 1, created_at: "2026-09-07" };
const alien = "https://vendor.example/news/test-automation-press-release";
const supplied = "https://library.example/hours";
it("does not turn an organization mention into an unrelated same-host citation", () => {
  const job = "https://longmontcolorado.gov/news/city-job-openings-2026/";
  const project = "https://longmontcolorado.gov/news/park-cooling-project/";
  const body = "The City of Longmont supported the project.";
  assert.equal(linkOutletInBody(body, [job, project]), body);
  const explicit = `The [City of Longmont](${project}) supported the project.`;
  assert.equal(linkOutletInBody(explicit, [job, project]), explicit);
});
it("distinguishes synthesis from unsupported comparisons, date roles and inverted safety advice", () => {
  for (const prompt of [REPORT_RESEARCH_SYSTEM, REPORT_WRITE_SYSTEM, REPORT_EDIT_SYSTEM]) {
    assert.match(prompt, /unsupported contrasts.*rankings.*counts/i);
    assert.match(prompt, /publication date.*event date.*capture date/i);
    assert.match(prompt, /direction.*safety advice/i);
  }
  assert.doesNotMatch(REPORT_EDIT_SYSTEM, /evidence or the draft/i);
});
for (const outcome of ["success", "refusal", "unreadable", "exception"]) {
  it(`reconciles an ordinary draft against URL-labeled evidence and retains it on ${outcome}`, async () => {
    const log = { searches: [] as string[], fetched: [] as string[], packets: [] as string[] };
    const deps = dependencies(log);
    let editCalls = 0;
    deps.chat = async (system, user) => {
      if (system.includes('"fetch_urls"')) return {ok:true, text:JSON.stringify({form:"brief",news:lead.headline})};
      if (system === REPORT_EDIT_SYSTEM) {
        editCalls++;
        assert.match(user, /CLAIMS TO RECONCILE/);
        assert.ok(user.includes(supplied));
        assert.match(user, /library opens at noon Tuesday/i);
        if (outcome === "refusal") return {ok:false, error:"test edit unavailable"};
        if (outcome === "exception") throw new Error("test edit timed out");
        if (outcome === "unreadable") return {ok:true, text:"not a draft"};
        return {ok:true, text:JSON.stringify({headline:lead.headline,body:"The library opens at noon Tuesday, according to its notice.",topic:lead.topic,source_urls:[supplied]})};
      }
      return {ok:true,text:JSON.stringify({headline:lead.headline,body:"The notice lists new library hours for residents this week.",topic:lead.topic,source_urls:[supplied],claims:[{fact:"Library opens at noon Tuesday.",url:supplied,kind:"primary"}]})};
    };
    const result = await reportAndDraft({userId:"reconcile",lead,urls:[supplied],memory:[],researchScope:"supplied",modelChoice:"claude-frontier"},deps);
    assert.equal(editCalls,1);
    assert.ok(!("error" in result));
    if (!("error" in result)) {
      if (outcome === "success") assert.match(result.body,/opens at noon Tuesday/);
      else {
        assert.match(result.body,/notice lists new library hours/);
        assert.match(result.integrity_notes,/Evidence reconciliation not completed/);
      }
    }
  });
}
it("keeps a useful draft honestly unchecked when no editing budget remains", async () => {
  const log = { searches: [] as string[], fetched: [] as string[], packets: [] as string[] };
  const deps = dependencies(log);
  let edits = 0;
  deps.chat = async (system) => {
    if (system === REPORT_EDIT_SYSTEM) edits++;
    return {ok:true,text:JSON.stringify(system.includes('"fetch_urls"') ? {news:lead.headline,form:"brief"} : {headline:lead.headline,body:"The library notice lists new opening hours for local residents.",source_urls:[],topic:lead.topic})};
  };
  const result = await reportAndDraft({userId:"budget",lead,urls:[supplied],memory:[],researchScope:"supplied",modelChoice:"claude-frontier"},{...deps,budgetMs:9500});
  assert.equal(edits,0);
  assert.ok(!("error" in result));
  if (!("error" in result)) {
    assert.match(result.body,/library notice/);
    assert.match(result.integrity_notes,/Evidence reconciliation not completed/);
    assert.deepEqual(result.source_urls,[],"opened documents are not implicitly cited");
    assert.ok(result.research_memo.captured.some(doc => doc.url === supplied));
  }
});
for (const clear of [true, false]) {
  it(`honors an editor's ${clear ? "explicit empty citation list" : "omitted citation field"}`, async () => {
    const deps = dependencies({searches:[],fetched:[],packets:[]});
    deps.chat = async (system) => {
      if (system.includes('"fetch_urls"')) return {ok:true,text:JSON.stringify({form:"brief",news:lead.headline})};
      const draft = {headline:lead.headline,body:"The library notice describes opening hours for residents this week.",topic:lead.topic};
      return {ok:true,text:JSON.stringify(system === REPORT_EDIT_SYSTEM ? {...draft,...(clear ? {source_urls:[]} : {})} : {...draft,source_urls:[supplied]})};
    };
    const result = await reportAndDraft({userId:"edit-citations",lead,urls:[supplied],memory:[],researchScope:"supplied",modelChoice:"claude-frontier"},deps);
    assert.ok(!("error" in result));
    if (!("error" in result)) {
      assert.match(result.body,/library notice/);
      assert.deepEqual(result.source_urls,clear ? [] : [supplied]);
    }
  });
}
it("honors an explicit short assignment over the research angle and carries dating constraints through editing", async () => {
  const assignmentText = "Write a short local item about upcoming library programs.";
  const parsedInput = parseWriteStoryInput(assignmentText);
  assert.ok(parsedInput.ok);
  if (!parsedInput.ok) return;
  const log = { searches: [] as string[], fetched: [] as string[], packets: [] as string[] };
  const deps = dependencies(log);
  const passes: { system: string; user: string }[] = [];
  const longBody = Array.from({length: 400}, (_, i) => `word${i}`).join(" ");
  deps.chat = async (system, user) => {
    passes.push({ system, user });
    return { ok: true, text: JSON.stringify(system.includes('"fetch_urls"')
      ? { news: "Fundraising promotion", angle: "Membership prices", form: "reported", unknowns: ["Donation match year unknown; banner may be stale"] }
      : { headline: lead.headline, dek: "Programs", body: passes.length === 2 ? longBody : "The library has upcoming programs, according to its events page.", topic: "community", source_urls: [supplied], form: "reported", unanswered: [] }) };
  };
  const result = await reportAndDraft({ userId: "assignment", lead, urls: [supplied], memory: [], editorialAssignment: parsedInput.value.editorialAssignment, extraEvidence: "Donation match ends December 31 (year missing)", modelChoice: "claude-frontier" }, deps);
  assert.ok(!("error" in result));
  assert.equal(passes.length, 3, "overlong brief must receive one bounded shortening pass");
  for (const pass of passes) {
    assert.ok(pass.user.includes(assignmentText), "assignment survives research, writing and edit");
    assert.match(pass.user, /REPORT AS OF: \d{4}-\d{2}-\d{2}/);
    assert.match(pass.user, /undated|year.*unknown/i);
  }
  assert.match(passes[1].user, /SUGGESTED FORM: brief/);
  assert.ok(passes[1].user.includes("Donation match year unknown"));
  if (!("error" in result)) assert.equal(result.form, "brief");
});
it("keeps a useful overlong draft with an honest form and visible length warning after one edit", async () => {
  const log = { searches: [] as string[], fetched: [] as string[], packets: [] as string[] };
  const deps = dependencies(log);
  let calls = 0;
  deps.chat = async (system) => {
    calls++;
    return { ok: true, text: JSON.stringify(system.includes('"fetch_urls"')
      ? { news: lead.headline, form: "reported" }
      : { headline: lead.headline, body: Array.from({length: 400}, (_, i) => `word${i}`).join(" "), topic: "community", source_urls: [supplied], form: "reported" }) };
  };
  const result = await reportAndDraft({ userId: "assignment", lead, urls: [supplied], memory: [], editorialAssignment: { origin: "write-box", text: "Write a brief about library programs.", requestedForm: "brief" }, modelChoice: "claude-frontier" }, deps);
  assert.ok(!("error" in result));
  if (!("error" in result)) {
    assert.equal(result.body.split(/\s+/).length, 400);
    assert.match(result.integrity_notes, /Requested brief not met \(400 words\)/);
    assert.equal(result.form, "reported");
  }
  assert.equal(calls, 3);
});
function dependencies(log: { searches: string[]; fetched: string[]; packets: string[] }) {
  return {
    paper: async () => ({ name: "TownReporter", city: "Longmont", state: "Colorado", officialDomains: [] }),
    search: async (q: string) => { log.searches.push(q); return [{ url: alien, title: "Test automation vendor raises money" }]; },
    ingest: async (url: string): Promise<FetchedDoc> => { log.fetched.push(url); return { url, title: url === supplied ? "Library hours" : "Test automation vendor", text: url === supplied ? "The library opens at noon Tuesday." : "Unrelated TestMu product press release for automated software testing.", extras: [alien] }; },
    capture: async () => ({ version_id: 1, capture_event_id: 1 }), hydrate: async () => [],
    chat: async (system: string, user: string) => {
      log.packets.push(user);
      return { ok: true as const, text: JSON.stringify(system === REPORT_RESEARCH_SYSTEM || system.includes('"fetch_urls"')
        ? { news: lead.headline, form: "brief", fetch_urls: [alien], follow: "Find library schedule" }
        : { headline: lead.headline, dek: "Hours change", body: "The library opens at noon Tuesday, according to the supplied notice.", topic: "community", source_urls: [supplied, alien], found: [], unanswered: [] }) };
    },
  };
}
it("supplied-only never searches, follows discoveries, or credits an invented URL", async () => {
  const log = { searches: [] as string[], fetched: [] as string[], packets: [] as string[] };
  const sources = draftSourceInputs([alien], parseNotes(JSON.stringify({suppliedUrls:[supplied],opened:[{url:alien,title:"Prior automatic discovery"}]})), "supplied");
  const result = await reportAndDraft({ userId: "scope", lead, ...sources, memory: [], extraEvidence: "The library opens at noon Tuesday.", researchScope: "supplied", modelChoice: "claude-frontier" }, dependencies(log));
  assert.ok(!("error" in result));
  assert.deepEqual(log.searches, []);
  assert.deepEqual(log.fetched, [supplied]);
  if (!("error" in result)) assert.deepEqual(result.source_urls, [supplied]);
});
it("research rejects unrelated press-release content before it reaches the writing packet", async () => {
  const log = { searches: [] as string[], fetched: [] as string[], packets: [] as string[] };
  await reportAndDraft({ userId: "scope", lead, urls: [supplied], memory: [], modelChoice: "claude-frontier" }, dependencies(log));
  assert.ok(log.searches.length > 0);
  assert.ok(log.packets.every(p => !p.includes("Unrelated TestMu product")));
});
it("supplied-material absence claims require human review without pretending to search", async () => {
  let searched = false;
  const out = await runAbsenceGate({ headline: "Council review", dek: "", body: "The city does not publish a survey page.", integrity_notes: "", unanswered: [], openedTitles: ["Supplied notice"], knownUrls: [], domains: ["longmontcolorado.gov"], city: "Longmont", searchAllowed: false, redraftAllowed: true, search: async () => { searched = true; return []; } });
  assert.equal(searched, false);
  assert.ok(out.gate.some(g => g.needsCheck));
  assert.match(out.integrity_notes, /not checked externally/);
  assert.doesNotMatch(JSON.stringify(out.gate), /TownReporter searched/);
});
