import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("the voice never becomes a command-line argument", () => {
  it("voice.server never returns file contents", () => {
    const src = read("./voice.server.ts");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const reader of ["readFile", "readFileSync", "createReadStream"]) {
      assert.ok(
        !code.includes(`${reader}(`),
        `voice.server must not read the file — it returns a path (found ${reader})`,
      );
    }
  });

  it("the CLI adapter passes a path, never the prompt text, when a file is given", () => {
    const src = read("./ai-claude-code.server.ts");
    assert.match(src, /"--system-prompt-file"/, "the file flag must exist");
    // The inline flag may still exist for ordinary desk calls, but the file
    // path must be chosen whenever a systemPromptFile was supplied.
    assert.match(
      src,
      /usingFile[\s\S]{0,200}--system-prompt-file/,
      "supplying a file must select the file flag",
    );
  });

  it("refuses to inline anything long enough to be a voice file", () => {
    const src = read("./ai-claude-code.server.ts");
    assert.match(
      src,
      /assertNotAnArgument\(/,
      "an inline system prompt must pass the length refusal",
    );
    const voice = read("./voice.server.ts");
    assert.match(voice, /export function assertNotAnArgument/, "the refusal must live with the voice rules");
  });

  it("the editorial writer hands over a path and never the text", () => {
    const src = read("./editorial.server.ts");
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.match(code, /systemPromptFile:\s*found\.voice\.path/, "it must pass the path");
    assert.match(code, /system:\s*""/, "the inline system prompt must be empty");
    assert.doesNotMatch(
      code,
      /readFileSync|readFile\(/,
      "the editorial writer must never open the voice file itself",
    );
  });

  it("the voice file is not in this repository and cannot be", () => {
    const voice = read("./voice.server.ts");
    assert.match(voice, /isAbsolute/, "a relative path must be refused");
    assert.match(voice, /cwd\(\)|repoRoot|process\.cwd/, "an in-repo path must be refused");
  });
});
