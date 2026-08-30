import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * A reader-facing page may not promise a way to reach the paper that is not there.
 *
 * `/corrections` told readers: "To flag an error, write the editor from the
 * About page." `/about` carried no address, no form, and no contact of any
 * kind. An audit walked it and found the paper's accountability promise ending
 * at a wall -- next to its sibling, a story published with no sources under a
 * front page that says "Sources shown."
 *
 * Both are the same defect: a sentence printed with nothing behind it. On a
 * paper whose entire pitch is that a reader can check the work, that is not
 * cosmetic.
 *
 * The contact is now one build-time value, and every page that mentions writing
 * in renders only when it is set. This test holds that shape: a page may point
 * at a contact only if it is reading the same value the contact block reads.
 * Prose that names a route or a page as the way to get in touch, without that
 * value in scope, is the exact thing that failed.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ROUTES = join(ROOT, "src/routes");

/** Phrases that promise a reader a way to make contact. */
const PROMISES = [
  /write the editor/i,
  /contact the editor/i,
  /email the editor/i,
  /get in touch/i,
];

function readerFacingRoutes() {
  return readdirSync(ROUTES)
    .filter((f) => /\.tsx$/.test(f))
    // The desk is for the one editor, who does not need to be told how to
    // write to herself.
    .filter((f) => !f.startsWith("desk"))
    .map((f) => ({ file: f, src: readFileSync(join(ROUTES, f), "utf8") }));
}

test("no reader-facing page promises a contact it cannot show", () => {
  const offenders = [];
  for (const { file, src } of readerFacingRoutes()) {
    const promises = PROMISES.filter((re) => re.test(src));
    if (promises.length === 0) continue;
    if (!src.includes("EDITOR_EMAIL")) {
      offenders.push(
        `${file}: says "${src.match(promises[0])[0]}" but never reads EDITOR_EMAIL, ` +
          `so the promise is printed whether or not there is an address behind it`,
      );
    }
  }
  assert.deepEqual(offenders, [], offenders.join("\n"));
});

test("the contact is configurable, not shipped in the source", () => {
  const paper = readFileSync(join(ROOT, "src/lib/paper.ts"), "utf8");
  assert.match(paper, /EDITOR_EMAIL/, "the contact constant is gone");
  // A literal address here would land in every fork and every clone, pointing
  // strangers at one person's inbox.
  const decl = paper.slice(paper.indexOf("export const EDITOR_EMAIL"), paper.indexOf("export const EDITOR_EMAIL") + 300);
  assert.doesNotMatch(
    decl,
    /["'][^"']*@[^"']*\.[a-z]{2,}["']/i,
    "an email address is hard-coded into the source; it must come from configuration",
  );
});
