import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { doorModule, cleanupDoorModules } from "./model-picker-doors.harness.mjs";
import { availabilityStub } from "./model-picker-render.harness.mjs";

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
const lead = {
  id: 22,
  headline: "Fixture story",
  topic: "council",
  status: "new",
  summary: "Fixture",
  url: "https://example.org",
};
// DeskShell in the door harness drops `actions`, so render its action slot too:
// the scan picker must be absent from it, while the header's own buttons remain.
// The key-hint legend is not part of the picker check and the harness stubs its
// import.
const queueOverrides = {
  DeskShell: `({children,lede,actions})=>h("main",{},h("div",{className:"head-acts"},actions),lede,children)`,
  TRIAGE_LEGEND: "[]",
};

// Two shared model pickers on the Queue, one per job (Walk C, DHC13):
// "Model for this scan" in its own body row directly above the controls, and
// "Model for these stories" in the bulk strip that Start N stories uses. Both
// keep the full list.
test("the Queue keeps one scan picker in its body row and one bulk picker, each with the full list", async (t) => {
  t.after(cleanupDoorModules);
  availabilityStub.__setAvailability({});
  availabilityStub.__setLocalChoice({ override: local, catalog });
  availabilityStub.__setConnections([]);
  globalThis.screenData = {
    "my-desk": { role: "owner", newsroomId: 1, claimed: true },
    sources: [],
    // The door's useQuery stub hands every "leads" query this one value: the page
    // reads `.rows`, the batch pool reads the array itself.
    leads: Object.assign([lead], { rows: [lead] }),
    scans: [],
  };
  globalThis.pickerDoorState = { selectedDeleteLeadIds: [22] };
  const queueModule = await import(await doorModule("src/routes/desk.queue.tsx", [], queueOverrides));
  const doc = parseHTML(renderToStaticMarkup(createElement(queueModule.Route.component))).document;

  const scanRow = doc.querySelector(".queue-scan-model");
  assert.ok(scanRow, "the scan picker has its own body row");
  assert.equal(
    scanRow.nextElementSibling,
    doc.querySelector(".queue-controls"),
    "the scan picker row comes directly before the Open/Held/Killed controls",
  );
  const scanPickers = [...scanRow.querySelectorAll('[data-model-picker="shared"]')];
  assert.equal(scanPickers.length, 1, "there is exactly one scan picker, in the body row");
  assert.equal(scanPickers[0].getAttribute("data-model-scope"), "scan", "the body-row picker scans");
  assert.equal(
    doc.querySelectorAll('.head-acts [data-model-picker="shared"]').length,
    0,
    "no model picker remains in the header actions",
  );
  const bulkPickers = [...doc.querySelectorAll('.queue-bulk [data-model-picker="shared"]')];
  assert.equal(bulkPickers.length, 1, "there is exactly one bulk picker");
  assert.equal(bulkPickers[0].getAttribute("data-model-scope"), "forced", "the bulk picker drafts stories");
  const pickers = [...doc.querySelectorAll('[data-model-picker="shared"]')];
  assert.equal(pickers.length, 2, "the Queue renders exactly two shared model pickers");
  assert.deepEqual(
    pickers.map((picker) => picker.querySelector("label")?.textContent),
    ["Model for this scan", "Model for these stories"],
  );
  const offered = pickers.map((picker) =>
    [...picker.querySelector("select").querySelectorAll("option")].map((option) =>
      option.getAttribute("value"),
    ),
  );
  assert.deepEqual(offered[1], offered[0], "both pickers offer the same full list");
  assert.ok(offered[0].includes("auto"), "Automatic is offered");
  assert.ok(offered[0].includes("deepseek-flash"), "DeepSeek v4.1 Flash is offered");
  assert.ok(offered[0].includes("local-model"), "Local model is offered");
});
