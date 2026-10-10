import assert from "node:assert/strict";
import { it } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { OverrideAnyway } from "./override-anyway.ts";

it("shows the server sentence and the action's override press", () => {
  const html = renderToStaticMarkup(
    createElement(OverrideAnyway, {
      warning: { key: "capture", sentence: "This item has no captured record." },
      actionWord: "Save",
      onOverride: () => {},
    }),
  );
  assert.match(html, /This item has no captured record/);
  assert.match(html, /Save anyway/);
  assert.doesNotMatch(html, /disabled=/);
});

it("requires the editor's knowledge note before accepting a no-capture judgment", () => {
  const props = {
    warning: { key: "capture", sentence: "No capture." },
    actionWord: "Save",
    noteRequired: true,
    onOverride: () => {},
  };
  assert.match(
    renderToStaticMarkup(createElement(OverrideAnyway, { ...props, note: "" })),
    /disabled=/,
  );
  assert.doesNotMatch(
    renderToStaticMarkup(
      createElement(OverrideAnyway, { ...props, note: "I heard the vote at the meeting." }),
    ),
    /disabled=/,
  );
});
