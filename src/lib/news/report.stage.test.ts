import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  REPORT_EDIT_SYSTEM,
  REPORT_RESEARCH_SYSTEM,
  REPORT_WRITE_SYSTEM,
  reportAndDraft,
  type ReportChat,
} from "./report.ts";
import type { LeadRow } from "./types.ts";

const SOURCE = "https://longmontcolorado.gov/news/council-update.html";
const lead: LeadRow = {
  id: 42,
  headline: "Council approves the Main Street repair contract",
  why: "The vote sets the project schedule.",
  topic: "government",
  status: "new",
  source_urls: JSON.stringify([SOURCE]),
  evidence: "",
  newsworthiness: 10,
  created_at: new Date().toISOString(),
};

const researchJson = JSON.stringify({
  news: "Council approved the repair contract.",
  why_it_matters: "Work will affect Main Street.",
  angle: "contract approval",
  form: "brief",
  questions: [],
  fetch_urls: [],
  unknowns: [],
  follow: "",
  lanes: { context: [], stakeholders: [], contradiction: [], gaps: [] },
});

const draftJson = JSON.stringify({
  headline: "Council approves Main Street repair contract",
  dek: "The vote sets the project schedule.",
  body: "Longmont City Council approved the Main Street repair contract, according to the city's council update.",
  topic: "government",
  source_urls: [SOURCE],
  form: "brief",
  found: null,
  unanswered: [],
  claims: [{ fact: "Council approved the contract", url: SOURCE, kind: "primary" }],
  reporting_trail: [{ title: "Council update", organization: "City of Longmont", url: SOURCE, role: "primary" }],
});

const baseDeps = {
  ingest: async (url: string) => ({
    url,
    title: "Council update",
    text: "Longmont City Council approved the Main Street repair contract.",
    extras: [],
  }),
  search: async () => [],
  capture: async () => ({ version_id: 1, capture_event_id: 1 }),
  hydrate: async () => [],
  budgetMs: 120_000,
};

describe("reportAndDraft progress stages", { timeout: 30_000 }, () => {
  it("emits the validated writer checkpoint before an evidence edit can fail", async () => {
    const order: string[] = [];
    const checkpoints: Array<Record<string, unknown>> = [];
    const chat: ReportChat = async (system) => {
      if (system === REPORT_RESEARCH_SYSTEM) return { ok: true, text: researchJson };
      if (system === REPORT_WRITE_SYSTEM) { order.push("writer"); return { ok: true, text: JSON.stringify({...JSON.parse(draftJson),found:[{text:"Bound finding",source_urls:[SOURCE],artifact_version_ids:[999],capture_event_ids:[998]},{text:"Invented finding",source_urls:["https://invented.example/claim"],artifact_version_ids:[997],capture_event_ids:[996]}],claims:[{fact:"Bound claim",url:SOURCE,kind:"primary"},{fact:"Invented claim",url:"https://invented.example/claim",kind:"news"}]}) }; }
      if (system === REPORT_EDIT_SYSTEM) { order.push("edit"); return { ok: false, error: "Mock edit failure" }; }
      return { ok: false, error: "Unexpected model call" };
    };
    const result = await reportAndDraft(
      { userId: "checkpoint-stage", lead, urls: [SOURCE], memory: [] },
      { ...baseDeps, chat, onWriterDraft: async checkpoint => { order.push("checkpoint"); checkpoints.push(checkpoint as unknown as Record<string,unknown>); } },
    );
    assert.ok(!("error" in result));
    assert.deepEqual(order.slice(0,3), ["writer","checkpoint","edit"]);
    assert.equal(checkpoints.length,1);
    assert.equal(checkpoints[0].body, "Longmont City Council approved the Main Street repair contract, according to the city's council update.");
    assert.deepEqual(checkpoints[0].captures, [{url:SOURCE,title:"Council update",version_id:1,capture_event_id:1}]);
    assert.deepEqual(checkpoints[0].found,[{text:"Bound finding",source_urls:[SOURCE],capture_event_ids:[1],artifact_version_ids:[1],locators:[],excerpt:undefined}]);
    assert.deepEqual(checkpoints[0].claims,[{fact:"Bound claim",url:SOURCE,kind:"primary"}]);
  });

  it("reports the truthful phase sequence for success and retains the drafting phase on failure", async () => {
    const expected = [
      "Opening source material",
      "Looking for primary sources",
      "Planning the reporting",
      "Writing the draft",
      "Checking the draft against the evidence",
      "Checking people's names against written sources",
    ];
    const successStages: string[] = [];
    const successChat: ReportChat = async (system) => {
      if (system === REPORT_RESEARCH_SYSTEM) return { ok: true, text: researchJson };
      if (system === REPORT_WRITE_SYSTEM) return { ok: true, text: draftJson };
      if (system === REPORT_EDIT_SYSTEM) return { ok: true, text: draftJson };
      return { ok: false, error: "Unexpected model call" };
    };
    const success = await reportAndDraft(
      { userId: "stage-success", lead, urls: [SOURCE], memory: [] },
      { ...baseDeps, chat: successChat, onStage: async (stage) => successStages.push(stage) },
    );
    assert.ok(!("error" in success), "mocked normal pipeline should succeed");
    assert.deepEqual(successStages, expected);

    const failureStages: string[] = [];
    const failureChat: ReportChat = async (system) => {
      if (system === REPORT_RESEARCH_SYSTEM) return { ok: true, text: researchJson };
      if (system === REPORT_WRITE_SYSTEM) return { ok: false, error: "Mock drafting failure" };
      return { ok: false, error: "Unexpected model call" };
    };
    const failure = await reportAndDraft(
      { userId: "stage-failure", lead, urls: [SOURCE], memory: [] },
      { ...baseDeps, chat: failureChat, onStage: async (stage) => failureStages.push(stage) },
    );
    assert.deepEqual(failure, { error: "Mock drafting failure" });
    assert.equal(failureStages.at(-1), "Writing the draft");
    assert.deepEqual(failureStages, expected.slice(0, 4));
  });
});
