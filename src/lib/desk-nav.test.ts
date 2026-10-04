import { describe, it } from "node:test";
import assert from "node:assert/strict";
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

describe("U24: the desk nav offers the Scan screen", () => {
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

  it("tells Models from Server on their own pages", () => {
    const models = DESK_NAV.find((item) => item.label === "Models")!;
    const server = DESK_NAV.find((item) => item.label === "Server")!;
    assert.equal(navItemIsActive(models, "/desk/models", ""), true);
    assert.equal(navItemIsActive(server, "/desk/ops", "#writing-models"), true);
    assert.equal(navItemIsActive(server, "/desk/ops", ""), true);
    assert.equal(navItemIsActive(models, "/desk/ops", ""), false);
  });

});
