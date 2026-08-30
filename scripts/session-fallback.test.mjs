import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The no-JavaScript fallback must never eject an editor who is signed in.
 *
 * `__root.tsx` injects one inline script into every page. It used to fire after
 * 1200ms, read the first `<h1>`, and send the visitor to /login if it said
 * "Opening the desk". A signed-in editor sees exactly that heading while their
 * newsroom loads -- and that load runs five DDL statements before its two
 * selects -- so a slow database threw a legitimately signed-in editor out to
 * the sign-in page. It also beat the desk route's own 2500ms decision, so the
 * timer usually won the race against the real logic. An audit filed it Critical.
 *
 * Two properties keep it honest, and this file asserts both against the actual
 * injected script rather than against a description of it:
 *
 *   1. it selects a marker attribute, never heading copy -- copy is edited by
 *      people who have no reason to know a redirect depends on it;
 *   2. its delay is longer than the route's own wait, so the route always
 *      decides first and this only fires when React never started at all.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = readFileSync(join(ROOT, "src/routes/__root.tsx"), "utf8");
const desk = readFileSync(join(ROOT, "src/routes/desk.tsx"), "utf8");

/** The injected script, taken from the dangerouslySetInnerHTML string itself. */
function injected() {
  const m = root.match(/dangerouslySetInnerHTML=\{\{[\s\S]*?__html:\s*([\s\S]*?)\n\s*\}\}/);
  assert.ok(m, "no inline script found in __root.tsx");
  return m[1];
}

test("the fallback keys on a marker, not on heading copy", () => {
  const script = injected();
  assert.match(
    script,
    /data-awaiting-session/,
    "the fallback must select the awaiting-a-session marker",
  );
  for (const copy of ["Opening the desk", "Checking sign-in", "textContent", "querySelector(\\\"h1"]) {
    assert.ok(
      !script.includes(copy),
      `the fallback reads ${copy} -- a signed-in editor sees that same screen, ` +
        `and editing the copy would silently change who gets redirected`,
    );
  }
});

test("the fallback waits longer than the desk route's own decision", () => {
  const script = injected();
  const m = script.match(/,\s*(\d+)\s*\)/);
  assert.ok(m, `could not read the delay from: ${script}`);
  const fallbackMs = Number(m[1]);

  const w = desk.match(/const SESSION_WAIT_MS = (\d+)/);
  assert.ok(w, "desk.tsx no longer declares SESSION_WAIT_MS");
  const routeMs = Number(w[1]);

  assert.ok(
    fallbackMs > routeMs * 2,
    `the fallback fires at ${fallbackMs}ms while the desk route decides at ` +
      `${routeMs}ms. It must not race the real logic -- it is only for the case ` +
      `where React never ran at all.`,
  );
});

test("only the anonymous pending screen carries the marker", () => {
  // Two ScreenPending calls live in desk.tsx: one for a visitor whose session is
  // still unknown, one for an editor whose newsroom is loading. Exactly one may
  // opt into the redirect.
  const marked = desk.split("awaitingSession").length - 1;
  assert.equal(
    marked,
    1,
    `${marked} screens carry awaitingSession. The signed-in editor's loading ` +
      `screen must not, or the fallback ejects them again.`,
  );
});
