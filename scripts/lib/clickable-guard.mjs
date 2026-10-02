/*
  The pure half of the clickable-controls guard (unit UI1b step 1).

  Scott, looking at the live desk: "That DOES NOT look like something you can
  click. BAD interface. There are a ton of these text strings with no
  identifying features that it's an action. These are scattered throughout the
  interface and they're landmines for humans."

  The design system's rule (docs/design/design-system-2026-10-02/design-system/
  README.md §6, §2.6, §2.9) is now the whole app's rule: IF IT DOES SOMETHING,
  IT IS A BUTTON -- one of the four levels (Primary, Secondary, Quiet, Danger)
  plus the dashed disabled gate. IF IT GOES SOMEWHERE, IT IS AN UNDERLINED LINK.
  Nothing clickable is plain text.

  The measurable form of that rule is what this file implements, and it is ALL
  of the arithmetic the walk does:

    1. a control that does something has a visible edge or fill -- the border
       of its strongest side, or its own background -- at 3:1 or better against
       the surface behind it, in BOTH themes. 3:1 is WCAG 2.1's floor for a
       non-text indicator (1.4.11), the same number
       scripts/desk-button-contrast.test.mjs asserts for the button levels.
    2. a target is at least 44px tall on the desk (README §2.9, §6).
    3. a plain text link is allowed ONLY for going to another page, inside a
       sentence or a list title, and then it is ALWAYS underlined.
    4. a disabled control still shows its edge (the dashed gate) and the reason
       is printed beside it.

  WHY IT IS A SEPARATE MODULE. A rule with arithmetic in it can be wrong in
  ways only arithmetic can show -- a semi-transparent fill blended the wrong
  way, a `--line` edge that resolves to 1.4:1, an allowlist that quietly
  exempts everything. `scripts/desk-clickable-guard.test.mjs` drives every one
  of those cases with no browser and no server, so the walk's job is reduced to
  MEASURING the page and handing the numbers here.

  NOTHING HERE TOUCHES THE APP. This is a test walk's arithmetic; the product
  does not import it.
*/

/** The 3:1 non-text-indicator floor (WCAG 2.1 SC 1.4.11). */
export const CONTRAST_FLOOR = 3;
/** The desk's minimum target height, in CSS pixels (design-system §6). */
export const MIN_TARGET_PX = 44;

/**
 * The two themes the desk ships, named the way the walk names them.
 *
 * `light` is the desk's `.desk-ltr.astra` palette; `night` is the same shell
 * with the `.night` class, which is what a dark choice renders (see
 * src/desk-astra.css). Both are visited, and `planVisits` below is what proves
 * it -- a walk that measured only one theme would report half the failures and
 * read as a clean bill of health.
 */
export const DESK_THEMES = ["light", "night"];

/** The widths a desk is read at, for this walk: the desk and a phone. */
export const DESK_WIDTH = 1280;
export const PHONE_WIDTH = 390;

/** What each failure is CALLED in the report, one string per kind. */
export const FAIL_NO_EDGE = "no edge/fill under 3:1";
export const FAIL_LINK_PLAIN = "link not underlined";
export const FAIL_TARGET_SMALL = "target under 44px";

/**
 * The three kinds, by the KEY the report already uses for them.
 *
 * UI1b-8. An allowlist entry used to exempt a failing RECORD -- every kind it
 * carried. The wordmark's entry was the proof that this is too much: its
 * reason says "the edge and target rules still apply to it", and the entry
 * exempted those too, so the day the phone wordmark fell to 24px the guard
 * said nothing. So an entry now names the kinds it covers, in these keys
 * (`scripts/desk-clickable-allowlist.json`), and a wildcard `"kinds": "all"`
 * is a written decision rather than the default.
 */
export const FAILURE_KINDS = {
  noEdgeOrFill: FAIL_NO_EDGE,
  linkNotUnderlined: FAIL_LINK_PLAIN,
  targetUnder44: FAIL_TARGET_SMALL,
};

/** Every kind key an allowlist entry may name. */
export const KIND_KEYS = Object.keys(FAILURE_KINDS);

/** A failure label ("link not underlined") -> its key ("linkNotUnderlined"). */
export function kindKeyOf(label) {
  const found = KIND_KEYS.find((key) => FAILURE_KINDS[key] === label);
  return found ?? null;
}

/* ─────────────────────────────── colour maths ───────────────────────────── */

/**
 * A CSS colour string -> {r, g, b, a}, or null if it is not one this reads.
 *
 * The browser hands back `rgb(r, g, b)` / `rgba(r, g, b, a)` from
 * getComputedStyle, but `transparent` and the shorthand forms turn up in
 * stylesheet text and in tests, so all four are read.
 */
export function parseColor(value) {
  if (typeof value !== "string") return null;
  const text = value.trim().toLowerCase();
  if (!text || text === "transparent" || text === "none" || text === "initial") {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  const keyword = { white: "#ffffff", black: "#000000" }[text];
  if (keyword) return parseColor(keyword);
  const hex = text.match(/^#([0-9a-f]{3,8})$/);
  if (hex) {
    const digits = hex[1];
    const expand = (c) => parseInt(c.length === 1 ? c + c : c, 16);
    if (digits.length === 3 || digits.length === 4) {
      return {
        r: expand(digits[0]),
        g: expand(digits[1]),
        b: expand(digits[2]),
        a: digits.length === 4 ? expand(digits[3]) / 255 : 1,
      };
    }
    if (digits.length === 6 || digits.length === 8) {
      return {
        r: expand(digits.slice(0, 2)),
        g: expand(digits.slice(2, 4)),
        b: expand(digits.slice(4, 6)),
        a: digits.length === 8 ? expand(digits.slice(6, 8)) / 255 : 1,
      };
    }
    return null;
  }
  const rgb = text.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const parts = rgb[1].split(/[\s,/]+/).filter(Boolean);
    if (parts.length < 3) return null;
    const channel = (raw) => {
      const n = raw.endsWith("%") ? (parseFloat(raw) / 100) * 255 : parseFloat(raw);
      return Number.isFinite(n) ? Math.max(0, Math.min(255, n)) : null;
    };
    const [r, g, b] = [channel(parts[0]), channel(parts[1]), channel(parts[2])];
    if (r === null || g === null || b === null) return null;
    let a = 1;
    if (parts.length > 3) {
      const raw = parts[3];
      const n = raw.endsWith("%") ? parseFloat(raw) / 100 : parseFloat(raw);
      a = Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 1;
    }
    return { r, g, b, a };
  }
  return null;
}

/**
 * `fg` composited OVER `bg` (source-over, the browser's own rule).
 *
 * A semi-transparent panel colour is not a colour anyone sees: what is seen is
 * that colour laid over whatever is behind it. Measuring `rgba(0,0,0,0.1)`
 * against the page instead of the cream it actually lands on is how a guard
 * reports a control as invisible when it is not, or the reverse.
 */
export function blendOver(fg, bg) {
  const top = typeof fg === "string" ? parseColor(fg) : fg;
  const bottom = typeof bg === "string" ? parseColor(bg) : bg;
  if (!top) return bottom ?? { r: 255, g: 255, b: 255, a: 1 };
  if (!bottom) return top;
  const a = top.a + bottom.a * (1 - top.a);
  if (a === 0) return { r: 0, g: 0, b: 0, a: 0 };
  const mix = (t, b) => (t * top.a + b * bottom.a * (1 - top.a)) / a;
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a };
}

/**
 * The opaque colour actually behind an element.
 *
 * `layers` is nearest-first: the element's parent's background, then its
 * parent's, up to the root -- what the browser collected. Anything transparent
 * is skipped; anything semi-transparent is laid over what is below it; if
 * nothing opaque is found the page's own `fallback` is the ground.
 */
export function effectiveBackground({ layers = [], fallback = "#ffffff" } = {}) {
  let base = parseColor(fallback) ?? { r: 255, g: 255, b: 255, a: 1 };
  if (base.a < 1) base = blendOver(base, { r: 255, g: 255, b: 255, a: 1 });
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    const layer = parseColor(layers[i]);
    if (!layer || layer.a === 0) continue;
    base = blendOver(layer, base);
  }
  return base;
}

/** WCAG 2.1 relative luminance of an sRGB colour. */
export function relativeLuminance(colour) {
  const c = typeof colour === "string" ? parseColor(colour) : colour;
  if (!c) return 0;
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(c.r) + 0.7152 * channel(c.g) + 0.0722 * channel(c.b);
}

/** WCAG 2.1 contrast ratio, 1..21. Symmetric; alpha is ignored (see callers). */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** The ratio, rounded the way the reports print it. */
export function ratio(a, b) {
  return Number(contrastRatio(a, b).toFixed(2));
}

/* ──────────────────────────── reading one control ───────────────────────── */

/** A CSS border/outline style that draws nothing. */
function drawsNothing(style) {
  return !style || style === "none" || style === "hidden";
}

/**
 * The strongest drawn edge of a control, and its ratio against the ground.
 *
 * "Strongest" is the side with the highest contrast against what is behind the
 * element, because a control is identified by the boundary the eye can pick out
 * -- a 1px `--line` edge on one side and nothing on the others is still one
 * visible edge. Only sides that actually draw (width >= 1px, style not none)
 * count; a 0px or `none` border is not an edge, whatever colour it names.
 */
export function strongestEdge(borderSides = [], ground) {
  let best = null;
  for (const side of borderSides) {
    if (!side) continue;
    const width = Number(side.width) || 0;
    if (width < 1 || drawsNothing(side.style)) continue;
    const colour = parseColor(side.color);
    if (!colour || colour.a === 0) continue;
    const drawn = colour.a < 1 ? blendOver(colour, ground) : colour;
    const value = ratio(drawn, ground);
    if (!best || value > best.ratio) {
      best = { side: side.side ?? "?", width, style: side.style, colour, drawn, ratio: value };
    }
  }
  return best;
}

/**
 * ONE CLICKABLE, CLASSIFIED. The whole rule, in the order the brief gives it.
 *
 * The input is what the browser measured (see the walk's `collect()`); nothing
 * here reaches the page. Returns the failures as plain strings from the
 * `FAIL_*` names above, so the report groups by a stable label.
 *
 *   - a link that is underlined inside prose, a list item, a table cell or a
 *     heading is OK: that is exactly the one plain-text form the design system
 *     allows (README §2: "if it goes somewhere, it is an underlined link").
 *   - a link that is NOT underlined and has no edge or fill FAILS as a link
 *     that does not read as one.
 *   - anything else -- button, summary, select, role=button, a link with an
 *     edge -- must clear 3:1 on its edge or its fill.
 *   - a target under 44px high FAILS, except an inline link in prose, which is
 *     a word inside a sentence and not a 44px row control.
 *   - a disabled control is not exempt from the edge rule; the missing reason
 *     beside it is a NOTE, because a missing sentence is not the same defect
 *     as an invisible control and must not be counted as one.
 *   - a native checkbox or radio (`isChoice`) is identified by its own edge or
 *     fill OR by its enclosing `<label>`'s, and takes its target height from
 *     itself or that label -- the browser paints the widget, not the
 *     stylesheet, and the label is the element that takes the press (UI1b-8).
 */
export function classifyControl(control) {
  const c = control ?? {};
  const ground = effectiveBackground({
    layers: c.ancestorBackgrounds ?? [],
    fallback: c.pageBackground ?? "#ffffff",
  });
  const edge = strongestEdge(c.borderSides ?? [], ground);
  const fillColour = parseColor(c.ownBackground);
  const fill =
    fillColour && fillColour.a > 0
      ? {
          colour: fillColour,
          drawn: fillColour.a < 1 ? blendOver(fillColour, ground) : fillColour,
          ratio: ratio(fillColour.a < 1 ? blendOver(fillColour, ground) : fillColour, ground),
        }
      : null;

  /*
    UI1b-8. A CHECKBOX OR A RADIO IS JUDGED ON ITSELF OR ON ITS LABEL.

    The browser paints a native checkbox/radio, not the stylesheet: its
    computed border is `0px none` and its fill is transparent, so measuring the
    element alone always says "nothing there". What the user perceives is
    either the widget's own painted box, or -- when the native control is
    visually replaced (`appearance: none`, `opacity: 0`, a sibling-drawn box) --
    the `<label>` around it, which is also the element that takes the press.
    Both are measured, and the control is identified by whichever is visible.

    The LABEL's ground is its own, not the control's: the row usually sits on a
    panel the input itself is not on.
  */
  const label = c.isChoice === true ? c.labelBox ?? null : null;
  const labelGround = label
    ? effectiveBackground({
        layers: label.ancestorBackgrounds ?? [],
        fallback: c.pageBackground ?? "#ffffff",
      })
    : null;
  const labelEdge = label ? strongestEdge(label.borderSides ?? [], labelGround) : null;
  const labelFillColour = label ? parseColor(label.ownBackground) : null;
  const labelFill =
    labelFillColour && labelFillColour.a > 0
      ? {
          drawn: labelFillColour.a < 1 ? blendOver(labelFillColour, labelGround) : labelFillColour,
          ratio: ratio(
            labelFillColour.a < 1 ? blendOver(labelFillColour, labelGround) : labelFillColour,
            labelGround,
          ),
        }
      : null;

  const edgeRatio = Math.max(edge ? edge.ratio : 0, labelEdge ? labelEdge.ratio : 0);
  const fillRatio = Math.max(fill ? fill.ratio : 0, labelFill ? labelFill.ratio : 0);
  const bestRatio = Math.max(edgeRatio, fillRatio);
  const identified = bestRatio >= CONTRAST_FLOOR;

  const isLink = c.isLink === true;
  const inlineLinkInProse = isLink && c.underlined === true && c.inProse === true;

  const failures = [];
  let kind = "ok";

  if (inlineLinkInProse) {
    kind = "underlined link in prose";
  } else if (!identified) {
    kind = isLink && c.underlined !== true ? FAIL_LINK_PLAIN : FAIL_NO_EDGE;
    failures.push(kind);
  }

  /*
    The target is the control OR its label: the label is what the thumb hits.
    A bare 17px checkbox with no label of its own is still a 17px target and
    still fails.
  */
  const height = Math.max(Number(c.height) || 0, label ? Number(label.height) || 0 : 0);
  if (!inlineLinkInProse && height < MIN_TARGET_PX) {
    failures.push(FAIL_TARGET_SMALL);
    if (kind === "ok") kind = FAIL_TARGET_SMALL;
  }

  const notes = [];
  if (c.disabled === true) {
    if (!edge) notes.push("a disabled control with no drawn edge at all");
    if (c.reasonBeside !== true) {
      notes.push("no reason printed beside the disabled control");
    }
  }
  if (isLink && c.underlined === true && c.inProse !== true && !identified) {
    notes.push("an underlined link outside prose, a list item, a table cell or a heading");
  }

  return {
    kind,
    failures,
    notes,
    pass: failures.length === 0,
    edgeRatio,
    fillRatio,
    edgeSide: edge?.side ?? null,
    ground,
  };
}

/* ─────────────────────────────── the allowlist ──────────────────────────── */

/**
 * An allowlist entry is `{route, name, reason, kinds}`.
 *
 * `reason` is REQUIRED and is the point of the file: an entry with no reason is
 * how a guard becomes a place to hide failures. `route` may be `*`, which
 * matches every route -- allowed, because some controls are drawn on every
 * screen, and a star with a reason is still a written decision.
 *
 * `kinds` is REQUIRED too (UI1b-8) and is either the string `"all"` or a
 * non-empty list of keys from `FAILURE_KINDS`. There is no default: an entry
 * that does not say which kinds it covers would exempt every rule for that
 * control, which is exactly how the phone wordmark's 24px target hid behind an
 * entry whose own reason promised the target rule still applied.
 */
export function validateAllowlist(entries) {
  if (!Array.isArray(entries)) return ["the allowlist is not an array"];
  const problems = [];
  entries.forEach((entry, i) => {
    const at = `allowlist entry ${i}`;
    if (!entry || typeof entry !== "object") {
      problems.push(`${at}: not an object`);
      return;
    }
    if (!String(entry.name ?? "").trim()) problems.push(`${at}: no "name"`);
    if (!String(entry.route ?? "").trim()) problems.push(`${at}: no "route"`);
    if (!String(entry.reason ?? "").trim()) {
      problems.push(`${at} ("${entry.name ?? "?"}"): no "reason" -- an exemption without a reason hides the defect`);
    }
    const kinds = entry.kinds;
    if (kinds === undefined) {
      problems.push(
        `${at} ("${entry.name ?? "?"}"): no "kinds" -- say which failure kinds it exempts ` +
          `(${KIND_KEYS.join(", ")}, or "all"). An entry with no kinds exempts the whole ` +
          `control, so a target-size failure can hide behind an entry written about an underline`,
      );
    } else if (kinds !== "all") {
      if (!Array.isArray(kinds) || !kinds.length) {
        problems.push(
          `${at} ("${entry.name ?? "?"}"): "kinds" must be "all" or a non-empty list of ${KIND_KEYS.join(", ")}`,
        );
      } else {
        for (const kind of kinds) {
          if (!KIND_KEYS.includes(kind)) {
            problems.push(
              `${at} ("${entry.name ?? "?"}"): "${kind}" is not a failure kind ` +
                `(one of ${KIND_KEYS.join(", ")})`,
            );
          }
        }
      }
    }
  });
  return problems;
}

/** Does this entry's `kinds` admit this failure kind? */
export function entryCoversKind(entry, kind) {
  const kinds = entry?.kinds;
  if (kinds === "all") return true;
  return Array.isArray(kinds) && kinds.includes(kind);
}

/**
 * The failure-kind keys a measured record carries.
 *
 * A record carries `failures` (the labels it failed on). The fallback to
 * `kind` reads a bare `{kind}` row -- the shape the margin tests use -- so the
 * two halves of the report agree on what a record is.
 */
export function failureKindKeys(failure) {
  const labels = Array.isArray(failure?.failures) && failure.failures.length
    ? failure.failures
    : failure?.kind
      ? [failure.kind]
      : [];
  const keys = labels.map(kindKeyOf).filter(Boolean);
  return [...new Set(keys)];
}

/** Same control on the same route? The name and route half of a match. */
function namesTheSameControl(entry, failure) {
  if (String(entry?.name ?? "") !== String(failure?.name ?? "")) return false;
  const route = String(entry?.route ?? "");
  return route === "*" || route === String(failure?.route ?? "");
}

/**
 * Does this entry say anything about this failure?
 *
 * Used by the stale check: an entry is live while it still meets a failure it
 * was written for. An entry that covers only the underline kind still "matches"
 * a record that failed both the underline and the target rule -- it is not
 * stale, it is simply partial, and `exemptFailures` below is where partial
 * means partial.
 */
export function entryMatches(entry, failure) {
  if (!entry || !failure) return false;
  if (!namesTheSameControl(entry, failure)) return false;
  return failureKindKeys(failure).some((kind) => entryCoversKind(entry, kind));
}

/**
 * The entries that exempt nothing, i.e. the entries that must be deleted.
 *
 * The comparison is against the FAILURES this run found, not against every
 * control it saw. An entry exists to cover a known, written-down exception; if
 * the control passes now, the entry is a leftover that would silently cover the
 * defect if it ever came back, and the walk fails until somebody deletes it.
 * That is the same "a guard that cannot fail loudly can only drift quietly"
 * rule the rest of `scripts/` is built on.
 */
export function staleAllowlistEntries(entries, failures) {
  return (entries ?? []).filter(
    (entry) => !(failures ?? []).some((failure) => entryMatches(entry, failure)),
  );
}

/**
 * The failures left once the allowlist has taken its share.
 *
 * PER KIND, NOT PER RECORD (UI1b-8). A record with two failures is exempt only
 * when the entries for that control cover BOTH kinds -- so the wordmark's
 * underline entry cannot swallow a target-size failure on the same link. The
 * kinds are pooled across the entries that name the same control, so two
 * written decisions ("the underline, and the edge") still add up to one
 * exemption.
 */
export function exemptFailures(entries, failures) {
  return (failures ?? []).filter((failure) => {
    const kinds = failureKindKeys(failure);
    if (!kinds.length) return true;
    const forThisControl = (entries ?? []).filter((entry) => namesTheSameControl(entry, failure));
    return !kinds.every((kind) => forThisControl.some((entry) => entryCoversKind(entry, kind)));
  });
}

/* ───────────────────────────── the margins ──────────────────────────────── */

/**
 * How close the CLOSEST passing controls are to the two thresholds (UI1b-6).
 *
 * A guard with no headroom is a guard that goes red on somebody else's machine.
 * CI runs headless Chromium on Linux, in UTC, with different fonts: a control
 * that measures 44.0px here can measure 43.7 there, and a chip that clears the
 * floor at 3.02:1 can land at 2.98. So the walk reports the closest margins on
 * every run -- and this machine's numbers are compared against them -- rather
 * than leaving "it passed" to mean "it passed by however much".
 *
 * `height` is reported in CSS pixels above 44, `contrast` in ratio points above
 * 3. `flakeHeight`/`flakeContrast` are the headroom that counts as too thin:
 * a control AT 44 or 45px, or a ratio under 3.1:1. A flake risk is reported,
 * never silently tolerated -- and the fix is headroom in the CSS, not an entry
 * in the allowlist, because an allowlisted control is exempt from the rule
 * rather than safe under it.
 *
 * Links inside prose are left out of both lists: the rule does not apply to
 * them (an underlined link in a sentence is the design system's one plain-text
 * form), so their numbers are not margins on anything.
 */
export function closestMargins(
  controls,
  { limit = 8, flakeHeight = 1, flakeContrast = 0.1 } = {},
) {
  const heights = [];
  const contrasts = [];
  for (const control of controls ?? []) {
    /*
      FAILING controls are not margins: the wordmark in the allowlist measures
      24px, and listing that as "-20px below the line" would bury the controls
      this list exists to show. The rule does not apply to an underlined prose
      link either, so its numbers are a margin on nothing.
    */
    if (!control || control.kind === "underlined link in prose") continue;
    if (control.failures && control.failures.length) continue;
    const where = {
      route: control.route ?? "",
      theme: control.theme ?? "",
      viewport: control.viewport ?? null,
      name: (control.name ?? "").slice(0, 60),
      selector: control.selector ?? "",
    };
    const height = Number(control.height);
    if (Number.isFinite(height)) {
      heights.push({
        ...where,
        height,
        minHeight: Number(control.minHeight) || 0,
        margin: Number((height - MIN_TARGET_PX).toFixed(2)),
      });
    }
    const best = Math.max(Number(control.edgeRatio) || 0, Number(control.fillRatio) || 0);
    contrasts.push({ ...where, ratio: Number(best.toFixed(3)), margin: Number((best - CONTRAST_FLOOR).toFixed(3)) });
  }
  const byMargin = (a, b) => a.margin - b.margin;
  const flakeRisks = [
    /*
      A height risk is a control that is close to the line AND NOT pinned
      there: `min-height: 44px` is the desk's declared floor and measures 44
      everywhere, so a button at exactly 44px is the rule being obeyed, not a
      coin landing on its edge. A control at 44-45px with NO declared floor is
      sized by its font, and fonts differ between this machine and CI.
    */
    ...heights
      .filter((h) => h.margin <= flakeHeight && h.minHeight < MIN_TARGET_PX)
      .map((h) => ({ ...h, measure: "height" })),
    ...contrasts
      .filter((c) => c.margin < flakeContrast)
      .map((c) => ({ ...c, measure: "contrast" })),
  ];
  return {
    heights: heights.sort(byMargin).slice(0, limit),
    contrasts: contrasts.sort(byMargin).slice(0, limit),
    flakeRisks,
  };
}

/* ────────────────────────────── the exit code ───────────────────────────── */

/**
 * What the walk exits with, from what it found.
 *
 * UI1b's first step shipped this guard with a TEMPORARY switch,
 * `GUARD_BASELINE_ONLY=1`, because on that day's build the walk was red by
 * design: 463 controls were still plain text and the failure count WAS the
 * deliverable. CI set it so the build stayed green while the conversion ran,
 * and the last step of UI1b deletes it. This function is the deletion's
 * measurable form, and `scripts/desk-clickable-guard.test.mjs` drives it: with
 * the switch gone, a single failing control FAILS THE BUILD.
 *
 * `reportOnly` is the developer's local escape hatch --
 * `GUARD_REPORT_ONLY=1` -- for looking at a report on a build that is expected
 * to be red. It defaults OFF, CI never sets it, and the property that matters
 * is asserted both ways below rather than assumed.
 */
export function guardExitCode({ failures = 0, reportOnly = false } = {}) {
  if (!failures) return 0;
  return reportOnly ? 0 : 1;
}

/* ─────────────────────────────── the visit plan ─────────────────────────── */

/**
 * Every page this walk will measure: each route, in both themes, at 1280, and
 * in the light theme again at 390.
 *
 * The phone visit is light-only because 390 is where the light theme is the
 * reader's default and the nav becomes an off-canvas drawer; the dark phone is
 * a shape no editor has asked about yet, and the brief names light at 390. Both
 * themes at the desk width is the pair that matters -- the auditor's 463 hits
 * came from both, and the `.night` block redefines every colour the light block
 * sets, so a control can be visible in one and invisible in the other.
 *
 * THIS FUNCTION IS THE "BOTH THEMES" PROOF, and it is deliberately pure: the
 * walk passes its own route list in and visits exactly what comes back, so a
 * later edit that quietly drops `night` fails
 * `scripts/desk-clickable-guard.test.mjs` without a browser.
 */
export function planVisits(
  routes,
  { themes = DESK_THEMES, deskWidth = DESK_WIDTH, phoneWidth = PHONE_WIDTH } = {},
) {
  const plan = [];
  for (const route of routes ?? []) {
    for (const theme of themes) {
      plan.push({ route, theme, viewport: deskWidth });
    }
    plan.push({ route, theme: themes[0] ?? "light", viewport: phoneWidth });
  }
  return plan;
}
