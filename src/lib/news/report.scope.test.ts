import { it } from "node:test";
import assert from "node:assert/strict";
import { reportAndDraft, REPORT_RESEARCH_SYSTEM, type FetchedDoc } from "./report.ts";
import type { LeadRow } from "./types.ts";
import { runAbsenceGate } from "./absence-gate.ts";
import { draftSourceInputs } from "./draft-input.ts";
import { parseNotes } from "./notes.ts";
import { parseWriteStoryInput } from "./write-story.ts";

const lead: LeadRow = { id: 1, headline: "Library hours change on Tuesday", why: "Editor's supplied notice", topic: "community", status: "new", source_urls: "[]", evidence: "", newsworthiness: 1, created_at: "2026-09-07" };
const alien = "https://vendor.example/news/test-automation-press-release";
const supplied = "https://library.example/hours";
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
