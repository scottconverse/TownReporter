import { it } from "node:test";
import assert from "node:assert/strict";
import { DESK_NAV, navItemIsActive } from "./desk-nav.ts";

it("opens the real Models page and selects one menu item for each destination", () => {
  assert.equal(DESK_NAV.find((item) => item.label === "Models")?.to, "/desk/models");
  for (const [path, hash, label] of [
    ["/desk/models", "", "Models"],
    ["/desk/ops", "#writing-models", "Server"],
    ["/desk/ops", "", "Server"],
    ["/desk/ops/writing-models", "", "Server"],
  ]) {
    assert.deepEqual(
      DESK_NAV.filter((item) => navItemIsActive(item, path!, hash!)).map((item) => item.label),
      [label],
    );
  }
});
