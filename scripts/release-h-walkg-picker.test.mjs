import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseHTML } from "linkedom";
import { doorModule, cleanupDoorModules } from "./model-picker-doors.harness.mjs";
import { screenModuleUrl } from "./screen-render-harness.mjs";
import { stubUrl } from "./dom-harness.mjs";
import { ModelPicker, availabilityStub, modelPickerUrl } from "./model-picker-render.harness.mjs";

const { __setConnections, __setConnectionsPending, __setLocalChoice } = availabilityStub;

after(cleanupDoorModules);

// Walk G (Release H): the effort control and the three AI pickers on the
// Dark Desk, Opinion and Story screens. Each test renders the production
// component and reads what a person would see; none pins source text.

function effortControl(doc) {
  const label = [...doc.querySelectorAll("label")].find((node) => node.textContent === "Thinking effort");
  assert.ok(label, "the picker has a Thinking effort control");
  return doc.getElementById(label.getAttribute("for"));
}

function renderPicker(props) {
  __setConnections([]);
  __setConnectionsPending(false);
  __setLocalChoice({ override: null, catalog: { servers: [], defaultModel: null, checkedAt: 1 } });
  availabilityStub.__setAvailability({});
  const html = renderToStaticMarkup(
    createElement(ModelPicker, { value: "auto", onChange() {}, scope: "opinion", ...props }),
  );
  return parseHTML(html).document;
}

// DHF-6 / DHF-8: with Automatic picked, the effort control must not read
// "Provider default" alone. It says what each model does, the same words
// automaticEffortNote() gives everywhere else.
test("DHF-6/DHF-8: Automatic's effort control says what each model does, not a bare Provider default", () => {
  const doc = renderPicker({ onEffortChange() {}, effort: null });
  const empty = effortControl(doc).querySelector('option[value=""]');
  assert.ok(empty, "the effort control has its empty choice");
  assert.notEqual(empty.textContent.trim(), "Provider default", "the empty choice does not read as a bare Provider default");
  assert.match(empty.textContent, /each model's own default/, "the words say each model uses its own default");
  assert.match(
    empty.textContent,
    /DeepSeek v4\.1 Flash always runs with thinking off/,
    "the words carry the DeepSeek rule: it always runs with effort None",
  );
});

test("DHF-6/DHF-8: the same Automatic effort words show on a story-scope picker too", () => {
  const doc = renderPicker({ scope: "story", onEffortChange() {}, effort: null });
  const empty = effortControl(doc).querySelector('option[value=""]');
  assert.match(empty.textContent, /each model's own default/);
});

test("DHF-6/DHF-8: a fixed model's effort control does not borrow the Automatic words", () => {
  const doc = renderPicker({ value: "codex-luna", onEffortChange() {}, effort: null });
  assert.doesNotMatch(
    effortControl(doc).textContent,
    /each model's own default/,
    "the Automatic words stay on Automatic; a fixed model shows its own effort choices",
  );
});

// DHE1-2: "Model for page watches" is its own job. Walk H showed a Digging pick
// moving it, so the page-watch picker keeps its own state: even when the Dark
// Desk's Digging model is passed in, a new watch starts on Automatic.
test("DHE1-2: the page-watch picker is named for its own job, not Digging model, and keeps its own state", async () => {
  availabilityStub.__setAvailability(Object.fromEntries(["codex-luna", "auto", "local-model"].map((id) => [id, true])));
  {
    // The page-watch panel's own ModelPicker is mapped to the real picker here;
    // the screen harness would otherwise stub "./model-picker" to render nothing.
    const url = await screenModuleUrl(
      "src/components/page-watch-panel.tsx",
      {
        useQuery: `()=>({data:undefined,isPending:false,isError:false})`,
        useMutation: `()=>({mutate(){},isPending:false})`,
        useQueryClient: `()=>({invalidateQueries(){}})`,
      },
      [],
      { imports: { "./model-picker": modelPickerUrl, "./desk-chrome": stubUrl("export const InkButton=()=>null;") } },
    );
    const module = await import(url);
    const html = renderToStaticMarkup(createElement(module.PageWatchPanel, { files: [], modelDefault: "codex-luna" }));
    const doc = parseHTML(html).document;
    const watchPicker = doc.querySelector(".astra-watch-model");
    assert.ok(watchPicker, "the page-watch picker is in the watched-pages panel");
    assert.equal(
      watchPicker.querySelector("label")?.textContent.trim(),
      "Model for page watches",
      "the page-watch picker is named for its own job, not the file's Digging model",
    );
    assert.equal(
      watchPicker.querySelector("option[selected]")?.getAttribute("value"),
      "auto",
      "walk H (DHE1-2): a new watch starts on its own model, not the Dark Desk's Digging model",
    );
  }
});

// DHG-3 / H06: the Story page's "Suggest headlines" press runs AI, so it has the
// shared picker (full list plus effort). It starts on the "Headline suggestions"
// job's model from Server -> Models "Who does what", and the picker shows the
// model the press will run.
test("DHG-3: Suggest headlines has the shared headline picker, set to the headline job's model", async () => {
  availabilityStub.__setAvailability(Object.fromEntries(["codex-luna", "auto", "local-model"].map((id) => [id, true])));
  globalThis.screenData = {
    lead: {
      lead: { id: 22, headline: "Fixture story", topic: "council", status: "new", summary: "Fixture", url: "https://example.org" },
      draft: { id: 5, headline: "Fixture story", body: "Fixture body.", section: "council", status: "draft" },
    },
  };
  globalThis.pickerDoorState = { modelResearchOpen: true, modelChoice: "local-model" };
  try {
    const module = await import(
      await doorModule("src/routes/desk.story.$leadId.tsx", [], {
        resolveJobModel: `({jobKey})=>({providerId:jobKey==="headlines"?"codex-luna":"auto",effort:null,source:"surface-default",rank:null,notice:null})`,
      }),
    );
    const html = renderToStaticMarkup(createElement(module.Route.component));
    const doc = parseHTML(html).document;
    assert.ok(html.includes("Suggest headlines"), "the Suggest headlines press is still on the Story page");
    const headline = [...doc.querySelectorAll('[data-model-picker="shared"]')].find(
      (picker) => picker.querySelector("label")?.textContent.trim() === "Model for suggestions",
    );
    assert.ok(headline, "Suggest headlines has its own shared model picker, named Model for suggestions");
    assert.equal(
      headline.querySelector("option[selected]")?.getAttribute("value"),
      "codex-luna",
      "the picker shows the Headline suggestions job's model, which is the model the press runs",
    );
    assert.ok(
      [...headline.querySelectorAll("label")].some((label) => label.textContent.trim() === "Thinking effort"),
      "the headline picker carries the effort control too",
    );
  } finally {
    delete globalThis.pickerDoorState;
  }
});

// DHG-2: an Opinion editorial whose claims are missing keeps Repair claims as
// its primary and also offers Publish anyway, so the piece can still reach the
// paper. A bare press asks for the claims warning; the warning's confirm is
// the Story page's "I accept these claims are unreviewed".
test("DHG-2: a claims-missing Opinion row keeps Repair claims and also offers Publish anyway", async () => {
  availabilityStub.__setAvailability({});
  globalThis.screenData = {
    editorials: [
      {
        id: 31,
        subject: "Fixture opinion",
        headline: "Fixture opinion",
        draft_id: 9,
        finished_at: "2026-10-01T12:00:00.000Z",
        created_at: "2026-10-01T11:00:00.000Z",
        integrity_notes: "Two claims have no source in the appendix.",
        error: null,
        published_slug: null,
        dek: "A summary for readers.",
        stalled: false,
      },
    ],
  };
  globalThis.pickerDoorState = {};
  try {
    const module = await import(await doorModule("src/routes/desk.opinion.tsx"));
    const html = renderToStaticMarkup(createElement(module.Route.component));
    const doc = parseHTML(html).document;
    const row = [...doc.querySelectorAll("li.astra-row")].find((li) => li.textContent.includes("Fixture opinion"));
    assert.ok(row, "the editorial row is listed");
    assert.ok(row.textContent.includes("Claims missing"), "the row says its claims are missing");
    const labels = [...row.querySelectorAll("a, button")].map((node) => node.textContent.trim());
    assert.ok(labels.includes("Repair claims"), "Repair claims stays as the row's own primary");
    assert.ok(labels.includes("Publish anyway"), "Publish anyway is offered, so the row never hides the publish press");
  } finally {
    delete globalThis.pickerDoorState;
    delete globalThis.screenData;
  }
});
