/*
  The mark a reader's home screen shows.

  `public/__app/icon-180.png` is served as the apple-touch-icon
  (`appChromeHeadTags`, `src/routes/__root.tsx`) and is the web manifest's only
  icon (`renderWebManifest`). It used to be the Grok App Builder's own mark --
  a near-black field carrying the builder's sparkle -- so installing a
  self-hosted paper put another product's logo on the reader's home screen.
  It is now the newspaper's own mark, rendered from `public/favicon.svg` (the
  masthead "T" on the cream field) by `scripts/generate-app-icon.mjs`.

  These checks are deliberately about the image, not about a re-render being
  byte-identical: `@napi-rs/canvas` is a native binding, and pinning its PNG
  encoder's exact output across operating systems and architectures would fail
  CI for a reason that has nothing to do with the mark. The palette check ties
  the committed file to `favicon.svg` instead, which is what a drifting icon
  would actually break.
*/
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ICON_PATH = join(root, "public", "__app", "icon-180.png");
const FAVICON_PATH = join(root, "public", "favicon.svg");

/** apple-touch-icon size, and the size the web manifest declares. */
const ICON_SIZE = 180;

/**
 * SHA-256 of the Grok App Builder mark this file replaced (measured
 * 2026-09-30 at the commit before it was regenerated). A revert to the
 * scaffold icon is a reader-visible branding defect, so it fails here.
 */
const SCAFFOLD_ICON_SHA256 = "3cf5d17d294b51c6cca6c86070309b88554b7ad702b0412e8e2709a01990bc8a";

/** The scaffold mark's palette: a near-black field and a dark grey glyph. */
const SCAFFOLD_PALETTE = [
  [15, 15, 15],
  [46, 46, 46],
];

const readPng = () => readFileSync(ICON_PATH);

/** The colours `public/favicon.svg` paints with, as [r, g, b] triples. */
function faviconPalette() {
  const svg = readFileSync(FAVICON_PATH, "utf8");
  const colours = new Map();
  for (const match of svg.matchAll(/fill="(#([0-9a-fA-F]{6}))"/g)) {
    const hex = match[2].toLowerCase();
    colours.set(hex, [
      Number.parseInt(hex.slice(0, 2), 16),
      Number.parseInt(hex.slice(2, 4), 16),
      Number.parseInt(hex.slice(4, 6), 16),
    ]);
  }
  assert.ok(colours.size >= 2, `favicon.svg declares a palette (${colours.size} colours)`);
  return [...colours.values()];
}

/** How many pixels of the icon sit within `tolerance` of `colour`, per channel. */
async function pixelsNear(colour, tolerance) {
  const image = await loadImage(readPng());
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, image.width, image.height).data;
  let count = 0;
  for (let at = 0; at < data.length; at += 4) {
    if (
      Math.abs(data[at] - colour[0]) <= tolerance &&
      Math.abs(data[at + 1] - colour[1]) <= tolerance &&
      Math.abs(data[at + 2] - colour[2]) <= tolerance &&
      data[at + 3] === 255
    ) {
      count += 1;
    }
  }
  return count;
}

test("the touch icon is a 180x180 PNG", async () => {
  const png = readPng();
  assert.deepEqual(
    [...png.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    "icon-180.png must be a PNG",
  );
  // IHDR is the first chunk, so width and height are at a fixed offset.
  assert.equal(png.toString("ascii", 12, 16), "IHDR", "the first chunk must be IHDR");
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  assert.equal(width, ICON_SIZE, "icon width");
  assert.equal(height, ICON_SIZE, "icon height");
});

test("the touch icon is not the Grok App Builder mark", () => {
  const actual = createHash("sha256").update(readPng()).digest("hex");
  assert.notEqual(
    actual,
    SCAFFOLD_ICON_SHA256,
    "icon-180.png is byte-identical to the scaffold icon that was replaced",
  );
});

test("the touch icon shows the newspaper's own mark, not the scaffold palette", async () => {
  for (const colour of faviconPalette()) {
    const count = await pixelsNear(colour, 4);
    assert.ok(
      count >= 100,
      `favicon.svg colour rgb(${colour.join(",")}) covers ${count} icon pixels -- the icon no longer shows the mark favicon.svg draws`,
    );
  }
  // The scaffold mark was a neutral near-black field; the newspaper's mark is
  // warm (cream, brick red, a warm near-black). A neutral grey block means the
  // builder's mark came back.
  for (const colour of SCAFFOLD_PALETTE) {
    const count = await pixelsNear(colour, 3);
    assert.equal(
      count,
      0,
      `${count} icon pixels are rgb(${colour.join(",")}) -- that is the scaffold icon's palette`,
    );
  }
});
