// Guard for Scott's never-remove rule (Oct 11): a PR may not remove or reword
// an on-screen string in src/**/*.tsx unless its body says so. Added strings are
// read from src/**/*.ts too, so a string moved into a .ts helper is not a
// removal; removed comment lines are not on-screen text.
//
// Based on tools/pr-removed-ui.mjs in townreporter-deepseek-oversight, with two
// changes: the diff comes from git (no `gh`, so CI needs no token), and the
// PR body is read from the environment, where a line
//   Scott asked to remove: <text>
// allows one removed string.
//
// Self-tests run in every `npm test` shard. The live check runs only in CI,
// where the static job sets GUARD_BASE, GUARD_HEAD and GUARD_PR_BODY. Cost:
// one `git diff` (about 1 second) in the static job.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "node:test";

const normalize = (text) => text.replace(/\s+/g, " ").trim().toLowerCase();

// Visible text on a changed line: JSX text between tags, and sentence-like
// string literals. Same patterns as tools/pr-removed-ui.mjs.
export function visibleTextOf(line) {
  const out = [];
  for (const m of line.matchAll(/>([^<>{}]*[A-Za-z]{3,}[^<>{}]*)</g)) out.push(m[1].trim());
  for (const m of line.matchAll(/["'`]([A-Z][^"'`]{3,})["'`]/g)) out.push(m[1].trim());
  return out.filter((t) => t.length > 3 && /\s|[A-Z][a-z]/.test(t));
}

// A removed line that is a comment, not on-screen text: after the leading
// "-" it is blank then //, /* or * (a block-comment continuation).
const isCommentLine = (text) => /^\s*(?:\/\/|\/\*|\*)/.test(text);

// The on-screen strings a unified diff removes and does not add back.
// Removals are counted only in src/**/*.tsx (the files that render). Added
// strings are collected from every non-test src/**/*.ts(x) file too, because a
// string moved out of a .tsx into a .ts helper still shows on screen and must
// not read as a removal.
export function removedUiStrings(diffText) {
  let file = "";
  const removed = [];
  const added = new Set();
  for (const line of diffText.split("\n")) {
    if (line.startsWith("+++ b/")) {
      file = line.slice(6);
      continue;
    }
    if (!/^src\/.+\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file)) continue;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      for (const t of visibleTextOf(line)) added.add(normalize(t));
    }
    if (line.startsWith("-") && !line.startsWith("---") && !/\.tsx$/.test(file)) continue;
    if (line.startsWith("-") && !line.startsWith("---")) {
      if (isCommentLine(line.slice(1))) continue;
      for (const t of visibleTextOf(line)) removed.push({ file, text: t });
    }
  }
  return removed.filter((r) => !added.has(normalize(r.text)));
}

// The strings the PR body says Scott asked to remove.
export function askedToRemove(prBody) {
  return [...(prBody ?? "").matchAll(/^\s*Scott asked to remove:\s*(.+?)\s*$/gim)].map((m) =>
    normalize(m[1]),
  );
}

// A removed string is allowed when a body line names it. Either direction
// counts, so a short quote from the body still matches a longer string.
export function unexplainedRemovals(diffText, prBody) {
  const asks = askedToRemove(prBody).filter((ask) => ask.length >= 4);
  return removedUiStrings(diffText).filter((r) => {
    const text = normalize(r.text);
    return !asks.some((ask) => ask.includes(text) || text.includes(ask));
  });
}

test("a removed sentence in a .tsx file is reported", () => {
  const diff = [
    "+++ b/src/components/example.tsx",
    '-      <p>Draft this story anyway and we will print it.</p>',
    "+      <p>Draft this story.</p>",
  ].join("\n");
  const gone = unexplainedRemovals(diff, "");
  assert.deepEqual(gone.map((r) => r.text), ["Draft this story anyway and we will print it."]);
});

test("a reworded string counts as removed", () => {
  const diff = [
    "+++ b/src/components/example.tsx",
    '-      <button>Publish story now</button>',
    "+      <button>Print story now</button>",
  ].join("\n");
  assert.equal(unexplainedRemovals(diff, "").length, 1);
});

test("the same string moved to another line is not a removal", () => {
  const diff = [
    "+++ b/src/components/example.tsx",
    "-      <p>Opinion pieces need a dek before they print.</p>",
    "+++ b/src/components/other.tsx",
    "+      <p>Opinion pieces need a dek before they print.</p>",
  ].join("\n");
  assert.deepEqual(unexplainedRemovals(diff, ""), []);
});

test("a removed string is allowed when the PR body says Scott asked for it", () => {
  const diff = [
    "+++ b/src/components/example.tsx",
    '-      <p>Draft this story anyway and we will print it.</p>',
  ].join("\n");
  const body = "Summary\n\nScott asked to remove: Draft this story anyway and we will print it.\n";
  assert.deepEqual(unexplainedRemovals(diff, body), []);
});

test("an ask for a different string does not excuse the removal", () => {
  const diff = [
    "+++ b/src/components/example.tsx",
    '-      <p>Draft this story anyway and we will print it.</p>',
  ].join("\n");
  const body = "Scott asked to remove: Something else entirely.";
  assert.equal(unexplainedRemovals(diff, body).length, 1);
});

test("a string moved from a .tsx into a .ts helper is not a removal", () => {
  const diff = [
    "+++ b/src/routes/example.tsx",
    '-      <span>{last ? `${when} scan · best first` : "Best first"}</span>',
    "+      <span>{heading(completed)}</span>",
    "+++ b/src/lib/desk/heading.ts",
    '+export function heading(completed) { return completed ? "Best first" : "Best first"; }',
  ].join("\n");
  assert.deepEqual(unexplainedRemovals(diff, ""), []);
});

test("a removed // comment quoting on-screen text is not a removal", () => {
  const diff = [
    "+++ b/src/routes/example.tsx",
    '-    // The refusals ("A draft is being written right now…") are thrown by the',
    "+    // A press that could not do anything says why.",
  ].join("\n");
  assert.deepEqual(unexplainedRemovals(diff, ""), []);
});

test("files outside src/**/*.tsx and test files are not checked", () => {
  const diff = [
    "+++ b/scripts/example.mjs",
    '-      <p>Draft this story anyway and we will print it.</p>',
    "+++ b/src/components/example.test.tsx",
    '-      <p>Draft this story anyway and we will print it.</p>',
    "+++ b/src/lib/news/example.ts",
    '-      const label = "Draft this story anyway and we will print it.";',
  ].join("\n");
  assert.deepEqual(unexplainedRemovals(diff, ""), []);
});

test("live: this PR removes no on-screen text without a Scott ask", (t) => {
  const base = process.env.GUARD_BASE;
  const head = process.env.GUARD_HEAD;
  if (!base || !head) {
    t.skip("GUARD_BASE and GUARD_HEAD are set only in the CI static job");
    return;
  }
  const diff = execFileSync("git", ["diff", "--unified=0", `${base}...${head}`], {
    encoding: "utf8",
    maxBuffer: 64 << 20,
  });
  const gone = unexplainedRemovals(diff, process.env.GUARD_PR_BODY ?? "");
  assert.deepEqual(
    gone.map((r) => `${r.file}: "${r.text.slice(0, 140)}"`),
    [],
    "On-screen text was removed or reworded. Keep it, or add a line to the PR body: Scott asked to remove: <text>",
  );
});
