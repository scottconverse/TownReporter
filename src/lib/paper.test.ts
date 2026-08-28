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
  it("stays in lockstep across the ship files, and Pages has no version stamp", () => {
    const root = new URL("../../", import.meta.url);
    const read = (rel: string) => readFileSync(new URL(rel, root), "utf8");
    const pkg = JSON.parse(read("package.json")) as { version: string; name: string };
    assert.equal(pkg.name, "app-builder-workspace");
    assert.equal(APP_VERSION, pkg.version);
    const lock = JSON.parse(read("package-lock.json")) as {
      packages: { "": { version: string } };
    };
    assert.equal(lock.packages[""].version, pkg.version);
    assert.ok(read("src/lib/source-zip-url.ts").includes("/tags/v" + pkg.version + ".zip"));
    assert.ok(read("CHANGELOG.md").includes("Current release: **" + pkg.version + "**"));
    assert.ok(read("README.md").includes("[" + pkg.version + "]"));
    assert.ok(read("docs/setup.md").includes("[" + pkg.version + "]"));
    assert.ok(read("docs/editor.md").includes("[" + pkg.version + "]"));
    assert.ok(read("docs/dark-desk-editor.md").includes(pkg.version));
    const pages = read("docs/index.html");
    assert.doesNotMatch(pages, /\bv?\d+\.\d+\.\d+\b/);
    assert.doesNotMatch(pages, /TownReporter \d/);
    assert.match(pages, /The Civic Desk/);
    assert.match(pages, /https:\/\/scottconverse\.github\.io\/CivicNewspaper\//);
    assert.doesNotMatch(pages, /Read the Longmont paper/);
  });
});
