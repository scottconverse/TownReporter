import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("every shipped webfont carries its complete OFL notice", () => {
  // The families the redesign's tokens name (tokens/fonts.css:2): Bricolage
  // Grotesque for the talking, Literata for the reading. The copyright line is
  // the one thing that changes between two OFL files, so it is asserted
  // verbatim; the rest of the body has to be the standard licence.
  const bricolage = read("licenses/fonts/Bricolage-Grotesque-OFL.txt");
  const literata = read("licenses/fonts/Literata-OFL.txt");
  assert.match(bricolage, /Copyright 2022 The Bricolage Grotesque Project Authors/);
  assert.match(literata, /Copyright 2017 The Literata Project Authors/);
  for (const license of [bricolage, literata]) {
    assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/);
    assert.match(license, /PERMISSION & CONDITIONS/);
    assert.match(license, /TERMINATION/);
  }
});

test("third-party notices name both fonts and their packaged license paths", () => {
  const notices = read("THIRD_PARTY_NOTICES.md");
  assert.match(notices, /Bricolage-Grotesque-OFL\.txt/);
  assert.match(notices, /Literata-OFL\.txt/);
  assert.match(notices, /SIL Open Font License 1\.1/g);
});

test("nothing shipped still names the fonts the redesign replaced", () => {
  // Fraunces and Source Serif 4 were the pre-redesign faces. Their files are
  // gone (public/fonts, licenses/fonts) and nothing in the app or its font
  // pipeline may still ask for them, or a fallback face would silently render
  // in the shipped product. docs/design/ is the handoff package itself and
  // docs/releases/ is history, so both are out of this check by design.
  const shipped = [
    "src/fonts.css",
    "src/styles.css",
    "src/desk-astra.css",
    "src/reader-astra.css",
    "scripts/fetch-fonts.mjs",
    "docs/index.html",
  ];
  for (const path of shipped) {
    const text = read(path);
    assert.doesNotMatch(text, /Fraunces/i, `${path} still names Fraunces`);
    assert.doesNotMatch(text, /Source Serif/i, `${path} still names Source Serif 4`);
  }
  // And the @font-face sheet is the two new families, nothing else.
  const sheet = read("src/fonts.css");
  const families = new Set([...sheet.matchAll(/font-family:\s*'([^']+)'/g)].map((m) => m[1]));
  assert.deepEqual([...families].sort(), ["Bricolage Grotesque", "Literata"]);
});

test("the Windows packager archives committed license files with the application", () => {
  const packager = read("scripts/package-windows.mjs");
  assert.match(packager, /git[\s\S]*archive/);
  assert.match(packager, /--prefix=TownReporter-/);
});
