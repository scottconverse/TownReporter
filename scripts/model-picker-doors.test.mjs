import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { readFile } from "node:fs/promises";
import { doorModule, cleanupDoorModules } from "./model-picker-doors.harness.mjs";
import { availabilityStub } from "./model-picker-render.harness.mjs";

const expected = [
  "auto",
  "codex-astra",
  "codex-luna",
  "codex-frontier",
  "claude-fable",
  "claude-frontier",
  "claude-sonnet",
  "claude-haiku",
  "gemini-flash",
  "gemini-pro",
  "deepseek-flash",
  "local-model",
  "custom:gemini-key",
];
const geminiKeyConnection = {
  id: "gemini-key",
  name: "Gemini Pro (API key)",
  modelId: "gemini-pro-fixture",
  enabled: true,
};
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
const basic = {
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
  "custom-ai-connections": [geminiKeyConnection],
};
const assignmentDraft = Object.fromEntries(
  [
    "scan",
    "lead-score",
    "story-draft",
    "opinion",
    "evidence-check",
    "headlines",
    "dark",
    "follow-up",
    "ocr",
  ].map((key) => [
    key,
    {
      first: { providerId: "local-model", effort: "" },
      fallback1: { providerId: "", effort: "" },
      fallback2: { providerId: "", effort: "" },
    },
  ]),
);
const assignmentScopes = [
  "scan",
  "scan",
  "story",
  "opinion",
  "story",
  "story",
  "dark",
  "follow-up",
  "ocr",
].flatMap((scope) => [scope, scope, scope]);
const doorScopes = {
  Opinion: ["opinion"],
  "Import structure": ["story"],
  "Daily scan": ["scan"],
  "Follow-ups": ["follow-up"],
  Headlines: ["story"],
  "Today New story": ["story", "scan", "story"],
  "Drafts New story destination": ["story", "scan"],
  "Queue Draft selected": ["scan", "forced"],
  "Dark Desk": ["dark"],
  "Dark start dialog": ["dark"],
  Story: ["story"],
  "Models Who does what": assignmentScopes,
  "Server Writing models": assignmentScopes,
  "Meeting Draft with AI": ["story"],
  Transcript: ["story"],
  // D274: one Writer pick -- the second "Model for suggestions" row is gone.
  "Meeting Redraft": ["story", "story"],
};

// A single parity test exercises the production screen/door components. It
// never substitutes a ModelPicker double or copies a route's picker props.
test("FM3c: rendered shared options and actual local select agree across AI doors", async (t) => {
  t.after(cleanupDoorModules);
  availabilityStub.__setAvailability(Object.fromEntries(expected.map((id) => [id, true])));
  availabilityStub.__setLocalChoice({ override: local, catalog });
  availabilityStub.__setConnections([geminiKeyConnection]);
  globalThis.screenData = { ...basic };
  globalThis.pickerDoorState = {};
  const draftsModule = await import(await doorModule("src/routes/desk.drafts.tsx"));
  const draftsDoc = parseHTML(
    renderToStaticMarkup(createElement(draftsModule.Route.component)),
  ).document;
  assert.equal(
    [...draftsDoc.querySelectorAll("a")]
      .find((a) => a.textContent.includes("New story"))
      ?.getAttribute("href"),
    "/desk#story-composer",
    "Drafts New story opens the real Today composer tested below",
  );
  const doors = [
    {
      name: "Opinion",
      path: "src/routes/desk.opinion.tsx",
      state: { showAi: true, modelChoice: "local-model" },
    },
    {
      name: "Import structure",
      path: "src/routes/desk.import.tsx",
      state: { needsModel: true, modelChoice: "local-model" },
    },
    {
      name: "Daily scan",
      path: "src/components/daily-scan-settings.tsx",
      component: "DailyScanSettings",
      state: {
        baseRevision: 1,
        draft: {
          enabled: true,
          localTime: "07:00",
          runtime: "local-model",
          modelEffort: null,
          sourceCap: 3,
          everyDaySourceCount: 0,
          selectedSourceIds: [],
        },
      },
      data: {
        "daily-scan-policy": {
          ok: true,
          policy: { revision: 1, timezone: "America/Denver", selectedSourceIds: [] },
        },
      },
    },
    {
      name: "Follow-ups",
      path: "src/components/follow-up-dialog.tsx",
      component: "FollowUpDialog",
      state: { modelChoice: "local-model" },
      props: { leads: [], onClose() {}, onSubmit() {} },
    },
    {
      name: "Headlines",
      path: "src/components/dialogs/editor-dialogs.tsx",
      component: "HeadlineDialog",
      state: {
        state: {
          choice: "keep",
          written: "",
          current: "Fixture",
          suggestions: [],
          model: "local-model",
          effort: null,
        },
      },
      props: { open: true, leadId: 22, currentHeadline: "Fixture", onClose() {} },
    },
    {
      name: "Today New story",
      path: "src/routes/desk.index.tsx",
      data: { "drafts-desk": [] },
      state: {
        newStoryOpen: true,
        state: {
          tab: "ai",
          model: "local-model",
          effort: null,
          links: "",
          sourceText: "",
          assignment: "",
          researchScope: "public",
          headline: "",
          body: "",
          section: "council",
          pasteMode: "story",
        },
      },
    },
    {
      name: "Drafts New story destination",
      path: "src/routes/desk.index.tsx",
      data: { "drafts-desk": [] },
      state: { panel: "story", storyModel: "local-model" },
    },
    {
      name: "Queue Draft selected",
      path: "src/routes/desk.queue.tsx",
      state: { panel: "batch", batchRuntime: "local-model", batchLeadIds: [22] },
    },
    {
      name: "Dark Desk",
      path: "src/routes/desk.dark.tsx",
      state: { settingsOpen: true, modelChoice: "local-model" },
      data: { "dark-dials": { defaultLimitKey: "standard" } },
    },
    {
      name: "Dark start dialog",
      path: "src/components/dialogs/editor-dialogs.tsx",
      component: "DarkFileDialog",
      props: {
        open: true,
        defaultLimit: "standard",
        defaultModel: "local-model",
        shared: { model: "local-model", effort: null, onModelChoice() {}, onModelEffort() {} },
        onClose() {},
        onOpened() {},
      },
    },
    {
      name: "Story",
      path: "src/routes/desk.story.$leadId.tsx",
      state: { modelResearchOpen: true, modelChoice: "local-model" },
      data: {
        lead: {
          lead: {
            id: 22,
            headline: "Fixture story",
            topic: "council",
            status: "new",
            summary: "Fixture",
            url: "https://example.org",
          },
          draft: null,
        },
      },
    },
    {
      name: "Models Who does what",
      path: "src/routes/desk.models.tsx",
      state: { tab: "assign", draft: assignmentDraft },
      data: { "model-assignments": { ok: true, assignments: [] } },
    },
    {
      name: "Server Writing models",
      path: "src/components/ops-panels.tsx",
      component: "WritingModelsPanel",
      props: { isOwner: true, known: true },
      state: { draft: assignmentDraft },
      data: {
        "model-assignments": { ok: true, assignments: [] },
        "custom-ai-connections": [geminiKeyConnection],
        "provider-statuses": [],
      },
    },
    ...["Meeting Draft with AI", "Transcript"].map((name) => ({
      name,
      path: "src/routes/desk.story.$leadId.tsx",
      state: {
        modelResearchOpen: true,
        modelChoice: "local-model",
        selectedMeetingTranscriptArtifactId: 71,
      },
      data: {
        lead: {
          lead: {
            id: 22,
            headline: "Fixture council meeting",
            topic: "council",
            status: "new",
            summary: "Transcript fixture",
            url: "https://example.org",
          },
          draft: null,
          meetingTranscriptChoices: [
            { artifactId: 71, label: "Original transcript", sha256: "fixture" },
          ],
          defaultMeetingTranscriptArtifactId: 71,
        },
      },
    })),
    {
      name: "Meeting Redraft",
      path: "src/routes/desk.story.$leadId.tsx",
      state: {
        redraftOpen: true,
        modelChoice: "local-model",
        modelResearchOpen: true,
        headline: "Meeting fixture",
        body: "Fixture body",
      },
      data: {
        lead: {
          lead: {
            id: 22,
            headline: "Fixture council meeting",
            topic: "council",
            status: "new",
            summary: "Transcript fixture",
            url: "https://example.org",
          },
          draft: {
            id: 3,
            headline: "Meeting fixture",
            body: "Fixture body",
            dek: "Fixture dek",
            topic: "council",
            notes: "",
            evidence: "",
            model: "local-model",
          },
          meetingTranscriptChoices: [
            { artifactId: 71, label: "Original transcript", sha256: "fixture" },
          ],
          defaultMeetingTranscriptArtifactId: 71,
        },
      },
    },
  ];
  const failures = [];
  for (const door of doors) {
    try {
      globalThis.screenData = { ...basic, ...door.data };
      globalThis.pickerDoorState = door.state;
      const module = await import(await doorModule(door.path));
      const html = renderToStaticMarkup(
        createElement(
          door.component ? module[door.component] : module.Route.component,
          door.props ?? {},
        ),
      );
      const { document } = parseHTML(html);
      const pickers = [...document.querySelectorAll('[data-model-picker="shared"]')];
      const counts = {
        "Today New story": 3,
        "Drafts New story destination": 2,
        "Queue Draft selected": 2,
        "Meeting Redraft": 2,
        "Models Who does what": 27,
        "Server Writing models": 27,
      };
      assert.equal(
        pickers.length,
        counts[door.name] ?? 1,
        `${door.name}: every production picker integration must remain present`,
      );
      assert.deepEqual(
        pickers.map((p) => p.getAttribute("data-model-scope")),
        doorScopes[door.name],
        `${door.name}: real door work scopes must remain correct`,
      );
      for (const picker of pickers) {
        const select = picker.querySelector("select");
        const options = [...select.querySelectorAll("option")];
        assert.deepEqual(
          options
            .map((o) => o.value)
            .filter((v) => v !== "none")
            .sort(),
          expected.toSorted(),
          `${door.name}: full rendered list`,
        );
        for (const option of options) {
          assert.doesNotMatch(
            option.textContent + option.title,
            /not available for this kind of work/,
            `${door.name}: ${option.value} silently excluded by scope`,
          );
          assert.equal(
            option.hasAttribute("disabled"),
            false,
            `${door.name}: ${option.value} disabled`,
          );
          if (picker.getAttribute("data-model-scope") !== "ocr")
            assert.doesNotMatch(
              option.textContent + option.title,
              /unable to read|cannot read images|not available|not set up/i,
              `${door.name}: ready provider ${option.value} excluded`,
            );
        }
        assert.match(
          select.querySelector('option[value="gemini-pro"]').textContent,
          /Gemini.*Pro.*Pro plan/,
        );
        assert.match(
          select.querySelector('option[value="custom:gemini-key"]').textContent,
          /Gemini Pro.*API key/,
        );
        const selected = select.querySelector("option[selected]");
        if (selected?.value === "local-model") {
          assert.ok(
            picker.querySelector('select option[value*="fixture-local-32b"]'),
            `${door.name}: each selected Local provider draws its model select`,
          );
          // H06: the local select, with its "Use whatever model is loaded" option, is on every door.
          assert.match(
            picker.textContent,
            /Use whatever model is loaded \(recommended\)/,
            `${door.name}: Local selected but the local select (use-loaded option) is missing`,
          );
        }
        if (picker.getAttribute("data-model-scope") === "ocr")
          assert.match(picker.textContent, /OCR reads images.*Models without image support/);
      }
      // DHD1-2: the batch dialog's shared picker carries the same label as the bulk strip's,
      // even though the Queue's scan picker now renders first.
      if (door.name === "Queue Draft selected")
        assert.match(
          pickers.find((picker) => picker.getAttribute("data-model-scope") === "forced")?.textContent ?? "",
          /Model for these stories/,
          "dialog picker label matches the bulk strip",
        );
      assert.ok(
        document.querySelector('select option[value*="fixture-local-32b"]'),
        `${door.name}: selected Local model exposes actual discovered model select`,
      );
      t.diagnostic(
        `${door.name}: ${pickers.length} real shared picker(s); scopes ${pickers.map((p) => p.getAttribute("data-model-scope")).join(",")}`,
      );
    } catch (error) {
      const frame = error.stack
        ?.split("\n")
        .find((line) => line.includes("townreporter-picker-doors-"));
      const match = frame?.match(/\((file:\/\/\/.*):(\d+):(\d+)\)/);
      const line = match
        ? (await readFile(new URL(match[1]), "utf8")).split("\n")[Number(match[2]) - 1]
        : "";
      const column = Number(match?.[3] ?? 1) - 1;
      failures.push(
        `${door.name}: ${error.message.slice(0, 400)} ${line?.slice(Math.max(0, column - 100), column + 150)}`,
      );
    }
  }
  delete globalThis.screenData;
  delete globalThis.pickerDoorState;
  assert.deepEqual(failures, []);
});
