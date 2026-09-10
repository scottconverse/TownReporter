import assert from "node:assert/strict";
import test from "node:test";
import { isDirectNodeTestInvocation } from "./with-app-env.mjs";

test("recognizes only direct Node test invocations", () => {
  assert.equal(isDirectNodeTestInvocation(process.execPath, ["--experimental-strip-types", "--test", "src/example.test.ts"]), true);
  assert.equal(isDirectNodeTestInvocation("node", ["--test", "scripts/example.test.mjs"]), true);
  assert.equal(isDirectNodeTestInvocation(process.execPath, ["scripts/live-model.mjs"]), false);
  assert.equal(isDirectNodeTestInvocation("vite", ["build", "--test"]), false);
});
