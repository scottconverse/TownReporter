import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("every shipped webfont carries its complete OFL notice", () => {
  const fraunces = read("licenses/fonts/Fraunces-OFL.txt");
  const sourceSerif = read("licenses/fonts/Source-Serif-4-OFL.txt");
  assert.match(fraunces, /Copyright 2018 The Fraunces Project Authors/);
  assert.match(sourceSerif, /Copyright 2014 The Source Serif 4 Project Authors/);
  for (const license of [fraunces, sourceSerif]) {
    assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/);
    assert.match(license, /PERMISSION & CONDITIONS/);
    assert.match(license, /TERMINATION/);
  }
});

test("third-party notices name both fonts and their packaged license paths", () => {
  const notices = read("THIRD_PARTY_NOTICES.md");
  assert.match(notices, /Fraunces-OFL\.txt/);
  assert.match(notices, /Source-Serif-4-OFL\.txt/);
  assert.match(notices, /SIL Open Font License 1\.1/g);
});

test("the Windows packager archives committed license files with the application", () => {
  const packager = read("scripts/package-windows.mjs");
  assert.match(packager, /git[\s\S]*archive/);
  assert.match(packager, /--prefix=TownReporter-/);
});
