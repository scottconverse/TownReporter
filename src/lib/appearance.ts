/*
  Appearance: the preferences that decide what colour a page paints, and the
  one piece of code that applies them BEFORE the first paint.

  The bug this module exists to kill (owner report, 2026-09-25): "when I
  change screens and I'm in dark mode ... the screen flashes BRIGHT WHITE,
  announces where it's going like 'opening desk' then switches back to dark
  mode. Late at night, in a dark room, it's a shock."

  Cause: every one of these preferences lived in `localStorage` and was read in
  a `useEffect`, i.e. after first paint. On a hard reload the server could not
  see localStorage at all, so it rendered the light theme -- pending screens,
  error screens and the desk shell alike -- and the page flipped dark a paint
  later.

  How it is fixed, and why this way:

    The values still live in localStorage (nothing to migrate, nothing to keep
    in sync). What changed is who applies them and when. An inline script in
    <head> (see `appearanceHeadScript`) reads the same localStorage, before any
    React bundle is evaluated and before the first paint, and stamps two
    attributes on <html>. Every dark style in the app is keyed on those
    attributes -- see `:root[data-appearance=...]` in styles.css,
    desk-astra.css and reader-astra.css -- so the first painted frame is
    already dark, whatever React does afterwards.

    A cookie mirrored to the server was the other candidate the work order
    suggested, and it is the wrong instrument here: it needs a request-time
    read on every route load, it is a SECOND store that can disagree with
    localStorage (a stale cookie means a light render -- exactly the bug), and
    the value it carries for the public paper is per-paper while a cookie is
    per-origin. The script has none of those failure modes, and it is the only
    mechanism that also covers a screen whose JavaScript never runs -- the same
    hard constraint the `data-stranded` fallback in __root.tsx is built around.

    The React-side classNames (`night`, `large`, `mode-dark`) are kept, but
    they are now redundant: they say the same thing as the attributes. That
    redundancy is deliberate, because it means React can hydrate at the light
    default (which is what keeps hydration warning-free) and the frame is still
    dark -- the class arriving late changes no pixel.
*/

export type DeskMode = "light" | "dark";
export type DeskTextSize = "normal" | "large";
export type ReaderMode = "light" | "dark";

/** What the document is currently painted as. `light` is the shipped default. */
export type AppearanceSurface = "desk-dark" | "reader-dark" | "light";

export type Appearance = {
  /** Desk light/dark, from the header toggle. */
  desk: DeskMode;
  /** Desk Normal/Large text. */
  size: DeskTextSize;
  /**
   * The public paper's reading appearance. This module does not store it -- the
   * reader keeps it in a per-paper blob (`readerStorageKey`) -- so it is read
   * through `readReaderMode` and reported back through
   * `AppearanceProvider`'s refresh.
   */
  reader: ReaderMode;
};

export const DESK_MODE_KEY = "townreporter.desk.mode";
export const DESK_TEXT_SIZE_KEY = "townreporter.desk.textsize";
/** The attribute the stylesheets key on, and the script stamps. */
export const APPEARANCE_ATTR = "data-appearance";
/** The desk's Normal/Large text-size attribute (see `--ts` in styles.css). */
export const DESK_SIZE_ATTR = "data-desk-size";

export const DEFAULT_APPEARANCE: Appearance = { desk: "light", size: "normal", reader: "light" };

/** The dark page colour, for both surfaces: the desk's `.desk-ltr.astra.night`
    `--bg` / `:root[data-appearance="desk-dark"]` and the paper's
    `.reader.mode-dark` `--bg` (desk-astra.css, reader-astra.css, styles.css).
    Used by the head script to keep the browser's own `theme-color` in step, so
    a phone's address bar does not stay white over a dark page. There is no
    custom property holding it -- the value is written out at each site, and
    src/lib/appearance.test.ts fails if one of them moves away from this
    constant.

    Until the redesign this was two constants, #182024 for the desk and #142428
    for the paper. The tokens have one dark -- `--dd: #0f0e0c` is the darkest
    step and `#1b1916` is the ground every dark panel sits on -- because an
    editor switching the desk to Dark and then opening the paper should not be
    looking at two different newspapers. */
export const DESK_NIGHT_BG = "#1b1916";
/** The paper's dark page colour. The same warm black as the desk's, and the
    same value on `:root[data-appearance="reader-dark"] .reader`
    (reader-astra.css). Kept as its own name because `surfaceBackground` and
    the head script still have to answer per surface. */
export const READER_DARK_BG = "#1b1916";
/** The shipped light page colour, matching `--color-paper` (styles.css). */
export const LIGHT_BG = "#fffdf7";

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

export function isDeskPath(pathname: string): boolean {
  return pathname === "/desk" || pathname.startsWith("/desk/");
}

/**
 * Which surface the browser is on decides WHICH preference paints.
 *
 * The two toggles are independent, so "dark" is not a property of the
 * document -- it is a property of the page you are looking at. `/desk` and
 * everything under it is the desk; everything else is the paper. (Both darks
 * are the same warm black now, but the toggles are still two preferences, so
 * the answer still has to be computed per surface.)
 *
 * Kept as one pure function so the head script's own copy of this rule can be
 * checked against it (src/lib/appearance.test.ts).
 */
export function appearanceSurface(
  desk: DeskMode,
  reader: ReaderMode,
  pathname: string,
): AppearanceSurface {
  if (isDeskPath(pathname)) return desk === "dark" ? "desk-dark" : "light";
  return reader === "dark" ? "reader-dark" : "light";
}

export function surfaceBackground(surface: AppearanceSurface): string {
  if (surface === "desk-dark") return DESK_NIGHT_BG;
  if (surface === "reader-dark") return READER_DARK_BG;
  return LIGHT_BG;
}

/** localStorage, in a try/catch: private windows and blocked storage throw on
    access rather than returning null, and a page must still render. */
export function readStoredDesk(): Pick<Appearance, "desk" | "size"> {
  if (typeof document === "undefined") return { desk: "light", size: "normal" };
  const read = (key: string): string | null => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  return {
    desk: oneOf(read(DESK_MODE_KEY), ["light", "dark"] as const, "light"),
    size: oneOf(read(DESK_TEXT_SIZE_KEY), ["normal", "large"] as const, "normal"),
  };
}

/**
 * The reader's appearance, out of its own per-paper blob. The reader owns that
 * blob (it also carries text size and bookmarks) -- this only reads the one
 * bit the document needs.
 */
export function readReaderMode(readerKey: string): ReaderMode {
  if (typeof document === "undefined" || !readerKey) return "light";
  try {
    const value = JSON.parse(localStorage.getItem(readerKey) || "{}") as { dark?: unknown };
    return value.dark === true ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function writeStoredDesk(next: Pick<Appearance, "desk" | "size">): void {
  if (typeof document === "undefined") return;
  const set = (key: string, value: string) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* storage unavailable: the choice holds for this page and no longer */
    }
  };
  set(DESK_MODE_KEY, next.desk);
  set(DESK_TEXT_SIZE_KEY, next.size);
}

/**
 * A JS string literal for inlining.
 *
 * The paper name reaches the reader key, and `encodeURIComponent` leaves `'`
 * and `(`/`)` alone -- a paper called "The Town's Reporter" would otherwise
 * close the script's own string and break it. `JSON.stringify` quotes and
 * escapes correctly; `<` is escaped too so a name containing `</script>`
 * cannot close the element the literal lives in.
 */
function jsString(value: string): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/**
 * The pre-paint script, rendered inline in <head> by the root route.
 *
 * It runs before the first paint and before any React bundle, which is the
 * whole point: it reads the same stores this module writes and stamps <html>
 * with the attributes the stylesheets key on. No React, no imports, no build
 * step -- it has to survive on a page where the app's JavaScript never runs at
 * all (see the `data-stranded` fallback in `__root.tsx` for the same hard
 * constraint).
 *
 * Every read is guarded: a browser that blocks storage, or an unparseable
 * reader blob, leaves the light defaults in place and the page renders exactly
 * as it does today.
 *
 * `readerKey` is inlined from the resolved paper identity rather than guessed,
 * because the reader's store is per-paper (`townreporter:reader:<name>:<city>`)
 * and a script that cannot know which paper it is on cannot read it.
 */
export function appearanceHeadScript(readerKey: string): string {
  return (
    "(function(){try{" +
    "var d=document.documentElement;" +
    "function read(k){try{return localStorage.getItem(k)||''}catch(e){return ''}}" +
    "var m=read('" +
    DESK_MODE_KEY +
    "'),s=read('" +
    DESK_TEXT_SIZE_KEY +
    "'),r='';" +
    "try{r=(JSON.parse(read(" +
    jsString(readerKey) +
    ")||'{}').dark===true)?'dark':'light'}catch(e){r='light'}" +
    "if(m!=='dark'&&m!=='light')m='light';" +
    "if(s!=='large'&&s!=='normal')s='normal';" +
    "var desk=/^\\/desk(\\/|$)/.test(location.pathname);" +
    "var dark=desk?m==='dark':r==='dark';" +
    "var surface=dark?(desk?'desk-dark':'reader-dark'):'light';" +
    "d.setAttribute('" +
    APPEARANCE_ATTR +
    "',surface);" +
    "d.setAttribute('" +
    DESK_SIZE_ATTR +
    "',s);" +
    "var t=document.querySelector('meta[name=theme-color]');" +
    "if(t)t.setAttribute('content',dark?(desk?'" +
    DESK_NIGHT_BG +
    "':'" +
    READER_DARK_BG +
    "'):'" +
    LIGHT_BG +
    "');" +
    "}catch(e){}})();"
  );
}
