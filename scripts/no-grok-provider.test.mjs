import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

/**
 * Grok (xAI) is not a provider any more, and this is the test that keeps it
 * that way.
 *
 * GR-C removed Grok as a writing model: the SuperGrok OAuth connection
 * (`xai-oauth.server.ts`, its card, its table), the `xai-oauth` provider kind
 * and the `grok-oauth` registry entry, and the `XAI_API_KEY` gateway that
 * `resolveLlm()` used to fall back to. Every one of those was reachable from a
 * settings screen or an environment file, so every one of them can be added
 * back by a single well-meaning edit -- "just one more rung", "just the key
 * people already have". A sweep with no gate behind it is a sweep that gets
 * undone quietly, and the operator's decision (D12: remove Grok entirely) is
 * the thing that would be undone.
 *
 * WHAT IS FORBIDDEN. The provider's own names and the env keys that configured
 * it, on any line of shipped source. A NAME has to stay legal -- an install
 * that chose Grok before this release still holds the string `grok-oauth` in
 * `desk_jobs.model_choice`, `model_assignments.provider_id`, draft batches and
 * page-watch rows, and those rows must keep loading -- but a name is all it is:
 * `RETIRED_PROVIDER_IDS` in the registry and the note an editor reads. Those
 * two are the entire allow-list, and the second test here proves they are still
 * there, so the guard cannot be satisfied by deleting the retirement.
 *
 * WHAT IS NOT SCANNED, and why. Test files under `src/**`. A test that stores
 * `grok-oauth` in a row and asserts it loads as Automatic is the PROOF that the
 * retirement is honest, not a reintroduction of the provider -- forbidding the
 * string there would forbid the promise this unit exists to keep. Test files
 * are also where `xai-oauth` legitimately appears as the transport name on a
 * snapshot written by an older build, which `forced-runtime.test.ts` and
 * `daily-scan.execution.test.ts` assert is refused rather than run. Every other
 * file under `src/**` is shipped code and is scanned.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * What must not come back, and what each one would mean if it did.
 *
 * `SuperGrok` rather than `Grok`: the bare word is all over this repository as
 * history (`grokChat`, the first commit's "Export from Grok", past CHANGELOG
 * entries) and a guard that cried wolf about those would be turned off within a
 * week. `SuperGrok` is the connection's own name, and it is what a re-added
 * picker entry or settings card would carry.
 */
const FORBIDDEN = [
  { token: "xai-oauth", why: "the removed provider kind and its transport" },
  { token: "xaiGateway", why: "the removed XAI_API_KEY fallback resolver" },
  { token: "api.x.ai", why: "the removed provider's endpoint" },
  { token: "grok-oauth", why: "the removed registry entry" },
  { token: "SuperGrok", why: "the removed SuperGrok connection" },
  { token: "xai_oauth_connections", why: "the dropped credential table" },
  { token: "XAI_API_KEY", why: "the ignored fallback key" },
  { token: "GROK_API_KEY", why: "the ignored fallback key's alias" },
  { token: "XAI_MODEL", why: "the removed fallback's model override" },
  { token: "XAI_BASE_URL", why: "the removed fallback's base-URL override" },
  { token: "TOWNREPORTER_GROK_OAUTH", why: "the removed connection's off-switch" },
];

/**
 * The only places in shipped source a forbidden name may appear.
 *
 * Both are the retirement itself: the constant that keeps a stored id inside
 * `ProviderId` so every reader of a stored value still compiles and runs, and
 * the one sentence that tells an editor which choice went away. Neither is
 * reachable as a provider -- `providerEntry()` answers null for the id and
 * `providersFor()` can never offer it -- which is what makes them safe to allow
 * while the names around them are not.
 */
const ALLOWED = [
  {
    file: "src/lib/news/provider-registry.ts",
    token: "grok-oauth",
    why: "RETIRED_PROVIDER_IDS -- the stored id that must keep loading",
  },
  {
    file: "src/lib/news/model-choice.ts",
    token: "SuperGrok",
    why: "retiredModelChoiceNote -- the sentence an editor reads",
  },
];

/**
 * Every shipped source file under `src/`, minus the test files explained above.
 *
 * `--cached --others --exclude-standard` as well as tracked files, so a file
 * that is written but not staged is already covered: the `no-hardcoded-domain`
 * gate learned that the hard way when a mutation inside an uncommitted new
 * route sailed through. `existsSync` drops an index entry whose file is deleted
 * in the working tree -- a staged-then-deleted file is not source.
 */
function scannedFiles() {
  const out = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "src"],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return out
    .split("\n")
    .map((file) => file.trim())
    .filter(Boolean)
    .filter((file) => /\.(ts|tsx)$/.test(file))
    .filter((file) => !/\.test\.(ts|tsx)$/.test(file))
    .filter((file) => existsSync(join(ROOT, file)));
}

/**
 * The same text with the prose taken out.
 *
 * A comment that explains the removal -- "this used to fall back to an
 * `XAI_API_KEY` gateway", "the removed SuperGrok sign-in" -- is documentation
 * of the change, and a guard that failed on it would be forcing the reasoning
 * to be deleted to stay green. So block comments are blanked (newlines kept, so
 * line numbers still point at the real line) and a `//` comment is cut.
 *
 * The line-comment rule deliberately does not fire on `://`. The first version
 * of this function cut at any `//`, which turned
 * `const url = "https://api.x.ai/v1"` into `const url = "https:` -- the
 * reintroduced endpoint would have been invisible to the gate, which is the one
 * failure a guard must not have.
 */
function codeOnly(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "))
    .split(/\r?\n/)
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, "$1"))
    .join("\n");
}

function isAllowed(file, token) {
  return ALLOWED.some((entry) => entry.file === file && entry.token.toLowerCase() === token.toLowerCase());
}

test("no shipped source file names a Grok (xAI) provider, transport or key", () => {
  const offenders = [];
  for (const file of scannedFiles()) {
    const code = codeOnly(readFileSync(join(ROOT, file), "utf8"));
    code.split(/\r?\n/).forEach((line, index) => {
      for (const { token } of FORBIDDEN) {
        if (!line.toLowerCase().includes(token.toLowerCase())) continue;
        if (isAllowed(file, token)) continue;
        offenders.push(`${file}:${index + 1}  [${token}]  ${line.trim().slice(0, 100)}`);
      }
    });
  }
  assert.deepEqual(
    offenders,
    [],
    "Grok (xAI) was removed as a provider; these lines name it again in shipped " +
      "code. A stored `grok-oauth` must keep LOADING (that is what the " +
      "RETIRED_PROVIDER_IDS constant and the removal note are for), but nothing " +
      "may offer, resolve or call it, and no XAI_* key may come back:\n  " +
      offenders.join("\n  "),
  );
});

test("the allow-list is still real code, not a stale exemption", () => {
  /*
    Without this, the guard above could be kept green by deleting the two things
    it exempts -- and deleting them is exactly what would break an install that
    chose Grok. An exemption that no longer matches anything is a hole, so each
    one has to name a line that is actually there.
  */
  const registry = readFileSync(join(ROOT, "src/lib/news/provider-registry.ts"), "utf8");
  assert.match(
    registry,
    /^export const RETIRED_PROVIDER_IDS = \["grok-oauth"\] as const;$/m,
    "the retired-id list is what keeps a stored id admitted into ProviderId; " +
      "removing it breaks every reader of a stored `grok-oauth`",
  );
  assert.match(
    registry,
    /export type RetiredProviderId = \(typeof RETIRED_PROVIDER_IDS\)\[number\];/,
    "the retired id must stay a type, so stored-value readers keep compiling",
  );

  const choice = readFileSync(join(ROOT, "src/lib/news/model-choice.ts"), "utf8");
  assert.match(
    choice,
    /if \(!\(RETIRED_PROVIDER_IDS as readonly string\[\]\)\.includes\(value\)\) return null;/,
    "retiredModelChoiceNote must key off the retired-id list, so a future " +
      "retirement gets the same note without this function being edited",
  );
  assert.match(
    choice,
    /has been removed from TownReporter, so this falls back to Automatic/,
    "the note must still say the provider was REMOVED -- an editor whose model " +
      "stopped working reads this sentence",
  );
});
