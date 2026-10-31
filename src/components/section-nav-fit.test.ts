import assert from "node:assert/strict";
import test from "node:test";
import { fitSectionCount } from "./section-nav-fit.ts";

test("the section fit keeps every link only when About also fits", () => {
  assert.equal(
    fitSectionCount({
      room: 440,
      widths: [100, 100, 100],
      gap: 20,
      more: 120,
      about: 60,
    }),
    3,
  );
});

test("the section fit reserves More before cutting a link", () => {
  assert.equal(
    fitSectionCount({
      room: 400,
      widths: [120, 120, 120],
      gap: 20,
      more: 130,
      about: 80,
    }),
    1,
  );
});

test("About alone can force the last section under More", () => {
  assert.equal(
    fitSectionCount({
      room: 400,
      widths: [100, 100, 100],
      gap: 20,
      more: 120,
      about: 60,
    }),
    1,
  );
});