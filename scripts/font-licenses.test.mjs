import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("every shipped webfont carries its complete OFL notice", () => {
  // The desk still ships Bricolage and Literata; the Bulletin reader adds
  // Schibsted Grotesk, Source Serif 4 and JetBrains Mono. All five are
  // self-hosted and all five carry the same complete OFL text.
  const licenses = [
    read("licenses/fonts/Bricolage-Grotesque-OFL.txt"),
    read("licenses/fonts/Literata-OFL.txt"),
    read("licenses/fonts/schibsted-grotesk-OFL.txt"),
    read("licenses/fonts/source-serif-4-OFL.txt"),
    read("licenses/fonts/jetbrains-mono-OFL.txt"),
  ];
  assert.match(licenses[0], /Copyright 2022 The Bricolage Grotesque Project Authors/);
  assert.match(licenses[1], /Copyright 2017 The Literata Project Authors/);
  for (const license of licenses) {
    assert.match(license, /SIL OPEN FONT LICENSE Version 1\.1/);
    assert.match(license, /PERMISSION & CONDITIONS/);
    assert.match(license, /TERMINATION/);
  }
});

test("third-party notices name every font and its packaged license path", () => {
  const notices = read("THIRD_PARTY_NOTICES.md");
  for (const file of [
    "Bricolage-Grotesque-OFL.txt",
    "Literata-OFL.txt",
    "schibsted-grotesk-OFL.txt",
    "source-serif-4-OFL.txt",
    "jetbrains-mono-OFL.txt",
  ]) {
    assert.match(notices, new RegExp(file.replaceAll(".", "\\.")));
  }
  assert.match(notices, /SIL Open Font License 1\.1/g);
});

test("the reader uses the Bulletin faces and the desk keeps its own", () => {
  const shipped = [
    "src/fonts.css",
    "src/styles.css",
    "src/desk-astra.css",
    "src/reader-astra.css",
    "scripts/fetch-fonts.mjs",
    "docs/index.html",
  ];
  for (const path of shipped) {
    assert.doesNotMatch(read(path), /Fraunces/i, `${path} still names Fraunces`);
  }
  const sheet = read("src/fonts.css");
  const families = new Set([...sheet.matchAll(/font-family:\s*'([^']+)'/g)].map((m) => m[1]));
  assert.deepEqual([...families].sort(), [
    "Bricolage Grotesque",
    "JetBrains Mono",
    "Literata",
    "Schibsted Grotesk",
    "Source Serif 4",
  ]);
  const readerRules = read("src/reader-astra.css").replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(readerRules, /Bricolage|Literata/i, "reader-astra.css still asks for a desk face");
  assert.match(readerRules, /Schibsted Grotesk/);
  assert.match(readerRules, /Source Serif 4/);
  assert.match(readerRules, /JetBrains Mono/);
});

test("the Windows packager archives committed license files with the application", () => {
  const packager = read("scripts/package-windows.mjs");
  assert.match(packager, /git[\s\S]*archive/);
  assert.match(packager, /--prefix=TownReporter-/);
});
