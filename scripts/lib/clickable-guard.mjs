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

  const edgeRatio = edge ? edge.ratio : 0;
  const fillRatio = fill ? fill.ratio : 0;
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

  const height = Number(c.height) || 0;
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
 * An allowlist entry is `{route, name, reason}`.
 *
 * `reason` is REQUIRED and is the point of the file: an entry with no reason is
 * how a guard becomes a place to hide failures. `route` may be `*`, which
 * matches every route -- allowed, because some controls are drawn on every
 * screen, and a star with a reason is still a written decision.
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
  });
  return problems;
}

/** Does this entry cover this failure? Route `*` covers every route. */
export function entryMatches(entry, failure) {
  if (!entry || !failure) return false;
  if (String(entry.name ?? "") !== String(failure.name ?? "")) return false;
  const route = String(entry.route ?? "");
  return route === "*" || route === String(failure.route ?? "");
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

/** The failures left once the allowlist has taken its share. */
export function exemptFailures(entries, failures) {
  return (failures ?? []).filter(
    (failure) => !(entries ?? []).some((entry) => entryMatches(entry, failure)),
  );
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
