/*
  TIA-4: the Story page's "Thinking effort" select and the redraft-settings
  panel for the SAME story offered different lists -- one had Medium and Extra
  high, the other only None/Low/High/Maximum -- because each picker asked its
  own resolved model for its own list (`modelEffortsFor`). Release J gives the
  shared `ModelPicker` ONE list for every screen, built from one shared source
  (`PICKER_EFFORTS` in provider-registry.ts).

  WHAT IS REAL. The real `ModelPicker` from `src/components/model-picker.tsx`,
  rendered to static markup by the harness the other picker tests use.

  THE CLAIM. Whatever model a story resolves to, the effort select offers the
  SAME full list: every rung an editor can see today (none/low/high/maximum)
  AND the ones that were missing from one of the two surfaces (medium/extra
  high). DeepSeek still defaults to None.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelPicker, availabilityStub, registry } from "./model-picker-render.harness.mjs";

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
  const effort = html.split('id="', 2).length ? html : html;
  const select = effort.slice(effort.indexOf("Thinking effort"));
  const body = select.slice(select.indexOf("<select"));
  const options = [...body.slice(0, body.indexOf("</select>")).matchAll(/<option[^>]*>([^<]*)<\/option>/g)];
  return options.map((match) => match[1]);
}

test("every model shows the one shared effort list, so Medium and Extra high appear on both surfaces", () => {
  const shared = registry.PICKER_EFFORTS;
  assert.ok(shared.includes("none"), "None stays offered");
  assert.ok(shared.includes("low"), "Low stays offered");
  assert.ok(shared.includes("high"), "High stays offered");
  assert.ok(shared.includes("max"), "Maximum stays offered");
  assert.ok(shared.includes("medium"), "Medium, missing from one surface, is offered by the shared list");
  assert.ok(shared.includes("xhigh"), "Extra high, missing from one surface, is offered by the shared list");

  // The two surfaces the row names: the story picker and the redraft dialog
  // picker. Both draw the same shared component; both must list the same rungs.
  for (const value of ["auto", "deepseek-flash", "codex-astra", "claude-sonnet", "gemini-flash"]) {
    const labels = effortOptionLabels(render({ value, effort: null }));
    for (const label of ["Medium", "Extra high", "None", "Low", "High", "Maximum"]) {
      assert.ok(
        labels.some((text) => text.startsWith(label)),
        `${value} offers ${label}: ${labels.join(" | ")}`,
      );
    }
  }
});

test("DeepSeek still shows None as the effort for the run", () => {
  const html = render({ value: "deepseek-flash", effort: "medium" });
  const select = html.slice(html.indexOf("Thinking effort"));
  const body = select.slice(select.indexOf("<select"));
  const checked = body.slice(0, body.indexOf("</select>")).match(/<option[^>]*selected[^>]*>([^<]*)</);
  assert.ok(checked, "the effort select has a selected option");
  assert.match(checked[1], /^None/, "DeepSeek forces the None rung even when a stored pick says medium");
});
