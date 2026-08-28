import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { formatDate, formatDateTime, formatShortDate } from "./paper.ts";
import { APP_VERSION } from "./version.ts";

describe("Longmont dates", () => {
  it("prints the masthead in America/Denver, not UTC", () => {
    // 8:10pm Wednesday MDT is already Thursday in UTC.
    assert.equal(formatDate("2026-08-27T02:10:00.000Z"), "Wednesday, August 26, 2026");
  });

  it("keeps short dates and datetimes on Mountain Time", () => {
    assert.equal(formatShortDate("2026-08-27T02:10:00.000Z"), "Aug 26, 2026");
    assert.match(formatDateTime("2026-08-27T02:10:00.000Z"), /Aug 26, 2026, 8:10 PM/);
  });
});

describe("version", () => {
  it("matches package.json so the chrome and the tag cannot drift", () => {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
      version: string;
    };
    assert.equal(APP_VERSION, pkg.version);
  });

  it("keeps 0.4.3 in lockstep files and off the Pages landing", () => {
    const root = new URL("../../", import.meta.url);
    const files = [
      "package.json",
      "package-lock.json",
      "src/lib/version.ts",
      "src/lib/source-zip-url.ts",
      "CHANGELOG.md",
      "README.md",
      "docs/setup.md",
      "docs/editor.md",
      "docs/dark-desk-editor.md",
    ];
    for (const rel of files) {
      const text = readFileSync(new URL(rel, root), "utf8");
      assert.match(text, /0\.4\.3/, rel);
    }
    const pages = readFileSync(new URL("docs/index.html", root), "utf8");
    assert.doesNotMatch(pages, /v0\.3\.9/);
    assert.doesNotMatch(pages, /TownReporter 0\.\d/);
    assert.doesNotMatch(pages, /0\.4\.[0-9]/);
    assert.match(pages, /The Civic Desk/);
    assert.match(pages, /https:\/\/scottconverse\.github\.io\/CivicNewspaper\//);
    assert.doesNotMatch(pages, /Read the Longmont paper/);
  });
});
