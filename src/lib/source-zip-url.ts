import { APP_VERSION } from "./version.ts";

/**
 * Where a reader gets this newsroom's source.
 *
 * The URL used to be a hand-written string. It said `v0.5.0` while the paper,
 * the README and the changelog all said 0.5.1, so anyone following "get the
 * code" downloaded the previous release without being told — an audit filed it
 * as TW-002.
 *
 * Derived from APP_VERSION now, so the link cannot name a version the app does
 * not claim. `source-zip-url.test.ts` fails if the two ever drift, and it also
 * fails when the release is not tagged yet, which is the honest state to be in
 * between finishing a version and tagging it.
 */
export const SOURCE_ZIP_TAG = `v${APP_VERSION}`;

export const SOURCE_ZIP_URL =
  `https://github.com/scottconverse/TownReporter/archive/refs/tags/${SOURCE_ZIP_TAG}.zip`;

/**
 * Always current, never wrong, occasionally ahead of the release.
 *
 * Offered as the fallback because a tag can be missing — the version is bumped
 * when the work lands and the tag is cut afterwards by the operator, so there
 * is a real window where the tagged archive does not exist yet.
 */
export const SOURCE_ZIP_BACKUP =
  "https://github.com/scottconverse/TownReporter/archive/refs/heads/main.zip";
