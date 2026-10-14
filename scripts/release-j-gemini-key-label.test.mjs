/*
  THV-4: a picker option for a newsroom's own API-key connection read just
  "Gemini — gemini-3.5-flash". The desk also reaches Gemini through the
  signed-in Gemini program, so an editor could not tell which route an option
  meant. Release J names the route in the label: "Gemini (key) — ...".

  WHAT IS REAL. The real `ModelPicker`, rendered to static markup, with the
  saved-connections stub answering with one Gemini key connection.

  THE CLAIM. The option text names the key route AND still names the model:
  "Gemini (key) — gemini-3.5-flash". The option VALUE stays `custom:<id>`.
*/
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ModelPicker, availabilityStub } from "./model-picker-render.harness.mjs";

const CONNECTION = {
  id: "9ce9a944-f444-4a69-8927-7c7705c07a35",
  name: "Gemini",
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  modelId: "gemini-3.5-flash",
  enabled: true,
};

test("a key-route connection names the route in the option, keeping its model and its value", () => {
  availabilityStub.__setAvailability({});
  availabilityStub.__setConnections([CONNECTION]);
  try {
    const html = renderToStaticMarkup(
      createElement(ModelPicker, {
        value: `custom:${CONNECTION.id}`,
        onChange() {},
        onEffortChange() {},
      }),
    );
    const option = html.match(
      new RegExp(`<option[^>]*value="custom:${CONNECTION.id}"[^>]*>([^<]*)</option>`),
    );
    assert.ok(option, "the key connection is offered as an option");
    assert.match(option[1], /Gemini \(key\)/, `option names the key route: ${option[1]}`);
    assert.match(option[1], /gemini-3\.5-flash/, `option still names the model: ${option[1]}`);
    assert.ok(
      html.includes(`value="custom:${CONNECTION.id}"`),
      "the option value is the unchanged custom:<id>",
    );
  } finally {
    availabilityStub.__setConnections([]);
    availabilityStub.__setAvailability(undefined);
  }
});
