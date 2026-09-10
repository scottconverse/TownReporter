import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/routes/desk.dark.tsx", import.meta.url), "utf8");

test("unverified signals do not claim that adversarial checks never ran", () => {
  assert.match(source, /has not met all verification requirements/);
  assert.match(source, /Review their checks and missing evidence/);
  assert.doesNotMatch(source, /has not shown that it tried to disprove/);
});

test("a newly created Dark file keeps the operator's selected model through its initial open payload", () => {
  const afterOpen = source.match(/function afterOpen\([\s\S]*?\n {2}}/)?.[0] ?? "";
  const bind = afterOpen.indexOf("pickedFor.current = id");
  const open = afterOpen.indexOf("rememberOpen(id)");
  const start = afterOpen.indexOf("advance.mutate(id)");
  assert.ok(bind >= 0, "new-file flow must bind the selected model before detail hydration");
  assert.ok(bind < open, "bind before opening the new investigation in the UI");
  assert.ok(open < start, "retain the existing open-then-start flow");
});
