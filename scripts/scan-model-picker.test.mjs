import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Scan gets the same per-run writing-model picker Story has (see
 * model-picker-render.test.mjs, which already pins the shared ModelPicker
 * component to exactly Automatic, Codex Terra, Codex Sol, and Claude Opus,
 * defaulting to Automatic). This is the source-shape half: the Scan page
 * itself must actually render that component, default to "auto", pass the
 * chosen model through to `runScan`, disable it while a scan is running, and
 * never persist the choice across runs.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "src/routes/desk.scan.tsx"), "utf8");

test("Scan page imports and renders the shared ModelPicker", () => {
  assert.match(src, /import\s*\{\s*ModelPicker\s*\}\s*from\s*["']@\/components\/model-picker["']/);
  assert.match(src, /<ModelPicker\b/);
});

test("Scan's model choice defaults to Automatic and is not persisted (useState, not a stored preference)", () => {
  assert.match(
    src,
    /useState<StoryModelChoice>\("auto"\)/,
    "Scan must default to Automatic like Story, and hold the choice in component state only",
  );
  assert.doesNotMatch(
    src,
    /localStorage|sessionStorage/,
    "the model choice is per click, not persisted, exactly like Story's picker",
  );
});

test("the chosen model is passed into runScan, and the picker is disabled while a scan is running", () => {
  assert.match(
    src,
    /runScan\(\{\s*data:\s*\{\s*modelChoice\s*\}\s*\}\)/,
    "the click must send the editor's choice, not rely on the desk's configured-provider chain",
  );
  const pickerAt = src.indexOf("<ModelPicker");
  assert.ok(pickerAt >= 0, "ModelPicker must be rendered");
  const pickerTag = src.slice(pickerAt, src.indexOf(">", pickerAt) + 1);
  assert.match(pickerTag, /disabled=\{scanning\}/);
  assert.match(pickerTag, /value=\{modelChoice\}/);
  assert.match(pickerTag, /onChange=\{setModelChoice\}/);
});

test("Scan's failure states still show the Sign in button the 0.6.0 work added", () => {
  assert.match(
    src,
    /import\s*\{\s*ProviderSignInButton\s*\}\s*from\s*["']@\/components\/provider-signin-button["']/,
  );
  const signInCount = (src.match(/<ProviderSignInButton\b/g) ?? []).length;
  assert.ok(
    signInCount >= 2,
    "both the preflight-blocked state and the failed-run state must offer the sign-in button",
  );
});
