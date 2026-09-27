import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SourceKillPatternBody, type SourceKillPatternBodyProps } from "./editor-dialog-bodies.ts";
import { killPatternLine } from "./editor-dialog-forms.ts";

const result = {
  source: { id: 7, url: "https://records.example/minutes", name: "Records" },
  badSource: 2,
  killedFromSource: 4,
  examples: [
    { id: 91, headline: "Council delays the budget", reason: "Unreadable page" },
    { id: 88, headline: "Water rates rise", reason: null },
  ],
};

const base: SourceKillPatternBodyProps = {
  loading: false,
  error: null,
  result,
  line: killPatternLine(result),
  onClose: () => undefined,
};

const render = (over: Partial<SourceKillPatternBodyProps>) =>
  renderToStaticMarkup(createElement(SourceKillPatternBody, { ...base, ...over }));

describe("Source kill pattern", () => {
  it("says what it is doing while the record is being read", () => {
    const html = render({ loading: true, result: null });
    assert.match(html, /class="astra-msg" role="status">Reading the kill record…</);
    assert.ok(!html.includes("astra-item"), html.slice(0, 200));
  });

  it("answers a failed read with the reason, in the danger tone", () => {
    const html = render({ error: "That source is gone." });
    assert.match(html, /class="astra-msg danger" role="alert">That source is gone\.</);
  });

  it("prints the line, then the examples newest first, each with the reason it has", () => {
    const html = render({});
    assert.match(html, /class="astra-msg" role="status">2 of 4 leads killed from this source for a bad source or unreadable page\.</);
    assert.match(html, /astra-item-label">Council delays the budget</);
    assert.match(html, /astra-item-note">Unreadable page</);
    assert.match(html, /astra-item-label">Water rates rise</);
    assert.ok(html.indexOf("Council delays the budget") < html.indexOf("Water rates rise"));
    // A kill with no reason is drawn without an empty note, not with a blank
    // line where a reason would be.
    assert.equal((html.match(/astra-item-note/g) ?? []).length, 1);
  });

  it("draws nothing at all when there is no kill to show", () => {
    /*
      BJ4: the brief asked for the sentence only where it has a count, so a
      source nothing has been killed from draws no line -- see the note on the
      gate in `SourceKillPatternBody`. The measured sentence is unchanged
      (`killPatternLine` still answers it, pinned below); what changed is that
      nothing prints it at zero, which is what the desk asked for after seeing
      it repeated under every row of the watch list.
    */
    const none = { ...result, badSource: 0, killedFromSource: 0, examples: [] };
    const html = render({ result: none, line: killPatternLine(none) });
    assert.equal(html, "");
    assert.equal(render({ result: null, loading: false, error: null }), "");
  });

  it("offers no control at all: the pattern is shown, never changed", () => {
    for (const over of [{}, { loading: true, result: null }, { error: "No." }, { result: null }]) {
      const html = render(over as Partial<SourceKillPatternBodyProps>);
      assert.ok(!html.includes("<button"), JSON.stringify(over));
      assert.ok(!html.includes("<select"));
      assert.ok(!html.includes("<input"));
      assert.ok(!html.includes("<form"));
    }
  });

  it("counts only what the counts say, and always prints both numbers", () => {
    assert.equal(killPatternLine({ badSource: 0, killedFromSource: 0 }), "No leads killed from this source yet.");
    assert.equal(killPatternLine({ badSource: 0, killedFromSource: 9 }), "9 killed from this source, none for a bad source.");
    // The noun agrees with the total the sentence is about, not with the count
    // in front of it.
    assert.equal(
      killPatternLine({ badSource: 1, killedFromSource: 1 }),
      "1 of 1 lead killed from this source for a bad source or unreadable page.",
    );
    assert.equal(
      killPatternLine({ badSource: 1, killedFromSource: 4 }),
      "1 of 4 leads killed from this source for a bad source or unreadable page.",
    );
    assert.equal(
      killPatternLine({ badSource: 4, killedFromSource: 4 }),
      "4 of 4 leads killed from this source for a bad source or unreadable page.",
    );
  });
});
