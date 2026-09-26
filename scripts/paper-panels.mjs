#!/usr/bin/env node
/**
 * The paper's two ink panels, measured in a real browser.
 *
 * Unit BD shipped two panels that look right in a diff and are wrong on the
 * page: the front page's "This week" painted the reader's cream page colour
 * instead of the ink block, so white event text and white date numbers sat on
 * cream; and the article's "Dates in this story" let long link text run out
 * past the panel's right edge, clipping the host off the page.
 *
 * Neither defect was visible to the instruments that existed. `contrast-audit`
 * resolves the DESK's tokens and never reads the reader's palette.
 * `public-a11y-floor` measures font sizes. The BD harness measured
 * `documentElement.scrollWidth <= innerWidth`, and the article page had
 * `overflow-x: hidden` ancestors, so clipped text kept the document exactly
 * viewport-wide while running off the panel. So this is a browser check with
 * two instruments aimed at the panels themselves:
 *
 *   1. CONTRAST. For every text-bearing element inside the panel, composite the
 *      text colour over the nearest ancestor whose background is not
 *      transparent, and fail under 4.5:1. This is the check that was missing:
 *      "white text on the page's own background" is invisible to a font-size
 *      floor and to a token audit, and is exactly what a reader cannot read.
 *   2. EDGE. No text element's right edge may pass its panel's right edge.
 *      Measured on the element's own box (getBoundingClientRect), which is not
 *      clipped by an ancestor's `overflow: hidden` -- the property that let the
 *      article defect survive `scrollWidth` measurement.
 *   3. WORD SPLITS. No word in the panel's event text may be broken across two
 *      lines. Unit BD3 found a panel that fit its box exactly and was still
 *      wrong to read: `overflow-wrap: anywhere` broke "attachments" into
 *      "attachmen / ts" and the host into "gmont- / .gov", which is inside the
 *      panel, inside the contrast floor, and unreadable. Instrument 2 measures
 *      boxes; a box cannot see this. So for every word in a text node the panel
 *      prints, a Range is set over the word's own character offsets and its
 *      client rects counted: one rect is a word on one line, more than one is a
 *      word split across a break. The event text is `.datewhat` and its items;
 *      the domain line (`.datenote`) is exempt by owner ruling -- a host longer
 *      than the line has nowhere else to go and `anywhere` is allowed to break
 *      it -- and the exempt words are counted, not hidden.
 *
 * A third, coarser assertion keeps the first from being satisfied by accident:
 * the panel's own computed background must be the reader's `--block` token, in
 * both themes. In the dark theme a cream panel is a low-contrast failure too,
 * but the tokens are what the design hands over, and the panel is the block.
 *
 * Both panels, both themes. Fails loudly on a missing panel, an unmatched panel
 * heading, or a theme that was asked for and did not apply -- an instrument that
 * passes because it measured nothing is worse than no instrument.
 *
 *   PAPER_PANELS_BASE_URL=http://127.0.0.1:8090 node scripts/paper-panels.mjs
 *
 * `PAPER_PANELS_ARTICLE_PATH` pins the article path (default: resolved from the
 * app's own /sitemap.xml, like public-a11y-floor.mjs).
 */
import { chromium } from "playwright";
import { checkedUrl } from "./browser-guard.mjs";

const base = checkedUrl(process.env.PAPER_PANELS_BASE_URL || "http://127.0.0.1:8080").replace(
  /\/$/,
  "",
);

/** WCAG 2.x AA for body text. The panels are body text, not large print. */
const MIN_CONTRAST = 4.5;
/** A sub-pixel seam between a text box and the edge it sits on is not a defect. */
const EDGE_TOLERANCE_PX = 1;
/** The reader's own storage key shape; the paper name is part of it. */
const READER_KEY_PREFIX = "townreporter:reader:";
/**
 * Where a word is allowed to be broken across lines: the domain line under an
 * event. A host longer than the panel's line has no space to break at, so it
 * breaks inside the word rather than running past the edge, and the event text
 * above it is what must stay whole.
 */
const WORD_SPLIT_ALLOWED = ".datenote";

const TARGETS = [
  {
    name: "this-week",
    route: "/",
    selectors: [".ledgerow .datespanel", ".datespanel"],
    head: /this week/i,
  },
  {
    name: "dates-in-this-story",
    route: null, // resolved below
    selectors: [".articleaside .datespanel", ".datespanel"],
    head: /dates in this story/i,
  },
];

const THEMES = [
  { name: "light", dark: false },
  { name: "dark", dark: true },
];

async function resolveArticlePath(baseUrl) {
  if (process.env.PAPER_PANELS_ARTICLE_PATH) return process.env.PAPER_PANELS_ARTICLE_PATH;
  const res = await fetch(`${baseUrl}/sitemap.xml`);
  if (!res.ok) {
    throw new Error(`sitemap.xml returned ${res.status}; cannot resolve an article path`);
  }
  const xml = await res.text();
  const match = xml.match(/<loc>[^<]*\/articles\/([^<]+)<\/loc>/i);
  if (!match) {
    throw new Error("sitemap.xml contained no /articles/ URL; cannot resolve an article path");
  }
  return `/articles/${match[1]}`;
}

/**
 * Everything the check asserts, run inside the page.
 *
 * Colour maths is done in the page because `getComputedStyle` is the only thing
 * that knows what the cascade actually resolved to: the front page's panel was
 * cream because a three-class rule beat a two-class one, which no amount of
 * reading the source makes obvious.
 */
function auditPanels(cfg) {
  const parseColor = (value) => {
    if (!value) return null;
    const s = String(value).trim().toLowerCase();
    if (s === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
    const hex = s.match(/^#([0-9a-f]{3,8})$/);
    if (hex) {
      const h = hex[1];
      const dup = (c) => parseInt(c + c, 16);
      if (h.length === 3) return { r: dup(h[0]), g: dup(h[1]), b: dup(h[2]), a: 1 };
      if (h.length === 4)
        return { r: dup(h[0]), g: dup(h[1]), b: dup(h[2]), a: dup(h[3]) / 255 };
      if (h.length === 6)
        return {
          r: parseInt(h.slice(0, 2), 16),
          g: parseInt(h.slice(2, 4), 16),
          b: parseInt(h.slice(4, 6), 16),
          a: 1,
        };
      if (h.length === 8)
        return {
          r: parseInt(h.slice(0, 2), 16),
          g: parseInt(h.slice(2, 4), 16),
          b: parseInt(h.slice(4, 6), 16),
          a: parseInt(h.slice(6, 8), 16) / 255,
        };
      return null;
    }
    const fn = s.match(/^rgba?\(([^)]+)\)$/);
    if (fn) {
      const parts = fn[1]
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map(Number);
      if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return null;
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    }
    return null;
  };
  /** `fg` (possibly translucent) over an opaque `bg`. */
  const over = (fg, bg) => ({
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  });
  const luminance = (c) => {
    const ch = (v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * ch(c.r) + 0.7152 * ch(c.g) + 0.0722 * ch(c.b);
  };
  const contrast = (a, b) => {
    const la = luminance(a);
    const lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  };
  const rgbText = (c) =>
    `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;
  const identify = (el) =>
    `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).join(".") : ""}`;

  const panels = [];
  for (const target of cfg.targets) {
    let panel = null;
    for (const sel of target.selectors) {
      panel = document.querySelector(sel);
      if (panel) break;
    }
    if (!panel) {
      panels.push({ name: target.name, fatal: `no panel matched ${target.selectors.join(" | ")}` });
      continue;
    }
    const panelRect = panel.getBoundingClientRect();
    const panelStyle = getComputedStyle(panel);
    const headEl = panel.querySelector("h2");
    const head = headEl ? (headEl.textContent || "").trim() : "";
    const entry = {
      name: target.name,
      route: location.pathname,
      head,
      headMatches: new RegExp(target.head, "i").test(head),
      panel: identify(panel),
      panelRect: {
        left: Math.round(panelRect.left),
        right: Math.round(panelRect.right),
        width: Math.round(panelRect.width),
      },
      panelBgComputed: panelStyle.backgroundColor,
      blockToken: (panelStyle.getPropertyValue("--block") || "").trim(),
      textElements: 0,
      wordsMeasured: 0,
      domainWords: 0,
      splitWords: [],
      domainSplitWords: [],
      contrastViolations: [],
      edgeViolations: [],
      minRatio: null,
      worstRightOverhang: 0,
      themeApplied: true,
    };

    // The coarser assertion: the panel is the ink block, in both themes.
    const panelBg = parseColor(panelStyle.backgroundColor);
    const token = parseColor(entry.blockToken);
    if (!token) {
      entry.blockTokenUnreadable = true;
    } else if (!panelBg || panelBg.a !== 1) {
      entry.blockMismatch = `panel background is ${panelStyle.backgroundColor}, not an opaque --block`;
    } else if (
      Math.round(panelBg.r) !== Math.round(token.r) ||
      Math.round(panelBg.g) !== Math.round(token.g) ||
      Math.round(panelBg.b) !== Math.round(token.b)
    ) {
      entry.blockMismatch = `panel background ${rgbText(panelBg)} is not --block ${entry.blockToken}`;
    }

    const walker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    let minRatio = Infinity;
    let node = walker.nextNode();
    while (node) {
      const text = (node.textContent || "").trim();
      const el = node.parentElement;
      node = walker.nextNode();
      if (!text || !el || seen.has(el)) continue;
      seen.add(el);
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const hidden =
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) === 0 ||
        rect.width === 0 ||
        rect.height === 0 ||
        el.closest(".vh");
      if (hidden) continue;
      entry.textElements += 1;

      /*
        The background a reader actually sees behind this text: walk up until
        an opaque background is found, compositing any translucent ones on the
        way. The canvas behind everything is white.
      */
      const stack = [];
      let sourceEl = null;
      let cursor = el;
      while (cursor) {
        const c = parseColor(getComputedStyle(cursor).backgroundColor);
        if (c && c.a > 0) {
          stack.push(c);
          if (c.a === 1) {
            sourceEl = cursor;
            break;
          }
        }
        cursor = cursor.parentElement;
      }
      let bg = { r: 255, g: 255, b: 255, a: 1 };
      for (let i = stack.length - 1; i >= 0; i -= 1) bg = over(stack[i], bg);
      const fgRaw = parseColor(style.color);
      const fg = fgRaw && fgRaw.a < 1 ? over(fgRaw, bg) : fgRaw;
      if (!fg) continue;

      const ratio = contrast(fg, bg);
      if (ratio < minRatio) minRatio = ratio;
      if (ratio < cfg.minContrast) {
        entry.contrastViolations.push({
          tag: el.tagName.toLowerCase(),
          cls: typeof el.className === "string" ? el.className.slice(0, 60) : "",
          text: text.slice(0, 60),
          color: rgbText(fg),
          background: rgbText(bg),
          backgroundFrom: sourceEl ? identify(sourceEl) : "canvas (no opaque ancestor)",
          ratio: Math.round(ratio * 100) / 100,
        });
      }

      const overhang = Math.round(rect.right - panelRect.right);
      if (overhang > entry.worstRightOverhang) entry.worstRightOverhang = overhang;
      if (rect.right > panelRect.right + cfg.tolerance) {
        entry.edgeViolations.push({
          tag: el.tagName.toLowerCase(),
          cls: typeof el.className === "string" ? el.className.slice(0, 60) : "",
          text: text.slice(0, 60),
          textRight: Math.round(rect.right),
          panelRight: Math.round(panelRect.right),
          overhangPx: overhang,
        });
      }
    }
    entry.minRatio = minRatio === Infinity ? null : Math.round(minRatio * 100) / 100;

    /*
      The word-split pass. A Range over a word's own character offsets has one
      client rect per line the word occupies, so `rects.length > 1` is a word
      broken at a line break. Done per text node, and the node's word count is
      checked against the number of ranges measured, so a node that quietly
      measured nothing is a violation rather than a pass.
    */
    const invisible = (el) => {
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (
        style.display === "none" ||
        style.visibility === "hidden" ||
        Number(style.opacity) === 0 ||
        rect.width === 0 ||
        rect.height === 0 ||
        el.closest(".vh")
      );
    };
    const wordWalker = document.createTreeWalker(panel, NodeFilter.SHOW_TEXT);
    let wordNode = wordWalker.nextNode();
    while (wordNode) {
      const textNode = wordNode;
      const nodeText = textNode.textContent || "";
      const el = textNode.parentElement;
      wordNode = wordWalker.nextNode();
      if (!nodeText.trim() || !el || invisible(el)) continue;
      const words = [...nodeText.matchAll(/\S+/g)];
      if (!words.length) continue;
      const exempt = Boolean(el.closest(cfg.wordSplitAllowed));
      const range = document.createRange();
      let measured = 0;
      words.forEach((match) => {
        const word = match[0];
        const at = match.index;
        range.setStart(textNode, at);
        range.setEnd(textNode, at + word.length);
        const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
        measured += 1;
        if (exempt) entry.domainWords += 1;
        if (rects.length > 1) {
          entry[exempt ? "domainSplitWords" : "splitWords"].push({
            tag: el.tagName.toLowerCase(),
            cls: typeof el.className === "string" ? el.className.slice(0, 60) : "",
            word: word.slice(0, 40),
            wordOf: words.length,
            rects: rects.length,
            lines: [...new Set(rects.map((r) => Math.round(r.top)))],
            text: nodeText.trim().slice(0, 80),
          });
        }
      });
      entry.wordsMeasured += measured;
      if (measured !== words.length) {
        entry.wordCountMismatch = `${measured} ranges measured against ${words.length} words in "${nodeText.trim().slice(0, 40)}"`;
      }
    }

    panels.push(entry);
  }

  return {
    panels,
    appearance: document.documentElement.getAttribute("data-appearance"),
    readerModeClass: (() => {
      const r = document.querySelector(".reader");
      return r ? [...r.classList].filter((c) => c.startsWith("mode-")).join(" ") : "";
    })(),
  };
}

const report = { ok: false, base, minContrast: MIN_CONTRAST, panels: [], violations: [] };

/**
 * The reader's blob key, which is `townreporter:reader:<paper>:<city>`.
 *
 * The app writes that key only when a reader changes something, so on a fresh
 * context there is nothing in localStorage to find and it has to be built from
 * the page's own wordmark and town -- the same two strings the reader component
 * passes to `readerStorageKey`. A pin is available, and if the key is wrong the
 * run does not quietly measure light twice: the theme assertion below fails.
 */
async function findReaderKey(page) {
  if (process.env.PAPER_PANELS_READER_KEY) return process.env.PAPER_PANELS_READER_KEY;
  const existing = await page.evaluate(
    (prefix) => Object.keys(localStorage).find((k) => k.startsWith(prefix)) || null,
    READER_KEY_PREFIX,
  );
  if (existing) return existing;
  const identity = await page.evaluate(() => ({
    name: (document.querySelector("header .brand")?.textContent || "").trim(),
    city: (document.querySelector("header .locality")?.textContent || "").trim(),
  }));
  if (!identity.name || !identity.city) return null;
  return `${READER_KEY_PREFIX}${encodeURIComponent(identity.name)}:${encodeURIComponent(identity.city)}`;
}

const readerKey = await (async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
    const page = await context.newPage();
    await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
    return await findReaderKey(page);
  } finally {
    await browser.close();
  }
})();
if (!readerKey) {
  throw new Error(
    `could not determine the reader's storage key from ${base}/ (no wordmark/town in the ` +
      `masthead and no "${READER_KEY_PREFIX}" key in localStorage); pin it with ` +
      `PAPER_PANELS_READER_KEY`,
  );
}
report.readerKey = readerKey;

const articlePath = TARGETS[1].route || (await resolveArticlePath(base));
TARGETS[1].route = articlePath;

const browser = await chromium.launch({ headless: true });
try {
  for (const theme of THEMES) {
    // One context per theme: the reader's blob is per-paper localStorage, and
    // carrying it between themes is how a "dark" measurement silently becomes a
    // second light one.
    const context = await browser.newContext({ viewport: { width: 1280, height: 1400 } });
    await context.addInitScript(
      ([k, dark]) => localStorage.setItem(k, JSON.stringify({ dark, size: 21, saved: [] })),
      [readerKey, theme.dark],
    );
    const page = await context.newPage();

    for (const target of TARGETS) {
      await page.goto(`${base}${target.route}`, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(400);
      const measured = await page.evaluate(auditPanels, {
        targets: [{ name: target.name, selectors: target.selectors, head: target.head.source }],
        minContrast: MIN_CONTRAST,
        tolerance: EDGE_TOLERANCE_PX,
        wordSplitAllowed: WORD_SPLIT_ALLOWED,
      });
      const panel = measured.panels[0];
      panel.theme = theme.name;
      const appearance = measured.appearance;
      panel.appearance = appearance;
      panel.readerModeClass = measured.readerModeClass;
      /*
        `data-appearance` is only ever stamped `reader-dark` / `desk-dark`; the
        light theme is the attribute's absence, so "light was applied" is
        "dark was not". Asserted both ways so a dark run that stayed light
        cannot pass as a light one.
      */
      const darkApplied =
        appearance === "reader-dark" || measured.readerModeClass.includes("mode-dark");
      panel.themeApplied = theme.dark ? darkApplied : !darkApplied;
      report.panels.push(panel);

      const where = `${target.name}/${theme.name}`;
      if (panel.fatal) {
        report.violations.push({ where, kind: "missing-panel", detail: panel.fatal });
        continue;
      }
      // A check that measures nothing must not pass.
      if (!panel.headMatches) {
        report.violations.push({
          where,
          kind: "wrong-panel",
          detail: `panel heading is "${panel.head}", expected ${target.head}`,
        });
      }
      if (panel.textElements === 0) {
        report.violations.push({ where, kind: "no-text", detail: "panel contained no text" });
      }
      if (panel.blockTokenUnreadable) {
        report.violations.push({
          where,
          kind: "no-block-token",
          detail: "could not read --block off the panel; the panel check is blind",
        });
      } else if (panel.blockMismatch) {
        report.violations.push({ where, kind: "not-the-ink-block", detail: panel.blockMismatch });
      }
      if (!panel.themeApplied) {
        report.violations.push({
          where,
          kind: "theme-not-applied",
          detail: `asked for ${theme.name}, data-appearance is ${appearance}, reader classes "${measured.readerModeClass}"`,
        });
      }
      for (const v of panel.contrastViolations.slice(0, 40)) {
        report.violations.push({ where, kind: "contrast", detail: v });
      }
      for (const v of panel.edgeViolations.slice(0, 40)) {
        report.violations.push({ where, kind: "past-panel-edge", detail: v });
      }
      // A word-split check that measured no words must not pass.
      if (panel.wordsMeasured === 0) {
        report.violations.push({
          where,
          kind: "no-words-measured",
          detail: "the panel's text was not measured for word splits",
        });
      }
      if (panel.wordCountMismatch) {
        report.violations.push({ where, kind: "word-count-mismatch", detail: panel.wordCountMismatch });
      }
      for (const v of (panel.splitWords || []).slice(0, 40)) {
        report.violations.push({ where, kind: "split-word", detail: v });
      }
    }
    await context.close();
  }
} finally {
  await browser.close();
}

report.totalViolations = report.violations.length;
report.ok = report.totalViolations === 0;
report.summary = report.panels.map((p) => ({
  where: `${p.name}/${p.theme ?? "?"}`,
  head: p.head,
  themeApplied: p.themeApplied,
  textElements: p.textElements,
  minRatio: p.minRatio,
  worstRightOverhang: p.worstRightOverhang,
  panelBg: p.panelBgComputed,
  blockToken: p.blockToken,
  contrastViolations: (p.contrastViolations || []).length,
  edgeViolations: (p.edgeViolations || []).length,
  wordsMeasured: p.wordsMeasured,
  splitWords: (p.splitWords || []).length,
  domainWordsMeasured: p.domainWords,
  domainWordsSplit: (p.domainSplitWords || []).length,
}));

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exit(1);
