// Guard for Scott's rule (Oct 11): the model shown is the model that ran. When a
// Story job's actual runtime differs from the editor's pick, the Writer bar must
// name the actual model (in "Last draft" once finished, in "Writer: ..." while it
// runs) and must still name the picked model. Renders the real Story route, the
// same way scripts/model-picker-doors.test.mjs renders every AI door.
//
// This lives in scripts/ (plain JS), not src/**/*.test.ts: the typecheck:test
// project type-checks every src test and follows its imports, and it would pull
// the untyped door harnesses into that check.
//
// Limit: the door harness stubs "@/lib/news/job-progress" (screen-render-harness
// stubs every non-real import), so the "Model note" line that appears when a job
// carries a failover_note cannot render here. The switch sentence ("You picked X.
// Y wrote this draft because ...") is therefore not covered by this guard.
import assert from "node:assert/strict";
import { after, describe, it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { cleanupDoorModules, doorModule } from "./model-picker-doors.harness.mjs";
import { availabilityStub } from "./model-picker-render.harness.mjs";
import { modelChoiceLabel } from "../src/lib/news/model-choice.ts";

const PICKED = "deepseek-flash";
const ACTUAL = "codex-balanced";
const pickedLabel = modelChoiceLabel(PICKED, "story");
const actualLabel = modelChoiceLabel(ACTUAL, "story");

const local = { baseUrl: "http://127.0.0.1:1234/v1", id: "fixture-local-32b" };
const catalog = {
  servers: [
    {
      kind: "lmstudio",
      baseUrl: local.baseUrl,
      reachable: true,
      status: "running",
      models: [{ id: local.id, loaded: true }],
    },
  ],
  defaultModel: local,
  checkedAt: 1,
};

function storyData(job, draftBody) {
  return {
    "my-desk": { role: "owner", newsroomId: 1, claimed: true },
    sources: [],
    leads: [],
    scans: [],
    "drafts-desk": { rows: [], total: 0, counts: {} },
    "published-desk": [],
    investigations: [],
    "worth-a-look": [],
    memory: [],
    "follow-ups": [],
    "follow-up-findings": [],
    editorials: [],
    "local-model-choice": { override: local, catalog },
    "local-model-catalog": catalog,
    "custom-ai-connections": [],
    lead: {
      lead: {
        id: 22,
        headline: "Fixture story",
        topic: "council",
        status: "new",
        summary: "Fixture",
        url: "https://example.org",
      },
      draft: draftBody === null
        ? null
        : {
            id: 3,
            headline: "Fixture story",
            body: draftBody,
            dek: "Fixture dek",
            topic: "council",
            notes: "",
            evidence: "",
            model: ACTUAL,
            research_json: "{}",
            updated_at: "2026-10-11T15:00:00.000Z",
          },
      job,
    },
  };
}

async function renderedStoryText(job, draftBody) {
  availabilityStub.__setAvailability({ [PICKED]: true, [ACTUAL]: true, "local-model": true });
  availabilityStub.__setLocalChoice({ override: local, catalog });
  availabilityStub.__setConnections([]);
  globalThis.screenData = storyData(job, draftBody);
  globalThis.pickerDoorState = {
    modelResearchOpen: false,
    modelChoice: PICKED,
  };
  const module = await import(await doorModule("src/routes/desk.story.$leadId.tsx"));
  const html = renderToStaticMarkup(createElement(module.Route.component, {}));
  delete globalThis.screenData;
  delete globalThis.pickerDoorState;
  const { document } = parseHTML(html);
  return (document.documentElement?.textContent ?? "").replace(/\s+/g, " ");
}

after(cleanupDoorModules);

describe("the Writer bar names the model that ran, and the pick (Oct 11 rule)", () => {
  it("a finished job whose writer differs from the pick names the writer in Last draft", async () => {
    const text = await renderedStoryText(
      {
        id: 9,
        kind: "draft",
        status: "completed",
        model_choice: ACTUAL,
        requested_model_choice: PICKED,
        finished_at: "2026-10-11T15:00:00.000Z",
        failover_note: null,
        result_json: JSON.stringify({ requestedRuntime: PICKED }),
      },
      "Fixture body",
    );
    assert.match(
      text,
      new RegExp(`Last draft: ${escapeRegExp(actualLabel)}`),
      `Last draft must name the model that wrote the draft (${actualLabel})`,
    );
    assert.ok(
      text.includes(pickedLabel),
      `the picked model (${pickedLabel}) must still be named on the page`,
    );
  });

  it("a running job whose writer differs from the pick names both in the Writer bar", async () => {
    const text = await renderedStoryText(
      {
        id: 10,
        kind: "draft",
        status: "running",
        model_choice: ACTUAL,
        requested_model_choice: PICKED,
        finished_at: null,
        failover_note: null,
        result_json: JSON.stringify({ requestedRuntime: PICKED }),
      },
      null,
    );
    assert.ok(
      text.includes(`Writer: ${actualLabel} · picked: ${pickedLabel}`),
      `while running, the Writer bar must say "Writer: ${actualLabel} · picked: ${pickedLabel}"`,
    );
  });
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
