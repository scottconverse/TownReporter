import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const route = readFileSync(join(ROOT, "src/routes/desk.opinion.tsx"), "utf8");
const opinion = readFileSync(join(ROOT, "src/lib/news/opinion.ts"), "utf8");

test("Opinion mutation feedback keeps separate always-mounted error and status regions", () => {
  assert.match(route, /kind:\s*"info"\s*\|\s*"success"\s*\|\s*"error"/);
  assert.match(route, /role="alert"[\s\S]{0,120}aria-live="assertive"/);
  assert.match(route, /role="status"[\s\S]{0,120}aria-live="polite"/);
  assert.match(route, /notice\?\.kind === "error" \? notice\.text : ""/);
  assert.match(route, /notice && notice\.kind !== "error" \? notice\.text : ""/);
  assert.match(route, /setError\(res\?\.error \?\? "That did not start\."\)/);
  assert.match(route, /setSuccess\("On the paper\./);
});

test("Opinion rows expose the provider that actually completed the run", () => {
  assert.match(opinion, /r\.model_choice/);
  assert.match(route, /modelChoiceLabel\(r\.model_choice\)/);
});
