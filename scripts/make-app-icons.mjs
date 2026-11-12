#!/usr/bin/env node
/**
 * Render the install icons a phone needs from `public/favicon.svg`.
 *
 * `public/__app/icon-180.png` is the apple-touch-icon and stays as it is (iOS
 * asks for 180). Chrome on Android will not offer "Install app" from a
 * manifest that has no 192x192 and no 512x512 PNG, and it wants a maskable
 * icon too or its round/squircle mask crops the corners of the mark. This
 * script draws all three from the same 16x16 artwork the browser tab shows, so
 * the mark a reader installs is the paper's own mark and not a redrawing.
 *
 * Offline and reproducible: `sharp` is already a dependency, so this needs no
 * browser and makes no network call.
 *
 *   node scripts/make-app-icons.mjs
 *
 * `scripts/app-chrome.test.mjs` checks the committed files: sizes, presence,
 * and that the manifest names exactly these paths.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FAVICON_PATH = join(root, "public", "favicon.svg");
const OUT_DIR = join(root, "public", "__app");

/** The manifest's icon sizes, besides the existing 180. */
export const ICON_SIZES = [192, 512];
export const MASKABLE_SIZE = 512;
/** The maskable mark is drawn at 80% and centred, leaving the safe zone. */
export const MASKABLE_ARTWORK_RATIO = 0.8;
/** The square the paper uses behind its masthead mark. */
export const MASK_BACKGROUND = "#9B2915";

/**
 * The favicon carries a `viewBox` and no `width`/`height`, so a rasteriser
 * asked for it as-is draws at the 16px fallback. Stamping the size onto the
 * root element makes librsvg rasterise the vector at that size directly.
 */
function sizedFaviconSvg(size) {
  const svg = readFileSync(FAVICON_PATH, "utf8");
  const sized = svg.replace(
    /<svg\b([^>]*)>/,
    (_, attributes) => `<svg${attributes} width="${size}" height="${size}">`,
  );
  if (sized === svg) throw new Error(`${FAVICON_PATH} has no <svg> root element`);
  return Buffer.from(sized);
}

/**
 * Render the mark at `size`, supersampled and brought back down with a
 * nearest-neighbour kernel: the artwork is axis-aligned flat colour, so this
 * keeps every edge on a hard pixel boundary instead of the soft fringe a
 * plain bilinear downscale leaves on a small icon.
 */
async function renderSvg(svg, size) {
  const supersample = 4;
  return sharp(svg, { density: 72 * supersample })
    .resize(size * supersample, size * supersample, { kernel: "nearest" })
    .resize(size, size, { kernel: "nearest" })
    .png()
    .toBuffer();
}

async function renderMark(size) {
  return renderSvg(sizedFaviconSvg(size), size);
}

/**
 * The maskable icon: the mark at 80%, centred on a full-bleed brand square.
 *
 * Drawn as one SVG rather than composited from a rendered PNG, so the mark and
 * its background rasterise together and no seam appears between them.
 */
async function renderMaskable(size) {
  const svg = readFileSync(FAVICON_PATH, "utf8");
  const inner = svg
    .replace(/^[\s\S]*?<svg\b[^>]*>/, "")
    .replace(/<\/svg>\s*$/, "")
    .trim();
  // Snap the artwork to a whole number of favicon units (a multiple of 16px)
  // so every edge of the mark lands on a pixel boundary instead of being
  // antialiased by the 16-unit grid's scale factor.
  const art = Math.round((size * MASKABLE_ARTWORK_RATIO) / 16) * 16;
  const offset = (size - art) / 2;
  const composed =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 ${size} ${size}">` +
    `<rect width="${size}" height="${size}" fill="${MASK_BACKGROUND}"/>` +
    `<g transform="translate(${offset} ${offset}) scale(${art / 16})">${inner}</g>` +
    `</svg>`;
  return renderSvg(Buffer.from(composed), size);
}

async function main() {
  const outputs = [
    [`icon-${ICON_SIZES[0]}.png`, await renderMark(ICON_SIZES[0])],
    [`icon-${ICON_SIZES[1]}.png`, await renderMark(ICON_SIZES[1])],
    [`icon-maskable-${MASKABLE_SIZE}.png`, await renderMaskable(MASKABLE_SIZE)],
  ];
  for (const [name, bytes] of outputs) {
    const target = join(OUT_DIR, name);
    writeFileSync(target, bytes);
    console.log(
      `[app-icons] wrote ${relative(root, target).replaceAll("\\", "/")} ` +
        `(${bytes.length} bytes) from public/favicon.svg`,
    );
  }
}

await main();
