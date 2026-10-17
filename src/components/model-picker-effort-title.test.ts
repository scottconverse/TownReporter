import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

/*
  TMA-4: the "Thinking effort" select cuts its chosen text at its own edge. The
  row is only as wide as the bulk strip or the Story page allows, and a long
  effort name (the automatic note) is clipped mid-word with no way to read the
  rest from the box. The real picker now puts the full chosen text on the box
  as its title, and keeps the "Selected:" line under it. This renders the real
  ModelPicker through the same harness the picker's own render test uses.
*/

async function renderEffortSelect(): Promise<{ select: string; shown: string }> {
  const harness = await import("../../scripts/model-picker-render.harness.mjs");
  harness.availabilityStub.__setAvailability({});
  harness.availabilityStub.__setRole("owner");
  const html: string = renderToStaticMarkup(
    createElement(harness.ModelPicker, {
      value: "auto",
      scope: "story",
      effort: null,
      onChange() {},
      onEffortChange() {},
    }),
  );
  const labelFor = /<label for="([^"]+)"[^>]*>\s*Thinking effort/.exec(html)?.[1];
  assert.ok(labelFor, "the picker draws no Thinking effort label");
  const select = html.split("<select").find((part) => part.includes(`id="${labelFor}"`)) ?? "";
  const shown = /<option[^>]*selected=""[^>]*>([^<]*)<\/option>/.exec(select)?.[1] ?? "";
  assert.ok(shown, "no effort option is selected");
  return { select, shown };
}

describe("TMA-4: the Thinking effort select shows its full chosen text", () => {
  it("carries the full chosen effort text as the select's title", async () => {
    const { select, shown } = await renderEffortSelect();
    assert.equal(/ title="([^"]*)"/.exec(select)?.[1], shown);
  });
});
