import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DESK_MORE, DESK_NAV, DESK_PATHS, SEARCH_PAGES, navItemIsActive } from "./desk-nav.ts";

/**
 * R2: Scan history is reached from Sources & scan and the palette.
 *
 * THE FINDING. `/desk/scan` is the screen with the scope and the effort dials
 * -- General Scan over every accepted source, one section, or a picked set, on
 * an Automatic or a named writer. The nav item "Sources & scan" goes to
 * `/desk/sources`, which has a "Run scan now" button and none of those
 * controls. So the only way to the full Scan screen was Ctrl K, and the
 * stand-in editorial day found it that way and said so.
 *
 * The Sources header owns the visible route; it is not a side-menu item.
 */

const scanRouteSource = readFileSync(new URL("../routes/desk.scan.tsx", import.meta.url), "utf8");
const chromeSource = readFileSync(new URL("../components/desk-chrome.tsx", import.meta.url), "utf8");
const sourcesRouteSource = readFileSync(new URL("../routes/desk.sources.tsx", import.meta.url), "utf8");

describe("U24: the desk nav offers the Scan screen", () => {
  it("offers Scan history from the Sources header instead of the side menu", () => {
    const paths = DESK_NAV.map((item) => item.to);
    assert.ok(!paths.includes("/desk/scan"));
    assert.match(sourcesRouteSource, /className="btn quiet"[^>]*to="\/desk\/scan"/);
    assert.match(sourcesRouteSource, /Scan history/);
  });

  it("keeps Sources & scan in the side menu without a scan sub-item", () => {
    const subs = DESK_NAV.filter((item) => item.sub);
    assert.equal(subs.length, 0);
    const label = DESK_NAV.find((item) => item.to === "/desk/sources")?.label;
    assert.equal(label, "Sources & scan");
  });

  it("offers it exactly once, so the palette cannot list the same page twice", () => {
    const offered = SEARCH_PAGES.map((page) => page.to);
    assert.equal(
      offered.filter((to) => to === "/desk/scan").length,
      1,
      "DESK_NAV and DESK_MORE together build the palette; a page in both is offered twice",
    );
    assert.ok(
      DESK_MORE.some((item) => item.to === "/desk/scan"),
      "the palette still offers Scan history",
    );
    assert.equal(new Set(DESK_PATHS).size, DESK_PATHS.length, "no route is offered twice");
  });

  it("is the current item on /desk/scan, and not on /desk/sources", () => {
    const item = (to: string) => [...DESK_NAV, ...DESK_MORE].find((candidate) => candidate.to === to)!;
    assert.equal(navItemIsActive(item("/desk/scan"), "/desk/scan", ""), true);
    assert.equal(navItemIsActive(item("/desk/sources"), "/desk/scan", ""), false);
    assert.equal(navItemIsActive(item("/desk/scan"), "/desk/sources", ""), false);
    assert.equal(navItemIsActive(item("/desk/sources"), "/desk/sources", ""), true);
  });

  it("still tells Models from Server on the route they share", () => {
    const models = DESK_NAV.find((item) => item.label === "Models")!;
    const server = DESK_NAV.find((item) => item.label === "Server")!;
    assert.equal(navItemIsActive(models, "/desk/ops", "#writing-models"), true);
    assert.equal(navItemIsActive(server, "/desk/ops", "#writing-models"), false);
    assert.equal(navItemIsActive(server, "/desk/ops", ""), true);
    assert.equal(navItemIsActive(models, "/desk/ops", ""), false);
  });

  it("draws the sub-item class from the same flag the list carries", () => {
    /* The tripwire between the data and the shell: a list that grows a
       `sub: true` item while the drawer ignores the flag draws a twelfth
       destination that reads as a peer of the screen it sits under. */
    assert.match(chromeSource, /l\.sub \? " sub" : ""/);
    assert.match(chromeSource, /DESK_NAV\.map/);
  });

  it("points the item at the screen that actually has the controls", () => {
    /* Both halves of the finding: the URL is the Scan page, and the Scan page
       is where the scope select lives. */
    assert.match(scanRouteSource, /createFileRoute\("\/desk\/scan"\)/);
    assert.match(scanRouteSource, /Run scan/);
  });
});
