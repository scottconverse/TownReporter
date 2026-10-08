import assert from "node:assert/strict";
import { it } from "node:test";
import { bindStoryClaimsToEvidence, writingPass, type DocumentRead } from "./civic-reporting-run.server.ts";

const url = "https://city.example/council-communication-9-29-26.pdf";
const text = [
  "GENERAL FUND",
  "Ongoing Budget Adjustments",
  "Preliminary property tax certifications came in $511,000 lower than anticipated. The General Fund needs to reflect a $511,000 decrease in property tax revenue.",
  "Since Human Services Agencies funding is based on 3% of budgeted tax revenue, the decrease results in a $15,330 reduction, bringing the proposed line to $2,947,545.",
  "One- Time Budget Adjustments",
  "The proposed General Fund budget includes a one-time transfer of $672,625 to the Public Improvement Fund for costs associated with the 1st and Main Transit Hub. These funds are needed in 2026 and are being removed from the proposed 2027 budget.",
  "PUBLIC IMPROVEMENT FUND",
  "The above $672,625 transfer from the General Fund also needs to be removed as revenue from the Public Improvement Fund. In addition, the 2027 proposed budget included $1,646,233 set aside for CIP project TRP131, 1st and Main Transit Station Area Improvements. These funds are needed in 2026 and are being removed from the proposed 2027 budget.",
].join("\n");
const memo: DocumentRead = { url, title: "Council Communication 9-29-26", ok: true, text, reason: "", pages: [{ page: 3, text, layoutText: text }] };
const assignment = "Write a 400–800 word story explaining what the Sept. 29 proposed budget changes mean for residents.";
const correction = {
  id: 182, origin: "reporting", kind: "correction",
  text: "The scoped correction says the $672,625 transfer belongs under One-Time Budget Adjustments; retain its documented transfer role and 2026 proposal status.",
  evidence: url + " — p. 3, One- Time Budget Adjustments",
  observedOn: null, createdAt: "2026-10-06T06:00:00.000Z",
  scope: ["lead", "parent-request"], observedBy: null, reversalOf: null,
};
const reconcile = { actions: [], contradictions: [], warmOnly: [], coldOnly: [], voteMismatches: [], matched: 0 };
const record = { windows: [], segments: [], votes: [], gaps: [], identity: { videoId: "", videoUrl: "" } };
const firstParagraph = "The proposed General Fund budget includes a one-time transfer to the Public Improvement Fund for 1st and Main Transit Hub costs, moved from 2027 to 2026.";
const withinRangeDraft = `${firstParagraph} ${Array(500 - firstParagraph.split(/\s+/).length).fill("Residents").join(" ")}`;
const validDek = "The proposed General Fund budget moves a one-time Public Improvement Fund transfer for 1st and Main Transit Hub costs from the 2027 proposal into 2026.";

function writerPackage(transferLocator: string) {
  return {
    stories: [{
      id: "story-1", headline: "What the budget proposal changes", draft: withinRangeDraft,
      dek: validDek,
      plainBrief: "The proposal remains pending.",
      cannotSay: "The memo does not establish the relationship between the transfer and project set-aside.",
      readinessTier: 2,
      claims: [
        {
          id: "transfer-claim", item: "One- Time Budget Adjustments",
          text: "The proposed General Fund budget included a one-time $672,625 transfer to the Public Improvement Fund for 1st and Main Transit Hub costs, removed from the 2027 proposal because the funds were needed in 2026.",
          status: "VERIFIED", sourceIds: ["transfer-source"], nextCheck: "",
        },
        {
          id: "hsa-claim", item: "Human Services Agencies funding",
          text: "The proposed Human Services Agencies funding reduction was $511,000.",
          status: "VERIFIED", sourceIds: ["ongoing-source"], nextCheck: "",
        },
      ],
      sources: [
        { id: "transfer-source", title: "Council Communication 9-29-26", tier: "A", url, locator: transferLocator, offlineReference: "" },
        { id: "ongoing-source", title: "Council Communication 9-29-26", tier: "A", url, locator: "p. 3, Ongoing Budget Adjustments", offlineReference: "" },
      ],
    }],
    held: [],
  };
}

it("makes one citation revision for an in-range draft, preserves scoped evidence, and keeps unresolved claims held", async () => {
  let calls = 0;
  let revisionPrompt = "";
  const first = writerPackage("p. 3, Ongoing Budget Adjustments");
  const corrected = writerPackage("p. 3, One- Time Budget Adjustments");
  const result = await writingPass({
    record: record as never,
    documents: [memo],
    further: { findings: "", documents: [memo], gaps: [] },
    gather: { findings: "", observations: [correction] } as never,
    warm: { actions: [], windows: [], gaps: [] } as never,
    cold: { actions: [], roster: [], votes: [], gaps: [] } as never,
    reconcile: reconcile as never,
    contrary: { contrary: [], unknowns: [], gaps: [], raw: { ok: true, error: "", text: "", chars: 0, truncated: false } },
    scoring: { score: null, readiness: 0, why: "", gaps: [] },
    assignment, action: "Develop this lead", city: "Longmont",
    method: { text: "fixture method", version: "2.6.0" } as never,
    chatOpts: {}, workspaceDir: "", throwIfCancelled: async () => {},
    chat: (async (_system: string, prompt: string) => {
      calls += 1;
      if (calls === 1) {
        assert.equal(first.stories[0]!.draft.split(/\s+/).length, 500);
        return { ok: true as const, text: JSON.stringify(first) };
      }
      revisionPrompt = prompt;
      return { ok: true as const, text: JSON.stringify(corrected) };
    }) as never,
  });

  assert.equal(calls, 2, "one citation revision follows the original writer call");
  assert.equal(result.stories.length, 1);
  assert.equal(result.stories[0]!.draft.split(/\s+/).length, 500);
  assert.match(revisionPrompt, /EDITORIAL LENGTH REVISION AND CITATION REPAIR — one bounded attempt/);
  assert.match(revisionPrompt, /CITATION CHECKS ON THE PREVIOUS PACKAGE/);
  assert.match(revisionPrompt, /transfer-claim/);
  assert.ok(revisionPrompt.includes(assignment), "the original editor assignment survives into the retry");
  assert.ok(revisionPrompt.includes('"observationId":182'), "the scoped correction identity survives into the retry");
  assert.match(revisionPrompt, /One- Time Budget Adjustments/);
  assert.match(revisionPrompt, /2026 proposal status/);
  assert.doesNotMatch(revisionPrompt, /Story 1 has 500 words/i, "the in-range draft did not trigger length repair");

  const transfer = result.stories[0]!.claims!.find((claim) => claim.id === "transfer-claim")!;
  const transferSource = result.stories[0]!.sources!.find((source) => transfer.sourceIds!.includes(source.id))!;
  assert.equal(transferSource.locator, "p. 3, One- Time Budget Adjustments");

  const rebound = bindStoryClaimsToEvidence(result.stories[0] as never, reconcile as never, record as never, [memo]);
  const transferAfterBinding = rebound.claims!.find((claim) => claim.id === "transfer-claim")!;
  const hsaAfterBinding = rebound.claims!.find((claim) => claim.id === "hsa-claim")!;
  assert.equal(transferAfterBinding.status, "VERIFIED", transferAfterBinding.nextCheck);
  assert.equal(hsaAfterBinding.status, "UNVERIFIED", "the unsupported $511,000 HSA assertion is not bulk-upgraded");
  assert.match(hsaAfterBinding.nextCheck, /not near the claim's named item/i);
  const boundTransferSource = rebound.sources!.find((source) => transferAfterBinding.sourceIds!.includes(source.id))!;
  assert.match(boundTransferSource.locator, /One- Time Budget Adjustments/);
});
it("rebuilds a truncated S39 source reply from read records and stops after one failed recovery", async () => {
  const truncated = '{"stories":[{"id":"old-story","headline":"Budget changes","draft":"partial","claims":[{"id":"old-C1","sourceIds":["S39"]}],"sources":[{"id":"S39","url":"https://city.example/council-communication-9-29-26.p';
  assert.ok(truncated.length < 2_000, "the fixture is a short mid-URL truncation, not a hundred-claim package");

  const complete = {
    stories: [{
      id: "recovered-story",
      headline: "The proposed transfer moves into 2026",
      draft: withinRangeDraft,
      dek: validDek,
      plainBrief: "The 2027 proposal removes a one-time transfer needed in 2026.",
      cannotSay: "The memo does not establish the relationship between this transfer and the separate project set-aside.",
      readinessTier: 2,
      claims: [{
        id: "recovered-transfer",
        item: "One- Time Budget Adjustments",
        text: "The proposed General Fund budget includes a one-time $672,625 transfer to the Public Improvement Fund for the 1st and Main Transit Hub, removed from 2027 because the funds are needed in 2026.",
        status: "VERIFIED",
        sourceIds: ["S1"],
        nextCheck: "",
      }],
      sources: [{
        id: "S1", title: "Council Communication 9-29-26", tier: "A", url,
        locator: "p. 3, One- Time Budget Adjustments", offlineReference: "",
      }],
    }],
    held: [],
  };

  async function run(recoveryText: string) {
    let calls = 0;
    let recoveryPrompt = "";
    const result = await writingPass({
      record: record as never,
      documents: [memo],
      further: { findings: "", documents: [memo], gaps: [] },
      gather: { findings: "", observations: [correction] } as never,
      warm: { actions: [], windows: [], gaps: [] } as never,
      cold: { actions: [], roster: [], votes: [], gaps: [] } as never,
      reconcile: reconcile as never,
      contrary: { contrary: [], unknowns: [], gaps: [], raw: { ok: true, error: "", text: "", chars: 0, truncated: false } },
      scoring: { score: null, readiness: 0, why: "", gaps: [] },
      assignment, action: "Develop this lead", city: "Longmont",
      method: { text: "fixture method", version: "2.6.0" } as never,
      chatOpts: {}, workspaceDir: "", throwIfCancelled: async () => {},
      chat: (async (_system: string, prompt: string) => {
        calls += 1;
        if (calls === 1) return { ok: true as const, text: truncated };
        recoveryPrompt = prompt;
        return { ok: true as const, text: recoveryText };
      }) as never,
    });
    return { result, calls, recoveryPrompt };
  }

  const recovered = await run(JSON.stringify(complete));
  assert.equal(recovered.calls, 2, "exactly one recovery call follows the truncated writer output");
  assert.ok(recovered.recoveryPrompt.includes(url), "the recovery receives the URL of the read primary memo");
  assert.match(recovered.recoveryPrompt, /write a NEW complete focused package from the read primary records above/i);
  assert.match(recovered.recoveryPrompt, /Do not pretend to recover missing source IDs or invent the truncated text/);
  assert.match(recovered.recoveryPrompt, /S39.*council-communication-9-29-26\.p/);
  assert.equal(recovered.result.error, "");
  assert.equal(recovered.result.stories.length, 1, "the valid replacement package is returned");
  assert.equal(recovered.result.stories[0]!.claims!.length, 1);
  assert.equal(recovered.result.stories[0]!.sources!.length, 1, "the replacement has a complete compact source list");
  assert.equal(recovered.result.stories[0]!.sources![0]!.url, url);
  assert.equal(recovered.result.stories[0]!.sources![0]!.locator, "p. 3, One- Time Budget Adjustments");

  const failed = await run("{\"stories\":[{broken");
  assert.equal(failed.calls, 2, "a malformed recovery is the final bounded attempt");
  assert.equal(failed.result.stories.length, 0);
  assert.match(failed.result.error, /did not parse as JSON/);
});
