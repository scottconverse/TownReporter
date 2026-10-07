import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AddSourcesBody } from "./editor-dialog-bodies.ts";
import { ChoiceDouble, ModelPickerDouble } from "./test-choice.ts";
import {
  SOURCE_TABS,
  addSourcesInitial,
  modelRowFor,
  sourcesProblem,
  sourcesRequest,
  type AddSourcesState,
} from "./editor-dialog-forms.ts";
import { FIND_SOURCE_SCOPES, previewSources, previewSplit, sourceKindLabel } from "../../lib/news/editor-dialog-logic.ts";
import { parseSourceLines } from "../../lib/news/source-lines.ts";

const models = modelRowFor("scan");
const named = models.find((r) => r.value !== "auto");

const PASTE = "https://longmontcolorado.gov/news\nhttps://www.boulder.example.org/records";
const watched = previewSources(PASTE, ["https://www.longmontcolorado.gov/news"]);

const base = {
  state: addSourcesInitial(),
  set: () => undefined,
  problem: null as string | null,
  note: null as string | null,
  preview: null,
  ModelPicker: ModelPickerDouble,
  Choice: ChoiceDouble,
};

const render = (over: Partial<AddSourcesState>, extra: { preview?: typeof watched | null; fileName?: string } = {}) =>
  renderToStaticMarkup(
    createElement(AddSourcesBody, {
      ...base,
      preview: extra.preview ?? null,
      state: { ...base.state, ...(extra.fileName ? { fileName: extra.fileName } : {}), ...over },
    }),
  );

const state = (over: Partial<AddSourcesState>): AddSourcesState => ({ ...addSourcesInitial(), ...over });

describe("Add sources dialog", () => {
  it("draws the four drawn tabs, starting on the one-link form", () => {
    const html = render({});
    for (const t of SOURCE_TABS) assert.ok(html.includes(t.label), t.label);
    assert.match(html, /class="astra-tab on"[^>]*>One link/);
    assert.match(html, /astra-field-label">Link</);
    assert.match(html, /astra-field-label">Name</);
    assert.match(html, /astra-field-label">What to watch for<span class="astra-field-hint"> optional/);
    // The drawn "Check it" choice: one card, already selected, with its note.
    assert.match(html, /astra-choices-label">Check it</);
    assert.match(html, /<b>Every daily scan<\/b><span class="astra-choice-note">The desk checks sources once a day at scan time/);
    assert.ok(!html.includes('aria-label="Model"'));
  });

  it("renders each tab's own controls", () => {
    const list = render({ tab: "list" });
    assert.match(list, /astra-field-label">Links</);
    assert.match(list, /Paste URLs, one per line\. Names optional after a comma\./);

    const file = render({ tab: "file" }, { fileName: "watchlist.csv", preview: watched });
    assert.match(file, /astra-drop-title">Drop a CSV, OPML or sitemap/);
    assert.match(file, /CSV columns: url, name, frequency/);
    assert.match(file, /Choose a file/);
    assert.match(file, /class="astra-msg ok" role="status">Read watchlist\.csv\.</);

    const ai = render({ tab: "ai" });
    assert.match(ai, /astra-field-label">What should the paper cover\?</);
    assert.match(ai, /astra-choices-label">Search</);
    for (const s of FIND_SOURCE_SCOPES) assert.ok(ai.includes(s.label), s.label);
    assert.match(ai, /aria-label="Model"/);
  });

  it("marks the preview new from already watched, by source identity and not by string", () => {
    const html = render({ tab: "list" }, { preview: watched });
    assert.match(html, /Preview · 2 found/);
    assert.match(html, /1 new · 1 already watched/);
    // The tick is the row that will be added -- the drawing fills the box for
    // the rows it is about to add and leaves it empty for the one it already
    // watches. The watched row is the paste's non-www URL against the watch
    // list's www one: same identity, so its box is empty.
    assert.ok(
      html.includes('<span class="astra-preview-mark" aria-hidden="true"></span>'),
      html.slice(html.indexOf("astra-preview"), html.indexOf("astra-preview") + 400),
    );
    assert.ok(html.includes('<span class="astra-preview-mark on" aria-hidden="true">✓</span>'));
    assert.match(html, /astra-preview-kind">Already watched/);
    assert.match(html, /astra-preview-kind on">Official page/);
    assert.match(html, /astra-preview-url">https:\/\/longmontcolorado\.gov\/news/);

    // Nothing watched: every row is new, and the split says only that.
    const allNew = previewSources(PASTE, []);
    assert.equal(previewSplit(allNew), "2 new");
    const fresh = render({ tab: "list" }, { preview: allNew });
    assert.match(fresh, /2 new/);
    assert.ok(!fresh.includes("already watched"));
  });

  it("names each preview row's kind from the line it came from, not from the URL alone", () => {
    const [official, news] = parseSourceLines(`TIER B\n${PASTE}`).map(sourceKindLabel);
    assert.equal(official, "News page");
    assert.equal(news, "News page");
    assert.equal(sourceKindLabel(parseSourceLines("https://x.example/feed")[0]!), "RSS");
  });

  it("refuses the press until the chosen tab has what it needs", () => {
    assert.match(sourcesProblem(state({ tab: "one" })) ?? "", /has to start with http/);
    assert.match(sourcesProblem(state({ tab: "one", url: "records.example.org" })) ?? "", /has to start with http/);
    assert.equal(sourcesProblem(state({ tab: "one", url: "https://records.example.org" })), null);

    assert.match(sourcesProblem(state({ tab: "list" })) ?? "", /Paste the links, one per line/);
    assert.equal(sourcesProblem(state({ tab: "list", text: "https://a.example" })), null);

    assert.match(sourcesProblem(state({ tab: "file" })) ?? "", /Choose a CSV, OPML or sitemap file/);
    assert.equal(sourcesProblem(state({ tab: "file", fileName: "a.csv" })), null);

    assert.match(sourcesProblem(state({ tab: "ai" })) ?? "", /Say what the paper should cover/);
    assert.match(sourcesProblem(state({ tab: "ai", topic: "wa" })) ?? "", /Say what the paper should cover/);
    assert.equal(sourcesProblem(state({ tab: "ai", topic: "water" })), null);
  });

  it("calls the right server function from each tab", () => {
    const one = sourcesRequest(state({ tab: "one", url: " https://records.example.org/x ", name: " Records " }));
    assert.equal(one.call, "addSource");
    // `title`/`kind`/`tier` are required by `addSourceInput`; kind and tier go
    // empty for the server to fill from the URL.
    assert.deepEqual(one.input, { url: "https://records.example.org/x", title: "Records", kind: "", tier: "" });

    const list = sourcesRequest(state({ tab: "list", text: " https://a.example\nhttps://b.example " }));
    assert.equal(list.call, "addSourcesBulk");
    assert.deepEqual(list.input, { text: "https://a.example\nhttps://b.example" });

    // A CSV/OPML/sitemap is read into lines and then it IS a list: one call,
    // one rule about duplicates.
    const file = sourcesRequest(state({ tab: "file", text: "https://a.example", fileName: "a.csv" }));
    assert.equal(file.call, "addSourcesBulk");
    assert.deepEqual(file.input, { text: "https://a.example" });

    const ai = sourcesRequest(state({ tab: "ai", topic: " Longmont water ", scope: "everything" }));
    assert.equal(ai.call, "findSources");
    assert.equal(ai.input.topic, "Longmont water");
    assert.equal(ai.input.scope, "everything");
  });

  it("defaults an unknown scope back to the first one the desk offers", () => {
    const req = sourcesRequest(state({ tab: "ai", topic: "water", scope: "not-a-scope" }));
    assert.equal(req.input.scope, FIND_SOURCE_SCOPES[0].key);
  });

  it("sends a model only when the editor named one on the AI tab", () => {
    assert.ok(named, "modelRowFor('scan') offers a named model beside Automatic");
    const picked = sourcesRequest(state({ tab: "ai", topic: "water", model: named!.value, effort: "low" }));
    assert.equal(picked.input.modelChoice, named!.value);
    assert.equal(picked.input.modelEffort, "low");
    assert.equal(sourcesRequest(state({ tab: "ai", topic: "water" })).input.modelChoice, "auto");

    // The three no-AI tabs never carry a pick, whatever the state holds.
    for (const tab of ["one", "list", "file"] as const) {
      const req = sourcesRequest(state({ tab, url: "https://a.example", text: "https://a.example", fileName: "a.csv", model: named!.value, effort: "high" }));
      assert.ok(!("modelChoice" in req.input), tab);
      assert.ok(!("modelEffort" in req.input), tab);
    }
  });

  it("keeps a cancelled dialog exactly as it opened", () => {
    assert.deepEqual(addSourcesInitial(), addSourcesInitial());
    const held = Object.freeze(
      state({ tab: "ai", url: "https://a.example", name: "n", watchFor: "w", text: "t", fileName: "f.csv", topic: "water", model: named?.value ?? "auto", effort: "high" }),
    ) as AddSourcesState;
    const snapshot = structuredClone(held);
    for (const { key: tab } of SOURCE_TABS) {
      sourcesRequest({ ...held, tab });
      renderToStaticMarkup(createElement(AddSourcesBody, { ...base, state: Object.freeze({ ...held, tab }), preview: watched }));
    }
    assert.deepEqual(held, snapshot);
  });
});
