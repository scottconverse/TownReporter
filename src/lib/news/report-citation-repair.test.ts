import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CITATION_REPAIR_SYSTEM,
  REPORT_EDIT_SYSTEM,
  REPORT_RESEARCH_SYSTEM,
  REPORT_WRITE_SYSTEM,
  reportAndDraft,
  type ReportChat,
} from "./report.ts";
import { NAME_EVIDENCE_SYSTEM, NAME_INVENTORY_SYSTEM } from "./name-check-work.ts";
import type { LeadRow } from "./types.ts";

const SOURCE = "https://testville.gov/budget/2027-message.pdf";
const body = "Testville proposed a $5 million operating budget for 2027.";
const written = {
  headline: "Testville proposes a $5 million operating budget",
  dek: "The proposal covers the 2027 fiscal year.",
  body,
  topic: "budget",
  source_urls: [],
  integrity_notes: "",
  memory_entities: [],
  form: "brief",
  found: null,
  unanswered: [],
  claims: [],
  document_claims: [],
  reporting_trail: [],
};

describe("report citation repair", { timeout: 15_000 }, () => {
  it("repairs a factual draft whose writer omitted every source and claim", async () => {
    let repairCalls = 0;
    const chat: ReportChat = async (system) => {
      if (system === REPORT_RESEARCH_SYSTEM || system.includes("doing the RESEARCH pass")) return { ok: true, text: JSON.stringify({
        news: body, why_it_matters: "Residents fund it.", angle: "annual budget", form: "brief",
        questions: [], fetch_urls: [], unknowns: [], follow: "",
        lanes: { context: [], stakeholders: [], contradiction: [], gaps: [] },
      }) };
      if (system === REPORT_WRITE_SYSTEM || system.includes("AFTER a research pass") || system === REPORT_EDIT_SYSTEM)
        return { ok: true, text: JSON.stringify(written) };
      if (system === CITATION_REPAIR_SYSTEM) {
        repairCalls += 1;
        return { ok: true, text: JSON.stringify({ receipts: [{
          fact: body,
          url: SOURCE,
          excerpt: "The proposed 2027 operating budget totals $5 million.",
          kind: "primary",
        }] }) };
      }
      if (system === NAME_INVENTORY_SYSTEM)
        return { ok: true, text: JSON.stringify({ complete: true, people: [] }) };
      return { ok: true, text: "{}" };
    };
    const lead: LeadRow = {
      id: 71, headline: written.headline, why: written.dek, topic: "budget", status: "new",
      source_urls: JSON.stringify([SOURCE]), evidence: "", newsworthiness: 10,
      created_at: new Date().toISOString(),
    };
    const result = await reportAndDraft(
      { userId: "citation-repair", newsroomId: 1, lead, urls: [SOURCE], memory: [] },
      {
        paper: async () => ({ name: "Testville Record", city: "Testville", state: "Colorado", officialDomains: ["testville.gov"] }),
        budgetMs: 100_000,
        ingest: async (url) => ({
          url, title: "2027 budget message",
          text: "The proposed 2027 operating budget totals $5 million.", extras: [],
        }),
        search: async () => [],
        chat,
        capture: async () => ({ version_id: 8, capture_event_id: 18 }),
        hydrate: async (_user, urls) => urls.map((url) => ({ url, version_id: 8, capture_event_id: 18, captured_at: "2026-09-14T00:00:00Z", disappeared: false })),
      },
    );
    assert.ok(!("error" in result), "error" in result ? result.error : "");
    if ("error" in result) return;
    assert.equal(repairCalls, 1);
    assert.deepEqual(result.source_urls, [SOURCE]);
    assert.deepEqual(result.claims, [{ fact: body, url: SOURCE, kind: "primary" }]);
    assert.doesNotMatch(result.integrity_notes, /could not connect this draft's factual claims/i);
  });

  it("keeps the story but requires review when the repair cannot prove a citation", async () => {
    const chat: ReportChat = async (system) => {
      if (system === REPORT_RESEARCH_SYSTEM || system.includes("doing the RESEARCH pass")) return { ok: true, text: JSON.stringify({
        news: body, why_it_matters: "Residents fund it.", angle: "annual budget", form: "brief",
        questions: [], fetch_urls: [], unknowns: [], follow: "",
        lanes: { context: [], stakeholders: [], contradiction: [], gaps: [] },
      }) };
      if (system === REPORT_WRITE_SYSTEM || system.includes("AFTER a research pass") || system === REPORT_EDIT_SYSTEM)
        return { ok: true, text: JSON.stringify(written) };
      if (system === CITATION_REPAIR_SYSTEM) return { ok: true, text: JSON.stringify({ receipts: [{
        fact: body,
        url: SOURCE,
        excerpt: "An invented source passage that was never captured.",
        kind: "primary",
      }] }) };
      if (system === NAME_INVENTORY_SYSTEM)
        return { ok: true, text: JSON.stringify({ complete: true, people: [] }) };
      return { ok: true, text: "{}" };
    };
    const lead: LeadRow = {
      id: 72, headline: written.headline, why: written.dek, topic: "budget", status: "new",
      source_urls: JSON.stringify([SOURCE]), evidence: "", newsworthiness: 10,
      created_at: new Date().toISOString(),
    };
    const result = await reportAndDraft(
      { userId: "citation-repair-failure", newsroomId: 1, lead, urls: [SOURCE], memory: [] },
      {
        paper: async () => ({ name: "Testville Record", city: "Testville", state: "Colorado", officialDomains: ["testville.gov"] }),
        budgetMs: 100_000,
        ingest: async (url) => ({
          url, title: "2027 budget message",
          text: "The proposed 2027 operating budget totals $5 million.", extras: [],
        }),
        search: async () => [],
        chat,
        capture: async () => ({ version_id: 8, capture_event_id: 18 }),
        hydrate: async () => [],
      },
    );
    assert.ok(!("error" in result), "error" in result ? result.error : "");
    if ("error" in result) return;
    assert.equal(result.body, body);
    assert.deepEqual(result.source_urls, []);
    assert.deepEqual(result.claims, []);
    assert.equal(result.citation_status, "review-required");
    assert.match(result.integrity_notes, /could not connect this draft's factual claims/i);
  });

  it("does not keep a repaired citation after name verification changes its claimed sentence", async () => {
    const citationSource = "https://testville-news.example/budget-notes";
    const nameSource = "https://testville.gov/city-manager/presentation-record";
    const misspelledFact = "Harold Dominquez presented the proposed budget Monday.";
    const stableFact = "The proposal totals $5 million for 2027.";
    const draftWithMisspelling = {
      ...written,
      headline: "Testville receives the proposed budget",
      dek: "The city manager's office presented the plan Monday.",
      body: `${misspelledFact} ${stableFact}`,
    };
    const chat: ReportChat = async (system) => {
      if (system === REPORT_RESEARCH_SYSTEM || system.includes("doing the RESEARCH pass")) return { ok: true, text: JSON.stringify({
        news: misspelledFact, why_it_matters: "Residents fund it.", angle: "annual budget", form: "brief",
        questions: [], fetch_urls: [], unknowns: [], follow: "",
        lanes: { context: [], stakeholders: [], contradiction: [], gaps: [] },
      }) };
      if (system === REPORT_WRITE_SYSTEM || system.includes("AFTER a research pass") || system === REPORT_EDIT_SYSTEM)
        return { ok: true, text: JSON.stringify(draftWithMisspelling) };
      if (system === CITATION_REPAIR_SYSTEM) return { ok: true, text: JSON.stringify({ receipts: [{
        fact: misspelledFact,
        url: citationSource,
        excerpt: misspelledFact,
        kind: "news",
      }, {
        fact: stableFact,
        url: citationSource,
        excerpt: stableFact,
        kind: "news",
      }] }) };
      if (system === NAME_INVENTORY_SYSTEM) return { ok: true, text: JSON.stringify({
        complete: true,
        people: [{ name: "Harold Dominquez", role: "City Manager's Office, Testville", context: misspelledFact }],
      }) };
      if (system.startsWith(NAME_EVIDENCE_SYSTEM)) return { ok: true, text: JSON.stringify({ checks: [{
        name: "Harold Dominquez",
        status: "corrected",
        spelling: "Harold Dominguez",
        url: nameSource,
        documentId: "",
        excerpt: "PRESENTED BY: Harold Dominguez, City Manager's Office, Testville.",
        reason: "The official presentation record identifies the same city manager's office presenter.",
        authority: "official-record",
        samePerson: true,
      }] }) };
      return { ok: true, text: "{}" };
    };
    const lead: LeadRow = {
      id: 73, headline: draftWithMisspelling.headline, why: draftWithMisspelling.dek, topic: "budget", status: "new",
      source_urls: JSON.stringify([citationSource, nameSource]), evidence: "", newsworthiness: 10,
      created_at: new Date().toISOString(),
    };
    const result = await reportAndDraft(
      { userId: "citation-repair-name-correction", newsroomId: 1, lead, urls: [citationSource, nameSource], memory: [] },
      {
        paper: async () => ({ name: "Testville Record", city: "Testville", state: "Colorado", officialDomains: ["testville.gov"] }),
        budgetMs: 100_000,
        ingest: async (url) => url === citationSource
          ? { url, title: "Budget notes", text: `${misspelledFact} ${stableFact}`, extras: [] }
          : { url, title: "Official presentation record", text: "PRESENTED BY: Harold Dominguez, City Manager's Office, Testville.", extras: [] },
        search: async () => [],
        chat,
        capture: async (url) => url === citationSource
          ? { version_id: 81, capture_event_id: 181 }
          : { version_id: 82, capture_event_id: 182 },
        hydrate: async () => [],
      },
    );
    assert.ok(!("error" in result), "error" in result ? result.error : "");
    if ("error" in result) return;
    assert.equal(result.body, `Harold Dominguez presented the proposed budget Monday. ${stableFact}`);
    assert.equal(result.citation_status, "review-required");
    assert.deepEqual(result.source_urls, [citationSource]);
    assert.deepEqual(result.claims, [{ fact: stableFact, url: citationSource, kind: "news" }]);
    assert.match(result.integrity_notes, /could not connect this draft's factual claims/i);
    assert.deepEqual(result.research_memo.nameCheck.rows.map((row) => [row.name, row.status, row.spelling]), [
      ["Harold Dominquez", "corrected", "Harold Dominguez"],
    ]);
  });
});
