import assert from "node:assert/strict";
import { it } from "node:test";
import { modelAndResearchLabel } from "./writer-bar.ts";

it("THU-7: after a fallback the label names the model that wrote the draft and keeps the pick", () => {
  assert.equal(
    modelAndResearchLabel({
      runningLine: "",
      pickerModel: "DeepSeek v4.1 Flash",
      requestedModel: "DeepSeek v4.1 Flash",
      writerModel: "Codex Sol 6.1 (balanced)",
    }),
    "Codex Sol 6.1 (balanced) (you picked DeepSeek v4.1 Flash; it fell back)",
  );
});

it("THU-7: a draft written by the pick, or no draft yet, reads as the pick", () => {
  const base = { runningLine: "", pickerModel: "DeepSeek v4.1 Flash", requestedModel: "DeepSeek v4.1 Flash" };
  assert.equal(modelAndResearchLabel({ ...base, writerModel: "DeepSeek v4.1 Flash" }), "DeepSeek v4.1 Flash");
  assert.equal(modelAndResearchLabel({ ...base, writerModel: "" }), "DeepSeek v4.1 Flash");
});

it("THU-7: a picker moved on to another model shows that model", () => {
  assert.equal(
    modelAndResearchLabel({
      runningLine: "",
      pickerModel: "Codex Terra",
      requestedModel: "DeepSeek v4.1 Flash",
      writerModel: "Codex Sol 6.1 (balanced)",
    }),
    "Codex Terra",
  );
});
