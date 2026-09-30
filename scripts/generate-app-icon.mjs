#!/usr/bin/env node
/**
 * Regenerate `public/__app/icon-180.png` from `public/favicon.svg`.
 *
 * That PNG is what a reader's home screen shows: `appChromeHeadTags` and
 * `src/routes/__root.tsx` point the apple-touch-icon at it, and
 * `renderWebManifest` declares it as the manifest's only icon. It used to be
 * the Grok App Builder's own mark -- a near-black field carrying the builder's
 * sparkle -- so installing a self-hosted paper put another product's logo on
 * the reader's home screen. The newspaper's own mark already exists as
 * `public/favicon.svg` (the masthead "T" on the cream field, the same mark the
 * browser tab shows), so the touch icon is now that mark, rendered at the size
 * iOS asks for.
 *
 * Offline and reproducible: `@napi-rs/canvas` is already a dependency (story
 * rendering), so this needs no browser and makes no network call.
 *
 *   node scripts/generate-app-icon.mjs
 *
 * `scripts/app-icon.test.mjs` guards both the result and the mark it shows.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createCanvas, loadImage } from "@napi-rs/canvas";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

export const FAVICON_PATH = join(root, "public", "favicon.svg");
export const ICON_PATH = join(root, "public", "__app", "icon-180.png");
/** apple-touch-icon size, and the size `renderWebManifest` declares. */
export const ICON_SIZE = 180;

/**
 * The favicon carries a `viewBox` and no `width`/`height`, so a rasteriser
 * asked for it as-is draws at the 16px fallback and the 180px icon would be a
 * blurry upscale of a 16px bitmap. Stamping the size onto the root element
 * makes the renderer rasterise the vector at 180x180 directly, which is the
 * whole point of keeping the mark as SVG.
 */
export function sizedFaviconSvg(size = ICON_SIZE) {
  const svg = readFileSync(FAVICON_PATH, "utf8");
  const sized = svg.replace(
    /<svg\b([^>]*)>/,
    (_, attributes) => `<svg${attributes} width="${size}" height="${size}">`,
  );
  if (sized === svg) throw new Error(`${FAVICON_PATH} has no <svg> root element`);
  return sized;
}

/** The 180x180 PNG bytes for the mark in `public/favicon.svg`. */
export async function renderAppIconPng(size = ICON_SIZE) {
  const image = await loadImage(Buffer.from(sizedFaviconSvg(size)));
  const canvas = createCanvas(size, size);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, size, size);
  return canvas.encodeSync("png");
}

const invokedDirectly =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedDirectly) {
  const png = await renderAppIconPng();
  writeFileSync(ICON_PATH, png);
  console.log(
    `[app-icon] wrote ${relative(root, ICON_PATH).replaceAll("\\", "/")} ` +
      `(${png.length} bytes, ${ICON_SIZE}x${ICON_SIZE}) from public/favicon.svg`,
  );
}
