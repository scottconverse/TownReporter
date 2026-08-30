import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findVoiceFile, assertNotAnArgument, VOICE_ENV } from "./voice.server.ts";

/**
 * The private voice must never reach a command line. Executable contract.
 *
 * The operator's editorial voice is ~98 KB of writing developed over months.
 * It is deliberately outside this public repository, and the mechanism that
 * keeps it private is narrow: `voice.server.ts` returns a PATH, and the CLI is
 * invoked with `--system-prompt-file` so it opens the file itself.
 *
 * If that ever became `--system-prompt <contents>`, the whole file would be an
 * argv entry — readable by every process on the machine, and over Windows'
 * 32,767-character argument limit besides. Another agent shares this box.
 *
 * An audit noted the boundary was sound but had no executable contract
 * (TE-03). Prose in a comment is not a contract. These assertions are.
 *
 * The last test in this file used to assert only that the STRINGS `isAbsolute`
 * and `process.cwd`/`cwd()` appeared somewhere in voice.server.ts. That is
 * satisfied by the module's own top-level `import { isAbsolute, ... }` line —
 * which stayed present after the actual relative-path refusal branch was cut
 * — so the check went green while the refusal it claimed to guard no longer
 * existed. Worse, the same green run coincided with the real voice file being
 * read and put on a command line, the exact thing this boundary exists to
 * stop. `voice.server.ts` has no framework imports and no TanStack `@/`
 * aliases (only `node:fs/promises` and `node:path`), so unlike the other
 * three files this repo's TS files usually need a real build to exercise, it
 * is directly importable here — there is no excuse left for text matching.
 * This version calls `findVoiceFile()` for real, against real relative,
 * in-repo, and outside-repo paths, and reads its actual verdict.
 */

const repoRoot = new URL("../../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const originalEnv = process.env[VOICE_ENV];
const scratchFiles: string[] = [];

after(() => {
  if (originalEnv === undefined) delete process.env[VOICE_ENV];
  else process.env[VOICE_ENV] = originalEnv;
  for (const f of scratchFiles) {
    try {
      rmSync(f, { force: true });
    } catch {
      /* best effort */
    }
  }
});

describe("the voice never becomes a command-line argument", () => {
  it("refuses a relative path outright", async () => {
    process.env[VOICE_ENV] = "some/relative/voice.txt";
    const result = await findVoiceFile();
    assert.equal(result.ok, false, "a relative path was accepted");
    if (!result.ok) assert.match(result.error, /must be an absolute path/i);
  });

  it("the voice file is not in this repository and cannot be", async () => {
    // A real, absolute, in-repo path: package.json, right here in the
    // checkout. If the containment check were ever weakened or deleted (the
    // exact defect this test exists to catch), this is accepted instead of
    // refused, and `voice.path` below would point straight into the public
    // repo the boundary is supposed to keep it out of.
    process.env[VOICE_ENV] = join(repoRoot, "package.json");
    const result = await findVoiceFile();
    assert.equal(
      result.ok,
      false,
      "an absolute path INSIDE this repository was accepted -- the containment refusal is gone",
    );
    if (!result.ok) assert.match(result.error, /inside this repository/i);
  });

  it("accepts a real path outside the repository, and returns nothing but a path and a byte count", async () => {
    const outside = join(tmpdir(), `voice-boundary-probe-${process.pid}-${Date.now()}.txt`);
    scratchFiles.push(outside);
    // Must clear the 500-byte "looks empty or truncated" floor.
    writeFileSync(outside, "the operator's editorial voice, in prose. ".repeat(30));

    process.env[VOICE_ENV] = outside;
    const result = await findVoiceFile();
    assert.equal(result.ok, true, `a legitimate outside-repo voice file was refused: ${JSON.stringify(result)}`);
    if (result.ok) {
      assert.equal(typeof result.voice.path, "string");
      assert.ok(result.voice.bytes >= 500);
      // The one property this whole module exists to guarantee: nothing but
      // a location ever comes back. A `contents`, `text`, or `body` field
      // here -- under any name -- is the leak this boundary is for.
      assert.deepEqual(
        Object.keys(result.voice).sort(),
        ["bytes", "path"],
        "findVoiceFile returned more than a path and a byte count -- it must never carry the file's contents",
      );
    }
  });

  it("refuses to inline anything long enough to be a voice file", () => {
    // Pure function, cheap to call directly rather than grep for its name.
    assert.throws(() => assertNotAnArgument("x".repeat(8001)), /Refusing to pass/);
    assert.doesNotThrow(() => assertNotAnArgument("a short, ordinary system prompt"));
  });

  /*
    The remaining two properties live in ai-claude-code.server.ts and
    editorial.server.ts, both of which spawn the real `claude` CLI as a child
    process (ai-claude-code.server.ts) or hit the database on import chains
    that are not worth pulling into a unit test here. Exercising them for
    real means mocking a process spawn, which is a legitimate next step but a
    separate piece of work from the containment defect this file was written
    to catch. Left as source-shape checks, each anchored to a specific
    control-flow relationship (a flag appearing within a bounded window of
    the branch that selects it) rather than a bare substring, so a comment or
    an unrelated mention elsewhere in the file cannot satisfy them.
  */
  it("the CLI adapter passes a path, never the prompt text, when a file is given", () => {
    const src = readFileSync(new URL("./ai-claude-code.server.ts", import.meta.url), "utf8");
    assert.match(src, /"--system-prompt-file"/, "the file flag must exist");
    assert.match(
      src,
      /usingFile[\s\S]{0,200}--system-prompt-file/,
      "supplying a file must select the file flag",
    );
  });

  it("the editorial writer hands over a path and never the text", () => {
    const src = readFileSync(new URL("./editorial.server.ts", import.meta.url), "utf8");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.match(code, /systemPromptFile:\s*found\.voice\.path/, "it must pass the path");
    assert.match(code, /system:\s*""/, "the inline system prompt must be empty");
    assert.doesNotMatch(
      code,
      /readFileSync|readFile\(/,
      "the editorial writer must never open the voice file itself",
    );
  });
});
