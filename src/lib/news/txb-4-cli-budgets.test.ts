import assert from "node:assert/strict";
import { test } from "node:test";
import { providerBudget } from "./ai.ts";
import { KIND_BUDGETS, effectiveBudget, type ProviderOverrides } from "./provider-registry.ts";
import { reportAndDraft, REPORT_EDIT_SYSTEM, reportWriteSystem } from "./report.ts";
import { NAME_INVENTORY_SYSTEM } from "./name-check-work.ts";
import { scanCallTimeoutMs } from "./scan-model-run.ts";
import type { LeadRow } from "./types.ts";

test("TXB-4 all three CLI kinds get fifteen minutes wall and five minutes per call", () => {
  for (const kind of ["claude-code", "codex", "gemini-cli"] as const) {
    assert.deepEqual(KIND_BUDGETS[kind], { wallMs: 900_000, callMs: 300_000, reserveMs: 170_000 }, kind);
  }
  for (const id of ["claude-frontier", "codex-balanced", "gemini-flash"]) {
    assert.deepEqual(providerBudget(id), { wallMs: 900_000, callMs: 300_000, reserveMs: 170_000 }, id);
    assert.equal(scanCallTimeoutMs(id), 300_000, id);
  }
  assert.deepEqual(effectiveBudget("gemini-pro"), { wallMs: 660_000, callMs: 300_000, reserveMs: 300_000 });
  assert.deepEqual(providerBudget("configured"), { wallMs: 660_000, callMs: 180_000, reserveMs: 180_000 });
  assert.deepEqual(KIND_BUDGETS.openai, { wallMs: 38_000, callMs: 20_000, reserveMs: 12_000 });
  assert.deepEqual(KIND_BUDGETS.anthropic, KIND_BUDGETS.openai);
  assert.deepEqual(KIND_BUDGETS.local, { wallMs: 2_400_000, callMs: 600_000, reserveMs: 60_000 });
});

test("TXB-4 per-paper call and wall overrides still merge and clamp independently", () => {
  for (const id of ["claude-frontier", "codex-balanced", "gemini-flash", "gemini-pro"]) {
    const overrides = { [id]: { callMs: 450_000, wallMs: 1_200_000 } };
    const merged = providerBudget(id, overrides);
    assert.deepEqual(merged, { callMs: 450_000, wallMs: 1_200_000, reserveMs: id === "gemini-pro" ? 300_000 : 170_000 });
    assert.equal(scanCallTimeoutMs(id, overrides), 450_000);
    assert.equal(providerBudget(id, { [id]: { callMs: 950_000, wallMs: 60_000 } }).wallMs, 950_000);
  }
});

for (const callMs of [undefined, 450_000]) {
  test(`TXB-4 Claude Code draft writer and edit receive ${callMs ?? 300_000}ms`, async () => {
    const paper = { name: "Test Paper", city: "Longmont", state: "Colorado" };
    const url = "https://city.example/meeting";
    const body = "The council voted 5-2 on Tuesday to raise water rates for residents in January.";
    const lead = { id: 154, headline: "Council raises water rates", why: "Residents pay for water service.", topic: "council", status: "new", source_urls: JSON.stringify([url]), evidence: "", newsworthiness: 1, created_at: "2026-10-19" } as LeadRow;
    const draft = { headline: lead.headline, dek: lead.why, body, topic: lead.topic, source_urls: [url], unanswered: [] };
    const calls: { stage: string; choice: unknown; timeoutMs: number | undefined }[] = [];
    const overrides: ProviderOverrides | undefined = callMs ? { "claude-frontier": { callMs, wallMs: 1_200_000 } } : undefined;
    const result = await reportAndDraft({ userId: "txb-4", lead, urls: [url], memory: [], researchScope: "supplied", modelChoice: "claude-frontier", providerOverrides: overrides }, {
      paper: async () => paper,
      ingest: async () => ({ url, title: "Water rate notice", text: body, extras: [] }),
      capture: async () => ({ version_id: 1, capture_event_id: 2 }),
      hydrate: async () => [],
      chat: async (system, _user, _tokens, choice, options) => {
        const stage = system.startsWith(reportWriteSystem(paper)) ? "writer" : system === REPORT_EDIT_SYSTEM ? "edit" : null;
        if (stage) calls.push({ stage, choice, timeoutMs: options?.timeoutMs });
        if (system === NAME_INVENTORY_SYSTEM) return { ok: true, text: JSON.stringify({ complete: true, people: [] }) };
        if (system.includes('"fetch_urls"')) return { ok: true, text: JSON.stringify({ news: lead.headline, form: "brief" }) };
        return { ok: true, text: JSON.stringify(draft) };
      },
    });
    assert.ok(!("error" in result));
    assert.deepEqual(calls, ["writer", "edit"].map(stage => ({ stage, choice: "claude-frontier", timeoutMs: callMs ?? 300_000 })));
  });
}

test("TXB-4 follow-up pacing keeps its independent ten-minute hard cap", async () => {
  const { followUpRunLimits } = await import("./follow-up-agents.ts");
  assert.equal(followUpRunLimits("claude-sonnet").elapsedMs, 600_000);
  assert.equal(followUpRunLimits("codex-balanced").elapsedMs, 600_000);
  assert.equal(followUpRunLimits("gemini-flash").elapsedMs, 600_000);
});
