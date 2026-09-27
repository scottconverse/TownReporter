import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MoreLeadMenu } from "./editor-dialog-bodies.ts";
import { MORE_LEAD_ITEMS, type MoreLeadAction } from "./editor-dialog-forms.ts";

const render = (onAction: (a: MoreLeadAction) => void = () => undefined) =>
  renderToStaticMarkup(createElement(MoreLeadMenu, { onAction }));

describe("More ▾ (lead) menu", () => {
  it("draws the six rows the reference draws, in its order", () => {
    const html = render();
    assert.equal(MORE_LEAD_ITEMS.length, 6);
    const at = MORE_LEAD_ITEMS.map((it) => html.indexOf(`astra-item-label">${it.label}`));
    for (let i = 0; i < at.length; i += 1) {
      assert.ok(at[i]! >= 0, MORE_LEAD_ITEMS[i]!.label);
      if (i) assert.ok(at[i]! > at[i - 1]!, `${MORE_LEAD_ITEMS[i]!.label} comes after ${MORE_LEAD_ITEMS[i - 1]!.label}`);
    }
    assert.deepEqual(
      MORE_LEAD_ITEMS.map((it) => it.action),
      ["edit", "hold", "merge", "dark", "follow-up", "kill"],
    );
  });

  it("gives every row its own words and its own button, and only the kill row the danger styling", () => {
    const html = render();
    for (const it of MORE_LEAD_ITEMS) {
      assert.ok(html.includes(`astra-item-label">${it.label}`), it.label);
      assert.ok(html.includes(`astra-item-cta">${it.button}`), it.button);
      if (it.note) assert.ok(html.includes(`astra-item-note">${it.note}`), it.note);
    }
    assert.match(html, /class="astra-item danger"/);
    assert.equal((html.match(/astra-item danger/g) ?? []).length, 1);
    // The two rows without a note in the design are drawn without an empty one.
    assert.equal((html.match(/astra-item-note/g) ?? []).length, 4);
    assert.equal(MORE_LEAD_ITEMS.find((it) => it.action === "kill")!.danger, true);
  });

  it("is a list of presses and nothing else: no picker, no field, no second button", () => {
    const html = render();
    assert.ok(!html.includes('aria-label="Model"'));
    assert.ok(!html.includes("<select"));
    assert.ok(!html.includes("<input"));
    assert.equal((html.match(/<button/g) ?? []).length, MORE_LEAD_ITEMS.length);
  });

  it("hands the caller the action of the row that was pressed, and calls nothing by rendering", () => {
    const pressed: MoreLeadAction[] = [];
    render((a) => pressed.push(a));
    assert.deepEqual(pressed, []);
  });
});
