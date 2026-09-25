import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  APPEARANCE_ATTR,
  DESK_NIGHT_BG,
  DESK_SIZE_ATTR,
  LIGHT_BG,
  READER_DARK_BG,
  appearanceHeadScript,
  appearanceSurface,
  isDeskPath,
  surfaceBackground,
  type AppearanceSurface,
  type DeskMode,
  type ReaderMode,
} from "./appearance.ts";

/*
  The pre-paint appearance script, checked against the modules it is a
  hand-written copy of.

  The script in <head> (see `appearanceHeadScript`) cannot import anything --
  it has to run on a page where the app's bundle never loads at all, which is
  the same hard constraint the `data-stranded` fallback in __root.tsx is built
  around -- so its copy of the path rule, the defaults and the colour choices
  are duplicates. Duplicates drift. The first test below does not compare the
  script's text to itself: it RUNS the generated script against a stub
  document/localStorage/location and asserts the attribute it stamps is what
  `appearanceSurface` and `surfaceBackground` say it should be, for the whole
  matrix. If someone edits one side, this fails.
*/

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const css = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const READER_KEY = "townreporter:reader:The%20Paper:Longmont";

/** Run the real generated script against a stub DOM and report what it set. */
function runHeadScript(options: {
  readerKey?: string;
  pathname: string;
  desk?: string | null;
  size?: string | null;
  readerBlob?: string | null;
  /** `localStorage.getItem` throws, as it does when storage is blocked. */
  storageThrows?: boolean;
}): { attributes: Record<string, string>; themeColor: string } {
  const attributes: Record<string, string> = {};
  const readerKey = options.readerKey ?? READER_KEY;
  const stored: Record<string, string> = {};
  if (options.desk != null) stored["townreporter.desk.mode"] = options.desk;
  if (options.size != null) stored["townreporter.desk.textsize"] = options.size;
  if (options.readerBlob != null) stored[readerKey] = options.readerBlob;

  let themeColor = "(unset)";
  const document = {
    documentElement: {
      setAttribute: (name: string, value: string) => {
        attributes[name] = value;
      },
    },
    querySelector: () => ({
      setAttribute: (_name: string, value: string) => {
        themeColor = value;
      },
    }),
  };
  const localStorage = {
    getItem: (key: string) => {
      if (options.storageThrows) throw new Error("storage is blocked");
      return stored[key] ?? null;
    },
  };
  const location = { pathname: options.pathname };

  new Function("document", "localStorage", "location", appearanceHeadScript(readerKey))(
    document,
    localStorage,
    location,
  );
  return { attributes, themeColor };
}

const DESKS = ["/desk", "/desk/queue", "/desk/story/12", "/desk/sources"];
const PAPERS = ["/", "/articles/council-approves", "/how-we-report"];

test("the head script stamps the surface and theme colour appearanceSurface and surfaceBackground name", () => {
  for (const deskMode of ["light", "dark"] as DeskMode[]) {
    for (const readerMode of ["light", "dark"] as ReaderMode[]) {
      for (const pathname of [...DESKS, ...PAPERS]) {
        const expected = appearanceSurface(deskMode, readerMode, pathname);
        const { attributes, themeColor } = runHeadScript({
          pathname,
          desk: deskMode,
          readerBlob: JSON.stringify({ dark: readerMode === "dark", size: 21, saved: [] }),
        });
        assert.equal(
          attributes[APPEARANCE_ATTR],
          expected,
          `desk=${deskMode} reader=${readerMode} ${pathname}`,
        );
        assert.equal(
          attributes[DESK_SIZE_ATTR],
          "normal",
          "every path carries a text size, so a later page cannot inherit a stale one",
        );
        assert.equal(
          themeColor,
          surfaceBackground(expected),
          `theme-color must follow the surface on ${pathname} (desk=${deskMode})`,
        );
      }
    }
  }
});

test("the head script's own path rule agrees with isDeskPath on the near misses", () => {
  // The script carries the rule as a regex literal, so this reads the literal
  // out of the generated script and runs it -- a `/desk` prefix check written
  // as `startsWith("/desk")` would call /deskfoo a desk page and paint the
  // wrong dark on a 404.
  const script = appearanceHeadScript(READER_KEY);
  const literal = script.match(/var desk=(\/\^.*?\/)\.test\(location\.pathname\)/);
  assert.ok(literal, "the head script no longer tests location.pathname in the expected shape");
  const matches = new Function(`return ${literal[1]};`)() as RegExp;
  for (const pathname of [
    "/desk",
    "/desk/",
    "/desk/queue",
    "/desk/story/12",
    "/",
    "/deskfoo",
    "/desk-archive",
    "/articles/desk",
  ]) {
    assert.equal(matches.test(pathname), isDeskPath(pathname), pathname);
  }
});

test("the head script survives blocked storage, junk values and an unreadable reader blob", () => {
  const blocked = runHeadScript({ pathname: "/desk/queue", storageThrows: true, desk: "dark" });
  assert.equal(blocked.attributes[APPEARANCE_ATTR], "light");
  assert.equal(blocked.attributes[DESK_SIZE_ATTR], "normal");
  assert.equal(blocked.themeColor, LIGHT_BG);

  const junk = runHeadScript({
    pathname: "/desk/queue",
    desk: "DARKISH",
    size: "gigantic",
    readerBlob: "{not json",
  });
  assert.equal(junk.attributes[APPEARANCE_ATTR], "light", "an unrecognised mode is not dark");
  assert.equal(junk.attributes[DESK_SIZE_ATTR], "normal", "an unrecognised size is not large");

  const large = runHeadScript({ pathname: "/desk/queue", desk: "dark", size: "large" });
  assert.equal(large.attributes[APPEARANCE_ATTR], "desk-dark");
  assert.equal(large.attributes[DESK_SIZE_ATTR], "large");
});

test("a paper name with an apostrophe cannot close the script's own string", () => {
  // `encodeURIComponent` leaves `'` alone, so the reader key is interpolated
  // and "The Town's Reporter" would otherwise terminate the literal and take
  // the whole script (and the theme) with it. The key is also inlined into an
  // HTML attribute-free <script>, so `<` has to be escaped too.
  const hostile = "townreporter:reader:The Town's <Reporter>:Longmont";
  const script = appearanceHeadScript(hostile);
  assert.ok(
    !script.includes("The Town's <Reporter>"),
    "the reader key is interpolated raw: its `'` closes the script's own string, and its `<` " +
      "is what a `</script>` in a paper name would use to end the element the script lives in",
  );
  // ...and the escaped literal still IS the key, so the lookup is not defeated
  // by the escaping.
  const literal = script.match(/JSON\.parse\(read\(([\s\S]*?)\)\|\|'\{\}'\)/);
  assert.ok(literal, "the head script no longer reads the reader blob in the expected shape");
  // The literal is evaluated the same way the browser will: this is the check
  // that the escaping is a string literal and not a syntax error.
  assert.equal(new Function(`return ${literal[1]};`)(), hostile);

  // And it still reads the right blob: the escaped key is the key.
  const { attributes } = runHeadScript({
    readerKey: hostile,
    pathname: "/articles/council-approves",
    readerBlob: JSON.stringify({ dark: true }),
  });
  assert.equal(attributes[APPEARANCE_ATTR], "reader-dark");
});

test("the palette constants are the ones the stylesheets actually paint", () => {
  // Two darks, deliberately different, and both written out literally in CSS:
  // if one moves without the other, the head script's theme-color (the phone's
  // address bar) disagrees with the page it is describing.
  const styles = css("src/styles.css");
  const deskCss = css("src/desk-astra.css");
  const readerCss = css("src/reader-astra.css");

  assert.match(deskCss, /--bg:\s*#182024/, "desk-astra.css no longer paints the desk's dark");
  assert.match(styles, /:root\[data-appearance="desk-dark"\][^{]*\{[^}]*background:\s*#182024/);
  assert.match(readerCss, /--bg:\s*#142428/, "reader-astra.css no longer paints the reader's dark");
  assert.match(styles, /:root\[data-appearance="reader-dark"\][^{]*\{[^}]*background:\s*#142428/);
  assert.match(styles, new RegExp(`--color-paper:\\s*${LIGHT_BG}`), "the light canvas moved");

  // And the reader's dark palette is reachable from the attribute, not only
  // from the React class -- otherwise a hard load paints light for a frame,
  // which is the whole bug.
  assert.match(
    readerCss,
    /:root\[data-appearance="reader-dark"\]\s+\.reader\s*[,{]/,
    "the reader's dark palette must also be keyed on the pre-paint attribute",
  );
  assert.match(
    deskCss,
    /:root\[data-appearance="desk-dark"\]\s+\.desk-ltr\.astra/,
    "the desk's astra dark palette must also be keyed on the pre-paint attribute",
  );
  assert.match(
    styles,
    /:root\[data-desk-size="large"\]\s+\.desk-ltr/,
    "Normal/Large must be applied from the attribute too, or Large reflows a paint late",
  );
});

test("the three surface backgrounds are distinct so a mix-up is visible", () => {
  const surfaces: AppearanceSurface[] = ["desk-dark", "reader-dark", "light"];
  const values = surfaces.map(surfaceBackground);
  assert.equal(new Set(values).size, 3);
  assert.equal(surfaceBackground("desk-dark"), DESK_NIGHT_BG);
  assert.equal(surfaceBackground("reader-dark"), READER_DARK_BG);
  assert.equal(surfaceBackground("light"), LIGHT_BG);
  assert.notEqual(DESK_NIGHT_BG, READER_DARK_BG);
});

test("isDeskPath does not claim a route that merely starts with the word", () => {
  assert.equal(isDeskPath("/desk"), true);
  assert.equal(isDeskPath("/desk/queue"), true);
  assert.equal(isDeskPath("/deskfoo"), false);
  assert.equal(isDeskPath("/"), false);
});
