import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { SOURCE_ZIP_TAG, SOURCE_ZIP_URL, SOURCE_ZIP_BACKUP } from "./source-zip-url.ts";
import { APP_VERSION } from "./version.ts";

/**
 * The download link must name the version the app claims to be.
 *
 * It was a hand-written string pointing at v0.5.0 while the paper, the README
 * and the changelog all said 0.5.1 — so "get the code" quietly handed people
 * the previous release. Audit finding TW-002.
 */
describe("the source download names this release", () => {
  it("matches APP_VERSION", () => {
    assert.equal(SOURCE_ZIP_TAG, `v${APP_VERSION}`);
    assert.ok(SOURCE_ZIP_URL.includes(`/tags/v${APP_VERSION}.zip`), SOURCE_ZIP_URL);
  });

  it("matches package.json, so a version bump cannot leave it behind", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    );
    assert.equal(SOURCE_ZIP_TAG, `v${pkg.version}`);
  });

  it("keeps a fallback that exists even before the tag is cut", () => {
    assert.match(SOURCE_ZIP_BACKUP, /refs\/heads\/main\.zip$/);
  });
});
