/*
  Release-state honesty: in-repo docs must not describe the current release as
  unpublished once its GitHub release is actually published.

  Why this exists (directive item 4): v0.6.54 shipped to GitHub while
  `docs/releases/0.6.54.md` still said "Source release prepared; Git tag,
  GitHub release, and packaged assets not created by this commit." A reader
  following the repo was told the release was not out while the release page
  said it was. The same defect existed for v0.6.52. This guard fails when the
  current release note carries a pre-publication "not created"/"prepared" state
  line without a matching "published" statement.

  It reads the *current* release note only, resolved from package.json, so
  historical notes are never rewritten to satisfy it. If the release genuinely
  is not published yet, the note must say so explicitly with the word
  "Unreleased" and no published-claim fields are required -- the test then
  asserts the ABSENCE of "Released" rather than requiring it, so an honest
  pre-publication note still passes.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

test("the current release note does not claim 'not published' once released", () => {
  const version = JSON.parse(read("package.json")).version;
  const notePath = `docs/releases/${version}.md`;
  const note = read(notePath);

  // Pre-publication phrasing that must never coexist with a published release.
  const prepPhrases = [
    /not created by this commit/i,
    /Git tag, GitHub release, and packaged assets not created/i,
    /Release preparation/i,
    /Source release prepared/i,
  ];

  // A note that explicitly declares itself Unreleased is allowed to use prep
  // wording; a published note is not.
  const declaresUnreleased = /\*\*State:\*\*\s*Unreleased/i.test(note);
  const declaresReleased = /\*\*State:\*\*\s*Released/i.test(note);

  if (!declaresUnreleased) {
    for (const re of prepPhrases) {
      assert.doesNotMatch(
        note,
        re,
        `${notePath} still uses pre-publication wording (${re}) but does not declare "Unreleased"`,
      );
    }
    assert.match(
      note,
      declaresReleased ? /\*\*State:\*\*\s*Released/i : /Released/i,
      `${notePath} must state the current release is Released`,
    );
  } else {
    assert.doesNotMatch(
      note,
      /\*\*State:\*\*\s*Released/i,
      `${notePath} declares Unreleased but also claims Released`,
    );
  }
});

test("a published current release note carries the tag, asset, and source commit", () => {
  const version = JSON.parse(read("package.json")).version;
  const note = read(`docs/releases/${version}.md`);
  const declaresUnreleased = /\*\*State:\*\*\s*Unreleased/i.test(note);
  if (declaresUnreleased) return; // honest pre-publication note: nothing required here

  assert.match(note, new RegExp(`v${version.replace(/\./g, "\\.")}`), "note must name the tag");
  assert.match(note, /TownReporter-[0-9.]+-windows-x64\.zip/, "note must name the Windows asset");
  assert.match(note, /[a-f0-9]{40}/, "note must name a 40-char source commit");
});

test("the 0.6.60 record distinguishes its audited candidate from the released merge", () => {
  const note = read("docs/releases/0.6.60.md");
  assert.match(note, /Audited source candidate:\*\*\s*`69db1d0802b8e78853b5bbd393324bf0d710de12`/);
  assert.match(note, /Released merge commit and tag target:\*\*\s*`e97db885364a09db6914371e53a7c3a961cd9c23`/);
  assert.match(note, /TownReporter-0\.6\.60-windows-x64\.zip\.sha256/);
  assert.doesNotMatch(note, /\b[a-f0-9]{64}\b/i, "the release note must defer to the sidecar instead of self-embedding the ZIP hash");
  assert.doesNotMatch(note, /No release, tag, GitHub publication[^\n]*is asserted here/i);
  for (const file of ["CHANGELOG.md", "SELF-HOSTING.md", "docs/editor.md", "docs/setup.md"]) {
    const current = read(file).split(/\r?\n/).slice(0, 16).join("\n");
    assert.doesNotMatch(current, /unverified GitHub|does not assert GitHub|does not assert a Git tag/i, `${file} denies the published 0.6.60 release`);
  }
});

test("the retired Opinion-only environment override is not advertised", () => {
  assert.doesNotMatch(read(".env.example"), /TOWNREPORTER_EDITORIAL_MODEL/);
  const modelChoice = read("src/lib/news/model-choice.ts");
  assert.match(modelChoice, /DEFAULT_OPINION_MODEL\s*=\s*"codex-frontier"/);
  assert.match(modelChoice, /OPINION_AUTOMATIC_LADDER\s*=\s*\["codex-frontier",\s*"claude-sonnet"\]/);
});

/*
  Historical entries are legitimate: README's "Recent releases" list keeps an
  older release's "does not assert GitHub publication" line, and dated records
  elsewhere say the same about the releases they describe. This guard must
  therefore look ONLY at the current-release statement, never the whole file.

  For each file we take the line that names the CURRENT version (0.6.54 today),
  plus its release-note link context, and deny pre-publication wording there.
*/
test("the current-release statement in README, TODO, and the Windows guide does not deny publication", () => {
  const version = JSON.parse(read("package.json")).version;
  const currentLink = `docs/releases/${version}.md`;
  for (const file of ["README.md", "TODO.md", "docs/windows-install.md"]) {
    const lines = read(file).split(/\r?\n/);
    // The current-release statement is the line that links the current note or
    // names the current version as the release. Take the first such line.
    const relLink = `releases/${version}.md`;
    const idx = lines.findIndex(
      (line) =>
        line.includes(currentLink) ||
        line.includes(relLink) ||
        new RegExp(`release is \\[?${version.replace(/\./g, "\\.")}`).test(line),
    );
    assert.ok(idx >= 0, `${file} has no current-release line for ${version}`);
    // Look at the current-release statement and the next few lines, so a
    // multi-line paragraph is covered without sweeping historical entries.
    const context = lines.slice(idx, idx + 6).join("\n");
    assert.doesNotMatch(
      context,
      /not created by this commit/i,
      `${file}'s current-release statement says the release was "not created by this commit"`,
    );
    assert.doesNotMatch(
      context,
      /does not assert (a )?GitHub (publication|release)/i,
      `${file}'s current-release statement denies GitHub publication`,
    );
  }
});
