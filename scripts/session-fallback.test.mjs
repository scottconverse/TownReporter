import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The last-resort fallback must never move a visitor who is signed in.
 *
 * `__root.tsx` injects one inline script into every page, for the case where
 * the app's JavaScript never runs at all and the server-rendered "Opening the
 * desk" screen would otherwise sit there forever.
 *
 * It has ejected signed-in editors twice. First as a 1200ms timer that read
 * the first `<h1>` and redirected to /login on the copy "Opening the desk" --
 * the same screen a signed-in editor sees while their newsroom loads (an audit
 * filed it Critical). Then, after being re-keyed to a marker attribute and
 * pushed out to 8000ms, again on 2026-09-02: the marker is SERVER-rendered, so
 * it is on the page both when React will never start and when React is merely
 * still loading, and eight seconds is not enough on a cold dev server on a
 * two-core runner. Because /login sends a signed-in owner to /desk and /desk
 * sends an un-onboarded owner to /desk/setup, each misfire looped the browser
 * back to a blank first-run setup form. Four browser walks died on it in a day.
 *
 * The lesson is that no timeout can tell "will never run" from "still
 * loading", so the script does not decide anything on the visitor's behalf.
 * Four properties keep it honest, asserted against the actual injected script
 * rather than against a description of it:
 *
 *   1. it selects a marker attribute, never heading copy -- copy is edited by
 *      people who have no reason to know a redirect depends on it;
 *   2. its delay is longer than the desk route's own wait, so the route's real
 *      logic always decides first;
 *   3. it never navigates: no location assignment of any kind. It stamps one
 *      attribute of its own, and a rule in styles.css reveals the sign-in link
 *      the pending screen already server-renders hidden;
 *   4. it skips screens React has hydrated (`data-session-hydrated`, stamped
 *      from an effect), so a visitor whose app is alive and deliberately
 *      waiting is not offered a way out of a page that is working.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = readFileSync(join(ROOT, "src/routes/__root.tsx"), "utf8");
const desk = readFileSync(join(ROOT, "src/routes/desk.tsx"), "utf8");
const states = readFileSync(join(ROOT, "src/components/states.tsx"), "utf8");
const styles = readFileSync(join(ROOT, "src/styles.css"), "utf8");

/** The attribute ScreenPending stamps once React has hydrated it. */
const HYDRATED_MARKER = "data-session-hydrated";
/** The attribute on the hidden, server-rendered escape link. */
const ESCAPE_MARKER = "data-stranded-signin";
/** The attribute the fallback stamps on the screen to reveal that link. */
const STRANDED_MARKER = "data-stranded";

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
        `and editing the copy would silently change who it acts on`,
    );
  }
});

test("the fallback waits longer than the desk route's own decision", () => {
  const script = injected();
  // Every literal in the script is a millisecond delay; the largest is the arm.
  const delays = [...script.matchAll(/\b(\d{3,})\b/g)].map((m) => Number(m[1]));
  assert.ok(delays.length, `could not read any delay from: ${script}`);
  const fallbackMs = Math.max(...delays);

  const w = desk.match(/const SIGN_IN_OFFER_MS = (\d+)/);
  assert.ok(w, "desk.tsx no longer declares SIGN_IN_OFFER_MS");
  const routeMs = Number(w[1]);

  assert.ok(
    fallbackMs > routeMs * 2,
    `the fallback acts at ${fallbackMs}ms while the desk route offers its own ` +
      `way out at ${routeMs}ms. It must not race the route -- it is only for ` +
      `the case where the app's JavaScript never ran at all.`,
  );
});

test("no timer in the desk route decides that a visitor is signed out", () => {
  // The route's own 2500ms SESSION_WAIT_MS did exactly what the inline
  // fallback did: treated a session that had not answered yet as an answer,
  // and redirected. `useSession` clears isPending on success AND failure, so
  // "still pending" is never a verdict. A timer may change the copy on the
  // waiting screen; it may not change where the visitor is.
  const gate = desk.slice(desk.indexOf("function DeskGate"));
  assert.ok(
    !/SESSION_WAIT_MS|gaveUp/.test(gate),
    "DeskGate still consults a give-up timer. A timeout must not turn a pending " +
      "session into a redirect: it loops a signed-in owner back to a blank " +
      "first-run setup form (2026-09-02).",
  );
  assert.match(
    gate,
    /if \(isPending\) \{/,
    "DeskGate must show the pending screen for as long as the session is " +
      "pending, with no timer qualifying that condition",
  );
});

test("only the anonymous pending screen carries the marker", () => {
  // Two ScreenPending calls live in desk.tsx: one for a visitor whose session is
  // still unknown, one for an editor whose newsroom is loading. Exactly one may
  // opt in.
  const marked = desk.split("awaitingSession").length - 1;
  assert.equal(
    marked,
    1,
    `${marked} screens carry awaitingSession. The signed-in editor's loading ` +
      `screen must not, or the fallback acts on them again.`,
  );
});

test("the fallback never navigates the visitor anywhere", () => {
  const script = injected();
  for (const move of ["location.replace", "location.assign", "location.href", "location ="]) {
    assert.ok(
      !script.includes(move),
      `the fallback calls ${move}. No timeout can tell "the app will never ` +
        `start" from "the app is still loading", so it must not move anyone: ` +
        `a wrong guess sent a signed-in owner round /login -> /desk -> ` +
        `/desk/setup and wiped the first-run form (2026-09-02, four CI walks). ` +
        `It may only reveal the escape link.`,
    );
  }
  assert.ok(
    script.includes(`setAttribute("${STRANDED_MARKER}"`),
    `the fallback must stamp ${STRANDED_MARKER} -- revealing the escape link ` +
      `is the only thing it is still allowed to do`,
  );
  assert.ok(
    !/removeAttribute|\.hidden\s*=/.test(script),
    "the fallback must not undo an attribute React rendered: React hydrating " +
      "that element afterwards logs a hydration mismatch. It stamps an " +
      "attribute of its own and lets CSS do the rest.",
  );
});

test("a stylesheet rule, not the script, does the revealing", () => {
  // styles.css is a plain <link>, so it is still on the page when the app
  // bundle is not -- which is the only situation this whole mechanism is for.
  assert.ok(
    styles.includes(`[${STRANDED_MARKER}]`) && styles.includes(`[${ESCAPE_MARKER}][hidden]`),
    `styles.css has no rule revealing [${ESCAPE_MARKER}][hidden] under ` +
      `[${STRANDED_MARKER}], so the fallback stamps an attribute that does ` +
      `nothing and a stranded visitor stays stranded`,
  );
  assert.ok(
    styles.includes(`:not([${HYDRATED_MARKER}])`),
    `the reveal rule must also require :not([${HYDRATED_MARKER}]), so the link ` +
      `disappears again the moment React hydrates the screen`,
  );
});

test("the escape link is server-rendered, hidden, on the pending screen", () => {
  assert.ok(
    states.includes(ESCAPE_MARKER),
    `ScreenPending no longer renders the [${ESCAPE_MARKER}] escape link, so a ` +
      `visitor whose JavaScript never runs has no way off the page at all`,
  );
  assert.match(
    states,
    /hidden data-stranded-signin/,
    "the escape link must ship hidden -- it is the exception, not the offer",
  );
  assert.ok(
    states.includes('href="/login"'),
    "the escape link must be a plain href: a router Link needs the very " +
      "JavaScript this fallback exists for",
  );
});

test("the fallback skips screens React has already hydrated", () => {
  const script = injected();
  assert.ok(
    script.includes(`[data-awaiting-session]:not([${HYDRATED_MARKER}])`),
    `the fallback selects the bare marker. That attribute is server-rendered, ` +
      `so it is also on the page while a hydrated React waits for a slow ` +
      `session. It must additionally require :not([${HYDRATED_MARKER}]).`,
  );
  assert.match(
    states,
    /useEffect\(/,
    "ScreenPending must stamp the hydrated marker from an effect (client-only, " +
      "post-hydration) -- rendering it as a prop would put it in the SSR HTML " +
      "and disarm the fallback for the case it exists to catch",
  );
  assert.ok(
    states.includes(`setAttribute("${HYDRATED_MARKER}"`),
    `ScreenPending no longer stamps ${HYDRATED_MARKER}`,
  );
  assert.ok(
    !states.includes(`"${HYDRATED_MARKER}":`),
    `${HYDRATED_MARKER} is rendered as a JSX prop, so it lands in the SSR ` +
      `HTML and the fallback can never act`,
  );
});
