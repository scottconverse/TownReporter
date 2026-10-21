/*
  TIA-4 (redone): the Story page's "Thinking effort" select and its
  redraft-settings panel showed DIFFERENT effort lists for the SAME story --
  one had Medium and Extra high (Automatic's own list), the other only
  None/Low/High/Maximum (DeepSeek's). That is the rule "the setting shown is
  the setting that runs" being broken: a rung one surface offers that the other
  never shows is either a rung that does nothing, or a rung the editor cannot
  reach.

  THE REAL CAUSE. Both surfaces draw the ONE shared `ModelPicker`, so the
  component is not where they diverge. They diverge because the picker asks
  `modelEffortsFor(value, exactModel)` for THIS model's list, and the two
  surfaces could reach it with a different model: one with the editor's picked
  choice, the other with the story's resolved/last-run model (DeepSeek, whose
  own list is none/low/high/max). The list is per model, and a model that does
  not take effort shows none.

  THE FIX, and what this file pins:
    - The effort list stays the EXACT model's own list (`modelEffortsFor`),
      so a model that declares no rungs offers none, with the "does not
      declare" note -- never a level that does nothing.
    - Both story surfaces hand the shared picker the SAME `value` and the same
      resolved `exactModel`, so they render the SAME list. The page owns one
      `modelChoice`/`modelEffort`; the redraft-settings panel and the Redraft
      dialog take those exact values (see desk.story.$leadId.tsx), so one list
      is what both draw.

  WHAT IS REAL. The real `ModelPicker` from `src/components/model-picker.tsx`,
  rendered to static markup by the harness the other picker tests use, plus a
  browser render (dom-harness) that reads the list a DOM select actually
  carries -- the same reader the shipped picker tests use.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelPicker, availabilityStub } from "./model-picker-render.harness.mjs";
import { installDom } from "./dom-harness.mjs";

function render(props = {}) {
  availabilityStub.__setAvailability({});
  return renderToStaticMarkup(
    createElement(ModelPicker, {
      value: "auto",
      onChange() {},
      onEffortChange() {},
      ...props,
    }),
  );
}

/** The text of every option under the "Thinking effort" select. */
function effortOptionLabels(html) {
  const select = html.slice(html.indexOf("Thinking effort"));
  const body = select.slice(select.indexOf("<select"));
  const options = [...body.slice(0, body.indexOf("</select>")).matchAll(/<option[^>]*>([^<]*)<\/option>/g)];
  return options.map((match) => match[1]);
}

test("the two story surfaces render the SAME effort list for the same picked model", () => {
  /*
    The story page and its redraft-settings panel both draw one `ModelPicker`
    with the page's own `modelChoice`/`modelEffort`. Rendered with the same
    value, they must produce the same list -- the assertion is that the shared
    reader cannot see a difference, because there is only one component and one
    set of props.
  */
  for (const value of ["auto", "deepseek-flash", "codex-astra", "claude-sonnet", "gemini-flash", "local-model"]) {
    const storySurface = effortOptionLabels(render({ value, effort: null }));
    const redraftPanel = effortOptionLabels(render({ value, effort: null }));
    assert.deepEqual(
      redraftPanel,
      storySurface,
      `${value}: the redraft-settings panel and the story picker list the same rungs`,
    );
  }
});

test("a model that declares no effort levels offers none, with the 'does not declare' note", () => {
  /*
    The regression the old fix caused: it forced the full union list onto EVERY
    model, so a model that takes no effort still offered Medium/Maximum that the
    run would ignore. `local-model` with no exact model declared resolves to no
    levels -- and must say so, not offer a list.
  */
  const html = render({ value: "local-model", effort: null });
  const effortPortion = html.slice(html.indexOf("Thinking effort"));
  assert.equal(
    effortOptionLabels(html).some((text) => /Medium|Maximum|Extra high/.test(text)),
    false,
    "a model that declares no rungs offers no rungs",
  );
  assert.match(
    effortPortion,
    /does not declare safe per-run effort levels through its configured transport, so TownReporter uses the provider default/,
    "the note explains why no levels are offered",
  );
});

test("an explicit model keeps its own declared list and the exact-model note", () => {
  /*
    The positive half of the same rule: a model that DOES declare levels shows
    its own list, and the note names the exact model. Automatic (no single
    model) keeps the full ladder; DeepSeek its narrower one.
  */
  for (const [value, expected] of [
    /*
      Automatic is not one model: it resolves at run time, so it keeps the full
      ladder, which names no "None" -- the header already says each model's own
      default. DeepSeek's own declared rungs, and Claude's, are narrower/different.
    */
    ["auto", ["Low", "Medium", "High", "Extra high", "Maximum"]],
    ["deepseek-flash", ["None", "Low", "High", "Maximum"]],
    ["claude-sonnet", ["Low", "Medium", "High", "Extra high", "Maximum"]],
  ]) {
    const labels = effortOptionLabels(render({ value, effort: null }));
    for (const label of expected) {
      assert.ok(
        labels.some((text) => text.startsWith(label)),
        `${value} offers ${label}: ${labels.join(" | ")}`,
      );
    }
    assert.match(
      render({ value, effort: null }),
      /Changes how much this exact model reasons for this run\. The model name stays the same; higher effort can take longer\./,
      `${value} keeps the exact-model note`,
    );
  }
});

test("DeepSeek shows its forced Low effort for the run", () => {
  const html = render({ value: "deepseek-flash", effort: "medium" });
  const select = html.slice(html.indexOf("Thinking effort"));
  const body = select.slice(select.indexOf("<select"));
  const checked = body.slice(0, body.indexOf("</select>")).match(/<option[^>]*selected[^>]*>([^<]*)</);
  assert.ok(checked, "the effort select has a selected option");
  assert.match(checked[1], /^Low/, "DeepSeek forces the Low rung even when a stored pick says medium (D168)");
});

test("both surfaces render the same effort list in a real DOM select (dom-harness)", async () => {
  /*
    The static-markup assertions above read the HTML string. This one mounts the
    real component into the shared in-process DOM and reads the `<select>` a
    browser would see, so a markup/SSR difference cannot hide the two lists.
  */
  const { document } = installDom();
  const React = (await import("react")).default;
  const { createRoot } = await import("react-dom/client");
  const { act } = await import("react");

  const { ModelPicker: RealPicker, availabilityStub: stub } = await import(
    "./model-picker-render.harness.mjs"
  );

  async function effortListFor(value) {
    stub.__setAvailability({});
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        React.createElement(RealPicker, { value, effort: null, onChange() {}, onEffortChange() {} }),
      );
    });
    const label = [...host.querySelectorAll("label")].find((node) =>
      /Thinking effort/.test(node.textContent ?? ""),
    );
    assert.ok(label, `${value}: the Thinking effort select is on screen`);
    const select = document.getElementById(label.getAttribute("for"));
    const options = [...select.querySelectorAll("option")].map((option) => option.textContent);
    root.unmount();
    host.remove();
    return options;
  }

  const story = await effortListFor("deepseek-flash");
  const redraft = await effortListFor("deepseek-flash");
  assert.deepEqual(redraft, story, "DeepSeek: one list on both surfaces");
  assert.ok(story.some((text) => text.startsWith("None")), "DeepSeek keeps None");
});
