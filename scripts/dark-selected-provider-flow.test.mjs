// guards: an unrelated local-server warning could make a ready Codex investigation look unavailable
import assert from "node:assert/strict";
import { test } from "node:test";
import { installDom } from "./dom-harness.mjs";
installDom();
const React = await import("react");
const { createRoot } = await import("react-dom/client");
const { ModelPicker, availabilityStub } = await import("./model-picker-render.harness.mjs");
test("provider readiness help belongs only to the selected model", async () => {
  availabilityStub.__setAvailability({ "local-model": false });
  const node = document.createElement("div"); document.body.append(node); const root = createRoot(node);
  try {
    for (const value of ["codex-frontier", "local-model", "claude-sonnet"]) {
      await React.act(async () => root.render(React.createElement(ModelPicker, { scope: "dark", layout: "stacked", value, onChange() {}, onEffortChange() {} })));
      const help = [...node.querySelectorAll(".model-picker-help")].map((n) => n.textContent).join(" ");
      assert.equal(/cannot reach a local model/.test(help), value === "local-model");
      await React.act(async () => node.querySelector(".model-picker-setup summary").click());
    }
  } finally { await React.act(async () => root.unmount()); node.remove(); }
});
