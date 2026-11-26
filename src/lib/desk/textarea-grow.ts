/**
 * Every desk text box grows to fit its text -- the fallback.
 *
 * The desk's textareas grow in CSS (`field-sizing: content`, src/desk-astra.css)
 * wherever the browser supports it. This file is the one small fallback for
 * browsers that do not: it is installed once from the desk layout and it
 * covers portal dialogs too, because it listens on the document rather than on
 * each box.
 *
 * The design is the same in both places:
 *   - the box is at least its `rows` height, the size it has today when empty;
 *   - it grows as text is typed, pasted, or set by code;
 *   - it shrinks again when text is removed;
 *   - it stops growing at 70% of the window height and scrolls inside after.
 *
 * The arithmetic lives in `textareaGrowSize`, a pure function, so a unit test
 * can drive the floor, the cap, growth and shrink without a browser.
 */

/** The one thing this fallback asks of the browser's CSS object. */
export type CssSupports = { supports(property: string, value: string): boolean };

/** The share of the window height a box may grow to before it scrolls. */
export const TEXTAREA_GROW_CAP = 0.7;

/** Rows used when a textarea carries no `rows` attribute (the HTML default). */
export const TEXTAREA_DEFAULT_ROWS = 2;

/** What one textarea measures, in CSS pixels. */
export type TextareaGrowMeasure = {
  /** The `rows` attribute; a missing or bad value reads as 2. */
  rows: number;
  /** One line's height, from `line-height`. */
  lineHeightPx: number;
  /** Padding and border, top and bottom together. */
  framePx: number;
  /** Border, top and bottom together. `scrollHeight` already counts padding. */
  borderPx: number;
  /** The textarea's own content height before any height is set. */
  scrollHeightPx: number;
  /** The window's inner height. */
  viewportHeightPx: number;
  /**
   * A floor that is taller than the rows height, in border-box pixels, from
   * `--desk-ta-min` or a computed `min-height` (a box the design already drew
   * taller than its rows). Absent or 0 means the rows height alone.
   */
  minHeightPx?: number;
};

/** The height to give the box, and whether it hit the cap. */
export type TextareaGrowSize = {
  /** Border-box height in CSS pixels. */
  heightPx: number;
  /** True when the text wants more room than the cap allows. */
  capped: boolean;
};

/**
 * The floor: the box empty, at its `rows` height.
 */
export function textareaRowsHeight(rows: number, lineHeightPx: number, framePx: number): number {
  const wantedRows = Number.isFinite(rows) && rows > 0 ? Math.floor(rows) : TEXTAREA_DEFAULT_ROWS;
  return wantedRows * Math.max(0, lineHeightPx) + Math.max(0, framePx);
}

/**
 * The height to give the box.
 *
 * `scrollHeight` is the text's own height and already includes padding, so the
 * border is added here. The result is never below the floor and never above the
 * cap. The floor is the taller of the rows height and any `min-height` the
 * design already set (a box that is taller than its rows when empty). When 70%
 * of the window is less than the floor (a very short window), the floor wins:
 * the design says a box never gets shorter than it is today when empty.
 */
export function textareaGrowSize(measure: TextareaGrowMeasure): TextareaGrowSize {
  const rowsFloor = textareaRowsHeight(measure.rows, measure.lineHeightPx, measure.framePx);
  const floor = Math.max(rowsFloor, Math.max(0, measure.minHeightPx ?? 0));
  const content = Math.max(0, measure.scrollHeightPx) + Math.max(0, measure.borderPx);
  const cap = Math.max(floor, Math.max(0, measure.viewportHeightPx) * TEXTAREA_GROW_CAP);
  const wanted = Math.max(floor, content);
  const heightPx = Math.min(wanted, cap);
  return { heightPx, capped: wanted > cap };
}

/** What the fallback needs from the window, as structure rather than DOM names. */
export type GrowWindow = {
  innerHeight: number;
  CSS?: CssSupports;
  HTMLTextAreaElement: typeof HTMLTextAreaElement;
  MutationObserver: typeof MutationObserver;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (id: number) => void;
  setTimeout: (callback: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
  addEventListener: (type: string, listener: (event: Event) => void, options?: boolean) => void;
  removeEventListener: (type: string, listener: (event: Event) => void, options?: boolean) => void;
  getComputedStyle: (el: Element) => CSSStyleDeclaration;
};

/** The fields the story editor already sizes with its own code. */
export const TEXTAREA_GROW_EXCLUDED = ".astra-headline,.astra-dek,.astra-story-body";

/**
 * True when the CSS path cannot do the job: `field-sizing: content` grows the
 * box, and a typed `attr(rows)` gives it the floor. Both must be supported.
 * A browser with the first but not the second would draw empty boxes one line
 * tall, so it takes the fallback as well.
 */
export function needsTextareaGrowFallback(css: CssSupports | undefined): boolean {
  if (!css) return true;
  const grows = css.supports("field-sizing", "content");
  const floors =
    css.supports("min-height", "calc(attr(rows type(<integer>), 2) * 1lh + 1px)") &&
    css.supports("min-height", "1lh");
  return !(grows && floors);
}

/**
 * Measure and resize one textarea in the fallback. Returns nothing; the box's
 * inline height is what changes.
 */
function resizeOne(el: HTMLTextAreaElement, win: GrowWindow): void {
  if (el.matches(TEXTAREA_GROW_EXCLUDED)) return;
  const style = win.getComputedStyle(el);
  // A box in a shut dialog has no layout yet; measure it when it opens.
  if (el.offsetParent === null && style.position !== "fixed") return;

  const lineHeight = Number.parseFloat(style.lineHeight);
  const fontSize = Number.parseFloat(style.fontSize) || 16;
  const lineHeightPx = Number.isFinite(lineHeight) ? lineHeight : fontSize * 1.2;
  const paddingPx =
    (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0);
  const borderPx =
    (Number.parseFloat(style.borderTopWidth) || 0) +
    (Number.parseFloat(style.borderBottomWidth) || 0);

  const rows = el.rows;
  const boxSizing = style.boxSizing;
  /*
    A box the design already draws taller than its rows when empty keeps that
    height. The CSS floor rule names it `--desk-ta-min`; a browser that cannot
    read that declaration still reports the older `min-height` here, and an
    inline one (a dialog's `style={{ minHeight: 60 }}`) only shows up this way.
    Take whichever is taller. Values are border-box, like the rows floor.
  */
  const customFloor = Number.parseFloat(style.getPropertyValue("--desk-ta-min"));
  const computedFloor = Number.parseFloat(style.minHeight);
  const computedFloorBorderBox =
    Number.isFinite(computedFloor) && boxSizing === "content-box"
      ? computedFloor + paddingPx + borderPx
      : computedFloor;
  const minHeightPx = Math.max(
    Number.isFinite(customFloor) ? customFloor : 0,
    Number.isFinite(computedFloorBorderBox) ? computedFloorBorderBox : 0,
  );

  const previous = el.style.height;
  el.style.height = "auto";
  const scrollHeightPx = el.scrollHeight;
  el.style.height = previous;

  const size = textareaGrowSize({
    rows,
    lineHeightPx,
    framePx: paddingPx + borderPx,
    borderPx,
    scrollHeightPx,
    viewportHeightPx: win.innerHeight,
    minHeightPx,
  });

  // `style.height` is read against the box model: content-box wants the
  // content height, border-box the whole box.
  const inlineHeight =
    boxSizing === "border-box" ? size.heightPx : size.heightPx - paddingPx - borderPx;
  el.style.height = `${Math.max(0, Math.round(inlineHeight))}px`;
}

/**
 * Install the fallback. Call once from the desk layout; the returned function
 * removes every listener and gives the prototype back.
 */
export function installDeskTextareaGrow(doc: Document): () => void {
  const win = doc.defaultView as unknown as GrowWindow | null;
  if (!win) return () => {};
  if (!needsTextareaGrowFallback(win.CSS)) return () => {};

  const all = (): HTMLTextAreaElement[] => [
    ...doc.querySelectorAll<HTMLTextAreaElement>("textarea"),
  ];
  const resizeAll = (): void => {
    for (const el of all()) resizeOne(el, win);
  };

  let frame = 0;
  const schedule = (): void => {
    if (frame) return;
    const raf = win.requestAnimationFrame;
    if (typeof raf === "function") {
      frame = raf(() => {
        frame = 0;
        resizeAll();
      });
    } else {
      frame = win.setTimeout(() => {
        frame = 0;
        resizeAll();
      }, 16);
    }
  };

  const onInput = (event: Event): void => {
    const target = event.target as HTMLTextAreaElement | null;
    if (target && target.tagName === "TEXTAREA") resizeOne(target, win);
    else schedule();
  };

  doc.addEventListener("input", onInput, true);
  doc.addEventListener("change", onInput, true);
  doc.addEventListener("focusin", onInput, true);
  win.addEventListener("resize", schedule);

  /*
    React sets a controlled textarea's value through the element property, not
    through an input event, so a Pull, a loaded draft or a reset would not
    otherwise be seen. React's own value tracker sets the instance property and
    then calls this prototype setter, so wrapping it catches both code and the
    browser's own typing.
  */
  const proto = win.HTMLTextAreaElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  if (descriptor?.set) {
    Object.defineProperty(proto, "value", {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: descriptor.get,
      set(this: HTMLTextAreaElement, value: string) {
        descriptor.set!.call(this, value);
        resizeOne(this, win);
      },
    });
  }

  const observer = new win.MutationObserver(schedule);
  observer.observe(doc.documentElement, { childList: true, subtree: true });

  schedule();

  return () => {
    doc.removeEventListener("input", onInput, true);
    doc.removeEventListener("change", onInput, true);
    doc.removeEventListener("focusin", onInput, true);
    win.removeEventListener("resize", schedule);
    observer.disconnect();
    if (frame) {
      if (typeof win.cancelAnimationFrame === "function") win.cancelAnimationFrame(frame);
      else win.clearTimeout(frame);
    }
    if (descriptor) Object.defineProperty(proto, "value", descriptor);
  };
}
