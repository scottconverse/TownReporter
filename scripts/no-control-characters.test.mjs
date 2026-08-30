import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

/**
 * No source file may contain a raw control character.
 *
 * This is the gate for a defect that shipped. Six regexes in the ops health
 * check were written as `\b` word boundaries and reached disk as literal
 * backspace bytes (0x08), because the edit was made through a shell that ate
 * one level of escaping. No HTML contains a backspace, so the patterns could
 * never match, and the "Reader privacy" row reported "no outside requests"
 * unconditionally -- a gauge that could only ever say "fine".
 *
 * It survived a typecheck, 534 tests and a browser walk, because a control
 * character inside a regex is valid TypeScript and valid JavaScript. Nothing
 * was looking. Now something is.
 *
 * The same mangling produced a literal newline in a test file earlier in the
 * same session, which at least failed to parse. This one did not, and that is
 * exactly why it needs a gate rather than a resolution to be careful.
 */
const ALLOWED = new Set([9, 10, 13]); // tab, LF, CR

function tracked() {
    /*
    Untracked files count too.

    The first version listed only tracked files. A brand new test file -- the
    one written to gate this very defect -- picked up a literal backspace in a
    regex on its way to disk, and this gate passed, because git had never seen
    the file. A check that only inspects what is already committed cannot catch
    the mistake at the moment it is made, which is the only moment that helps.

    --others --exclude-standard adds untracked files while still honouring
    .gitignore, so node_modules and build output stay out.
  */
  const out = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "src", "scripts", "migrations", "ops"],
    {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  return out
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean)
    .filter((f) => /\.(ts|tsx|mjs|js|sql|ps1|cmd|vbs|css|json)$/.test(f));
}

test("no source file carries a raw control character", () => {
  const offences = [];
  for (const file of tracked()) {
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    let line = 1;
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code === 10) line += 1;
      if (code < 32 && !ALLOWED.has(code)) {
        offences.push(
          `${file}:${line} contains U+${code.toString(16).padStart(4, "0").toUpperCase()} ` +
            `(${JSON.stringify(text.slice(Math.max(0, i - 30), i + 10))})`,
        );
      }
    }
  }
  assert.deepEqual(
    offences,
    [],
    `A control character in source is almost always a mangled escape -- \b, \t or \n ` +
      `that lost a backslash on its way to disk:\n  ${offences.join("\n  ")}`,
  );
});
