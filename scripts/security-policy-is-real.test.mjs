import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

/**
 * The security policy must name a route that actually exists.
 *
 * SECURITY.md shipped with a literal placeholder where the reporting address
 * belonged: `<security contact address - maintainer to fill in>`. A gate audit
 * caught it on a product already live at townreporter.org. That is worse than
 * having no address at all, because it reads as a channel and is not one, and
 * somebody holding a real vulnerability believes they have somewhere to send it.
 *
 * The repository now relies on GitHub's private vulnerability reporting, which
 * has the property an inbox does not: nobody has to remember to check it. The
 * risk in depending on a setting is that a setting can be turned off, quietly,
 * while the document keeps pointing at it. That is what the second test is for.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const POLICY = readFileSync(join(ROOT, "SECURITY.md"), "utf8");

test("the security policy contains no placeholder pretending to be a channel", () => {
  // An angle-bracketed span with prose inside it is the shape of a fill-me-in
  // that got shipped. A real address, a URL or a code span is not.
  const placeholders = [...POLICY.matchAll(/<[^>@\n]*\b(?:fill|TODO|TBD|maintainer|your)\b[^>\n]*>/gi)].map(
    (m) => m[0],
  );
  assert.deepEqual(
    placeholders,
    [],
    `SECURITY.md still carries an unfilled placeholder: ${placeholders.join(", ")}`,
  );
});

test("the reporting route the policy names is GitHub's, not an inbox it invented", () => {
  assert.match(
    POLICY,
    /private vulnerability reporting/i,
    "the policy no longer names GitHub's private vulnerability reporting",
  );
  // An email address here would mean the route changed and this test, plus the
  // paragraph explaining why there is no address, are now both wrong.
  const emails = [...POLICY.matchAll(/[\w.+-]+@[\w-]+\.[\w.]+/g)]
    .map((m) => m[0])
    // The tip line is named specifically to say it is NOT a security channel.
    .filter((e) => e !== "tips@townreporter.org");
  assert.deepEqual(
    emails,
    [],
    `SECURITY.md now publishes an address (${emails.join(", ")}); if that is deliberate, ` +
      `update the paragraph that says there deliberately is not one`,
  );
});

/**
 * The setting behind the promise, checked for real where it can be.
 *
 * This needs an authenticated GitHub CLI, which a fresh clone will not have, so
 * it skips rather than fails there - and says why. On a machine that can check,
 * it is the difference between a document that claims a route and a route that
 * is open.
 */
function reportingEnabled() {
  try {
    const out = execFileSync(
      "gh",
      ["api", "repos/scottconverse/TownReporter/private-vulnerability-reporting"],
      { encoding: "utf8", timeout: 20_000, stdio: ["ignore", "pipe", "ignore"] },
    );
    return JSON.parse(out)?.enabled === true;
  } catch {
    return null;
  }
}

const enabled = reportingEnabled();
test(
  "GitHub private vulnerability reporting is actually switched on",
  {
    skip:
      enabled === null
        ? "no authenticated GitHub CLI here, so the live setting cannot be checked"
        : false,
  },
  () => {
    assert.equal(
      enabled,
      true,
      "SECURITY.md tells people to report through GitHub's private vulnerability " +
        "reporting, and that setting is switched off on this repository",
    );
  },
);
