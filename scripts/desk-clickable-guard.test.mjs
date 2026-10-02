/*
  Unit UI1b step 1: the arithmetic behind the clickable-controls guard.

  The walk (scripts/desk-clickable-guard-walk.mjs) measures the real desk in a
  real browser. Everything it DECIDES is here, driven with no browser and no
  server, because "a control that does something must show a 3:1 edge or fill"
  is a rule that can be wrong in ways only numbers show.

  Each case below is one of the brief's named ones, and each was written to
  fail before the code that satisfies it:

    - a quiet button with a `--line` edge FAILS. `--line` is a hairline RULE
      token: #d8d3c4 on the cream panel is 1.4:1, and it was the single biggest
      cause of the auditor's 463 hits on the desk. This is the case that makes
      the guard a guard rather than a rubber stamp.
    - a quiet button with a `--fg2` edge PASSES -- the UI1a fix, and the same
      number scripts/desk-button-contrast.test.mjs asserts (10.2:1 on the light
      panel, 8.1:1 on the dark one). Both numbers are re-derived here against
      the real token hexes, so the two guards cannot drift apart.
    - a link with no underline FAILS as a link that does not read as one.
    - an underlined link in a list title PASSES: that is the one plain-text
      form the design system allows.
    - an allowlist entry with no reason is REJECTED, and a stale entry is
      REJECTED -- an exemption nobody explained, or one that covers nothing any
      more, is how this kind of guard goes quiet.

  Run: node --test scripts/desk-clickable-guard.test.mjs
*/
import test from "node:test";
import assert from "node:assert/strict";
import {
  CONTRAST_FLOOR,
  DESK_THEMES,
  FAIL_LINK_PLAIN,
  FAIL_NO_EDGE,
  FAIL_TARGET_SMALL,
  MIN_TARGET_PX,
  blendOver,
  classifyControl,
  closestMargins,
  effectiveBackground,
  exemptFailures,
  guardExitCode,
  parseColor,
  planVisits,
  ratio,
  staleAllowlistEntries,
  validateAllowlist,
} from "./lib/clickable-guard.mjs";

/* The desk's own tokens, copied from src/desk-astra.css -- the SAME hexes
   scripts/desk-button-contrast.test.mjs resolves out of the stylesheets. */
const LIGHT = { bg: "#fffdf7", surface: "#f6f2e7", line: "#d8d3c4", fg: "#111111", fg2: "#3a3a3a" };
const NIGHT = { bg: "#1b1916", surface: "#27231f", line: "#3b3631", fg: "#e8e6e1", fg2: "#bdbab3" };

/** One clickable, as the browser would have measured it. */
function control(over = {}) {
  return {
    tag: "button",
    name: "Check now",
    selector: "button.btn.quiet",
    text: "Check now",
    isLink: false,
    underlined: false,
    inProse: false,
    disabled: false,
    reasonBeside: false,
    height: 44,
    ownBackground: "rgba(0, 0, 0, 0)",
    ancestorBackgrounds: [LIGHT.surface, LIGHT.bg],
    pageBackground: LIGHT.bg,
    borderSides: [],
    ...over,
  };
}

/** A quiet button: 1px edge on all four sides, transparent fill. */
function quiet({ edge, ground, theme = LIGHT }) {
  return control({
    ownBackground: "rgba(0, 0, 0, 0)",
    ancestorBackgrounds: [ground, theme.bg],
    pageBackground: theme.bg,
    borderSides: ["top", "right", "bottom", "left"].map((side) => ({
      side,
      width: 1,
      style: "solid",
      color: edge,
    })),
  });
}

/* ─────────────────────────── the colour arithmetic ──────────────────────── */

test("a colour string is read the way the browser reports it", () => {
  assert.deepEqual(parseColor("#fff"), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor("#3a3a3a"), { r: 58, g: 58, b: 58, a: 1 });
  assert.deepEqual(parseColor("rgb(58, 58, 58)"), { r: 58, g: 58, b: 58, a: 1 });
  assert.deepEqual(parseColor("rgba(58, 58, 58, 0.5)"), { r: 58, g: 58, b: 58, a: 0.5 });
  assert.equal(parseColor("transparent").a, 0);
  assert.equal(parseColor("color(display-p3 1 0 0)"), null);
});

test("a semi-transparent colour is composited over what is behind it", () => {
  /* Black at 50% over white is the mid grey #808080-ish, not black. */
  const mixed = blendOver("rgba(0, 0, 0, 0.5)", "#ffffff");
  assert.ok(Math.abs(mixed.r - 127.5) < 0.01, `expected ~127.5, got ${mixed.r}`);
  assert.equal(mixed.a, 1);
  /* And it is measurably NOT the same as the opaque colour: a guard that
     skipped the blend would call this black-on-white (21:1) instead. */
  assert.ok(ratio(mixed, "#ffffff") < 21);
});

test("the effective background is the first opaque colour up the tree, blended", () => {
  assert.equal(
    ratio(effectiveBackground({ layers: ["rgba(0,0,0,0)", LIGHT.surface], fallback: LIGHT.bg }), LIGHT.surface),
    1,
  );
  /* A 10% ink wash on the panel is not the panel. */
  const washed = effectiveBackground({ layers: ["rgba(17,17,17,0.1)", LIGHT.surface] });
  assert.ok(ratio(washed, LIGHT.surface) > 1.05, "a tinted layer must change the ground");
  /* Nothing opaque anywhere falls back to the page. */
  assert.equal(ratio(effectiveBackground({ layers: ["transparent", "rgba(0,0,0,0)"] }), "#ffffff"), 1);
});

test("black on white is 21:1 and a colour against itself is 1:1", () => {
  assert.equal(ratio("#000000", "#ffffff"), 21);
  assert.equal(ratio(LIGHT.line, LIGHT.line), 1);
});

/*
  THE TWO NUMBERS THE TWO GUARDS MUST AGREE ON.

  scripts/desk-button-contrast.test.mjs resolves these out of the real
  stylesheets and asserts the quiet edge clears 3:1 on both grounds in both
  themes. This walk computes the same ratio from what the browser reports for
  the drawn control. If they ever disagree, one of the two is measuring
  something other than the button -- so the numbers are pinned here.
*/
test("the quiet edge's ratios agree with scripts/desk-button-contrast.test.mjs", () => {
  const near = (measured, claimed) =>
    assert.ok(Math.abs(measured - claimed) < 0.15, `measured ${measured}, the desk's number is ~${claimed}`);
  near(ratio(LIGHT.fg2, LIGHT.surface), 10.2);
  near(ratio(NIGHT.fg2, NIGHT.surface), 8.1);
  near(ratio(LIGHT.line, LIGHT.surface), 1.4);
  near(ratio(NIGHT.line, NIGHT.surface), 1.3);
  /* And the two guards agree on the DECISION, which is what matters: --line is
     under the floor in both themes and --fg2 is over it in both. */
  assert.ok(ratio(LIGHT.line, LIGHT.surface) < CONTRAST_FLOOR);
  assert.ok(ratio(NIGHT.line, NIGHT.surface) < CONTRAST_FLOOR);
  assert.ok(ratio(LIGHT.fg2, LIGHT.surface) >= CONTRAST_FLOOR);
  assert.ok(ratio(NIGHT.fg2, NIGHT.surface) >= CONTRAST_FLOOR);
});

/* ────────────────────────── classifying a control ───────────────────────── */

test("a quiet button with a --line edge FAILS in both themes", () => {
  for (const [theme, tokens] of [["light", LIGHT], ["night", NIGHT]]) {
    const result = classifyControl(quiet({ edge: tokens.line, ground: tokens.surface, theme: tokens }));
    assert.equal(result.pass, false, `${theme}: a --line edge must not pass`);
    assert.ok(result.failures.includes(FAIL_NO_EDGE), `${theme}: got ${JSON.stringify(result.failures)}`);
    assert.ok(result.edgeRatio < CONTRAST_FLOOR, `${theme}: measured ${result.edgeRatio}`);
  }
});

test("a quiet button with an --fg2 edge PASSES in both themes", () => {
  for (const [theme, tokens] of [["light", LIGHT], ["night", NIGHT]]) {
    const result = classifyControl(quiet({ edge: tokens.fg2, ground: tokens.surface, theme: tokens }));
    assert.deepEqual(result.failures, [], `${theme}: ${JSON.stringify(result)}`);
    assert.ok(result.edgeRatio >= CONTRAST_FLOOR, `${theme}: measured ${result.edgeRatio}`);
    assert.equal(result.kind, "ok");
  }
});

test("a 2px ink edge passes and a 0px border of the same colour does not", () => {
  const ink = classifyControl(
    quiet({ edge: LIGHT.fg, ground: LIGHT.surface, theme: LIGHT }),
  );
  assert.equal(ink.pass, true);

  const none = classifyControl(
    control({
      borderSides: [{ side: "top", width: 0, style: "none", color: LIGHT.fg }],
    }),
  );
  assert.equal(none.pass, false, "a border that draws nothing is not an edge");
  assert.ok(none.failures.includes(FAIL_NO_EDGE));
});

test("the primary's yellow fill alone is under 3:1 -- its 2px ink edge is what identifies it", () => {
  /* Yellow on cream is 1.42:1 and on the panel 1.29:1, so a filled primary
     with no edge does NOT pass. That is the UI1a finding exactly: the level
     that looked most like a button had no boundary of its own at all. */
  for (const ground of [LIGHT.bg, LIGHT.surface]) {
    const fillOnly = classifyControl(
      control({ ownBackground: "#ffd23f", ancestorBackgrounds: [ground] }),
    );
    assert.ok(fillOnly.fillRatio < CONTRAST_FLOOR, `yellow on ${ground} measured ${fillOnly.fillRatio}`);
    assert.equal(fillOnly.pass, false, `the fill alone does not identify the primary on ${ground}`);
    assert.ok(fillOnly.failures.includes(FAIL_NO_EDGE));
  }

  /* With the family's 2px ink edge -- what UI1a added -- it passes. */
  const filled = classifyControl(
    control({
      ownBackground: "#ffd23f",
      ancestorBackgrounds: [LIGHT.surface],
      borderSides: ["top", "right", "bottom", "left"].map((side) => ({
        side,
        width: 2,
        style: "solid",
        color: LIGHT.fg,
      })),
    }),
  );
  assert.equal(filled.pass, true, JSON.stringify(filled));
  assert.equal(filled.edgeRatio > filled.fillRatio, true);
});

test("a link with no underline FAILS as a link, an underlined one in a list title PASSES", () => {
  const plain = classifyControl(
    control({
      tag: "a",
      name: "Read report",
      isLink: true,
      underlined: false,
      inProse: false,
      text: "Read report",
      borderSides: [],
    }),
  );
  assert.equal(plain.pass, false);
  assert.ok(plain.failures.includes(FAIL_LINK_PLAIN), JSON.stringify(plain.failures));

  /* The same link, inside a list item, underlined: allowed. */
  const inAList = classifyControl(
    control({
      tag: "a",
      name: "Water rates rise on the east side of town",
      isLink: true,
      underlined: true,
      inProse: true,
      text: "Water rates rise on the east side of town",
      height: 20, // inline, 20px of line box -- not a 44px row control
      borderSides: [],
    }),
  );
  assert.deepEqual(inAList.failures, [], JSON.stringify(inAList));
  assert.equal(inAList.kind, "underlined link in prose");
});

test("an underline alone does not excuse a link outside prose", () => {
  /* A 20px underlined word in a sentence is fine; the same thing floating on
     its own is a control with no edge, and it fails. */
  const floating = classifyControl(
    control({
      tag: "a",
      name: "Open the story",
      isLink: true,
      underlined: true,
      inProse: false,
      height: 20,
      borderSides: [],
    }),
  );
  assert.equal(floating.pass, false);
  assert.ok(floating.failures.includes(FAIL_NO_EDGE));
  assert.ok(floating.notes.some((n) => /underlined link outside prose/.test(n)));
});

test("a target under 44px fails, and an inline link in prose is exempt", () => {
  const small = classifyControl(quiet({ edge: LIGHT.fg2, ground: LIGHT.surface, theme: LIGHT }));
  assert.equal(small.pass, true, "44px quiet button is fine");

  const short = classifyControl(
    { ...quiet({ edge: LIGHT.fg2, ground: LIGHT.surface, theme: LIGHT }), height: 30 },
  );
  assert.ok(short.failures.includes(FAIL_TARGET_SMALL), JSON.stringify(short.failures));

  const inline = classifyControl(
    control({ tag: "a", isLink: true, underlined: true, inProse: true, height: 19 }),
  );
  assert.deepEqual(inline.failures, [], "an inline link is a word, not a 44px target");
  assert.ok(MIN_TARGET_PX === 44);
});

test("a disabled control with no edge is a failure and a missing reason is a NOTE", () => {
  const gated = classifyControl(
    control({
      name: "Publish in Housing",
      disabled: true,
      reasonBeside: false,
      borderSides: [{ side: "top", width: 2, style: "dashed", color: LIGHT.fg2 }],
    }),
  );
  assert.equal(gated.pass, true, "the dashed gate clears the floor");
  assert.ok(
    gated.notes.some((n) => /no reason printed/.test(n)),
    "a missing sentence beside a disabled control is recorded, not failed",
  );

  const invisibleGate = classifyControl(
    control({
      name: "Publish in Housing",
      disabled: true,
      reasonBeside: true,
      borderSides: [{ side: "top", width: 2, style: "dashed", color: LIGHT.line }],
    }),
  );
  assert.equal(invisibleGate.pass, false, "a dashed --line gate is the invisible-edge defect again");
  assert.ok(invisibleGate.failures.includes(FAIL_NO_EDGE));
});

/* ────────────────────────────── the allowlist ───────────────────────────── */

test("an allowlist entry without a reason is rejected", () => {
  assert.deepEqual(validateAllowlist([]), []);
  assert.deepEqual(
    validateAllowlist([{ route: "/desk/queue", name: "More", reason: "the drawn caret carries it" }]),
    [],
  );
  const problems = validateAllowlist([
    { route: "/desk/queue", name: "More" },
    { route: "/desk/queue", name: "Edit", reason: "   " },
    { route: "/desk/queue", reason: "no name" },
  ]);
  assert.equal(problems.length, 3, JSON.stringify(problems));
  assert.ok(problems.some((p) => /no "reason"/.test(p)));
});

test("an allowlist entry that matches no failure any more is stale", () => {
  const failures = [
    { route: "/desk/queue", name: "More" },
    { route: "/desk/models", name: "Check now" },
  ];
  const live = [
    { route: "/desk/queue", name: "More", reason: "drawn caret" },
    { route: "*", name: "Check now", reason: "every screen draws it" },
  ];
  assert.deepEqual(staleAllowlistEntries(live, failures), []);
  assert.deepEqual(exemptFailures(live, failures), []);

  const withStale = [...live, { route: "/desk/queue", name: "Read report", reason: "fixed in UI1b" }];
  const stale = staleAllowlistEntries(withStale, failures);
  assert.equal(stale.length, 1);
  assert.equal(stale[0].name, "Read report");

  /* A `*` entry is not stale just because the control only fails on one route. */
  assert.deepEqual(staleAllowlistEntries([{ route: "*", name: "More", reason: "x" }], failures), []);
  /* And an exemption really does exempt. */
  assert.deepEqual(exemptFailures([{ route: "/desk/queue", name: "More", reason: "x" }], failures), [
    { route: "/desk/models", name: "Check now" },
  ]);

  /*
    UI1b-3: the two readings must be given the SAME list, and it has to be the
    list of failures the run FOUND.

    `exemptFailures` takes the allowlist's share out; the stale check asks
    whether an entry still matches something. Handed the post-exemption list,
    the answer is always no -- every entry would read as stale, and the first
    entry anybody added (the brand mark, the one the file exists for) would
    fail the walk before it wrote its report. The walk passes `allFailures`
    for the stale check and the exempted list for the exit code; this pins
    that the two are not the same list, which is the mistake that was there.
  */
  const exempted = exemptFailures(live, failures);
  assert.deepEqual(
    staleAllowlistEntries(live, exempted),
    live,
    "the post-exemption list is the wrong input",
  );
  assert.deepEqual(staleAllowlistEntries(live, failures), [], "the found list is the right input");
});

/* ─────────────────────────── the visit plan ─────────────────────────────── */

test("BOTH THEMES ARE VISITED: the plan covers light and night, and 390 in light", () => {
  const plan = planVisits(["/desk/queue", "/desk/models"]);
  const themes = new Set(plan.map((v) => v.theme));
  assert.deepEqual([...themes].sort(), [...DESK_THEMES].sort());
  assert.ok(themes.has("night"), "the desk ships dark; a plan without night measures half the desk");
  assert.ok(themes.has("light"));

  const queue = plan.filter((v) => v.route === "/desk/queue");
  assert.equal(queue.length, 3, "1280 light, 1280 night, 390 light");
  assert.deepEqual(
    queue.map((v) => `${v.theme}@${v.viewport}`).sort(),
    ["light@1280", "light@390", "night@1280"],
  );
  /* Every route gets the same treatment, so a route cannot be half-measured. */
  for (const route of ["/desk/queue", "/desk/models"]) {
    assert.equal(plan.filter((v) => v.route === route).length, 3);
  }
});

/* ─────────────────────────── the exit code ──────────────────────────────── */

/*
  UI1b's last step: THE GUARD ENFORCES.

  Unit UI1b step 1 shipped the walk behind a temporary `GUARD_BASELINE_ONLY=1`
  in CI, because on that build the walk was red by design -- 463 controls were
  still plain text and the failure count WAS the deliverable. The switch printed
  the same report and exited 0. This step deletes it, so the property that
  matters is now: A FAILING CONTROL FAILS THE BUILD.

  `guardExitCode` is the whole decision, extracted so it can be driven without a
  browser, a server or a subprocess. The first case is the one the brief asks
  for and it is written to fail if the switch ever comes back.
*/
test("WITH THE SWITCH OFF, one failing control exits non-zero", () => {
  assert.equal(
    guardExitCode({ failures: 1 }),
    1,
    "a failing control no longer fails the build -- the guard is a report again",
  );
  assert.equal(guardExitCode({ failures: 463 }), 1, "the auditor's 463 must fail the build");
});

test("a clean run exits zero, and only the local escape hatch overrides a failure", () => {
  assert.equal(guardExitCode({ failures: 0 }), 0);
  assert.equal(guardExitCode({ failures: 0, reportOnly: true }), 0);
  assert.equal(
    guardExitCode({ failures: 3, reportOnly: true }),
    0,
    "GUARD_REPORT_ONLY=1 is the documented local hatch for looking at a red report",
  );
});

/* ─────────────────────────── the margins ────────────────────────────────── */

/*
  UI1b-6. A guard with no headroom goes red on somebody else's machine: CI is
  headless Chromium on Linux, in UTC, with different fonts, so 44.0px here can
  be 43.7 there. The walk prints how close the passing controls are, and these
  cases pin what that list means.
*/
test("the closest margins are the nearest passing controls, smallest first", () => {
  const rows = [
    { route: "/desk", theme: "light", viewport: 1280, name: "Roomy", height: 60, edgeRatio: 12 },
    { route: "/desk", theme: "night", viewport: 1280, name: "Tight", height: 46, edgeRatio: 3.2 },
    { route: "/desk/queue", theme: "light", viewport: 390, name: "Tighter", height: 44, edgeRatio: 3.05 },
  ];
  const margins = closestMargins(rows);
  assert.equal(margins.heights[0].name, "Tighter");
  assert.equal(margins.heights[0].margin, 0);
  assert.equal(margins.heights[1].name, "Tight");
  assert.equal(margins.contrasts[0].name, "Tighter");
  assert.ok(Math.abs(margins.contrasts[0].margin - 0.05) < 0.001, "3.05:1 is 0.05 above the floor");
  assert.ok(margins.contrasts.every((r) => r.ratio >= CONTRAST_FLOOR), "a failing control is not a margin");
});

test("a control inside an underlined prose link is not a margin on anything", () => {
  const margins = closestMargins([
    { name: "Read the report", height: 20, edgeRatio: 1.1, kind: "underlined link in prose" },
    { name: "Check now", height: 44, edgeRatio: 4, kind: "ok" },
  ]);
  assert.deepEqual(margins.heights.map((r) => r.name), ["Check now"]);
  assert.deepEqual(margins.contrasts.map((r) => r.name), ["Check now"]);
});

test("a control at 44-45px or under 3.1:1 is reported as a flake risk", () => {
  const margins = closestMargins([
    { name: "At the line", height: 44, edgeRatio: 3.5, kind: "ok" },
    { name: "One over", height: 45, edgeRatio: 3.5, kind: "ok" },
    { name: "Thin contrast", height: 48, edgeRatio: 3.09, kind: "ok" },
    { name: "Real headroom", height: 48, edgeRatio: 4.5, kind: "ok" },
  ]);
  const risky = margins.flakeRisks.map((r) => r.name).sort();
  assert.deepEqual(risky, ["At the line", "One over", "Thin contrast"]);
  assert.ok(
    margins.flakeRisks.some((r) => r.measure === "height") &&
      margins.flakeRisks.some((r) => r.measure === "contrast"),
    "both measures must be able to raise a risk",
  );
});
