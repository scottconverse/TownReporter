/*
  The in-process DOM for tests that have to press something.

  The repository documents "no DOM test environment". It does not need one:
  `linkedom` is already a production dependency (the desk parses captured HTML
  with it) and `react-dom/client` only wants about twenty globals. This is the
  shim `scripts/bh2-dialogs.test.mjs` installs by hand, factored out the second
  time a test needed it rather than copied a third.

  TWO SHARED PIECES, and what each is for:

    - `installDom()` puts the globals in place and returns the parsed window.
      It must run BEFORE `react-dom/client` is imported -- React reads
      `window.location.protocol` at module scope -- so callers import
      `react-dom/client` themselves, after calling it.
    - `moduleUrl()` transcribes a `.ts`/`.tsx` source into an importable
      `data:` module. A `data:` module has no base to resolve a bare specifier
      against, so every one of them has to be handed a URL: `react` and
      `react-dom` are mapped automatically, and anything the file imports beyond
      those must be passed in. A specifier nobody mapped fails the import with
      its own name, which is a better error than a resolution stack.

  Blind spots, stated once for every file that uses this: linkedom has no
  default action, so a controlled input is driven by calling its `onChange`
  rather than by typing, and anything that measures layout reads zeroes.
*/
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { parseHTML } from "linkedom";

export function installDom() {
  const { window, document } = parseHTML(
    "<!doctype html><html><body><div id=root></div></body></html>",
  );
  /*
    linkedom's parsed window has no `location` and no `matchMedia`; React reads
    the first at import time and sonner asks the second for the reader's motion
    and colour preferences.
  */
  if (!window.location) {
    Object.defineProperty(window, "location", {
      value: {
        protocol: "http:",
        host: "localhost",
        hostname: "localhost",
        href: "http://localhost/",
        origin: "http://localhost",
        pathname: "/",
        search: "",
        hash: "",
      },
      configurable: true,
    });
  }
  if (!window.matchMedia) {
    window.matchMedia = () => ({
      matches: false,
      media: "",
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    });
  }

  // linkedom has no layout; scrolling is a browser default action, like focus.
  if (!window.HTMLElement.prototype.scrollIntoView)
    window.HTMLElement.prototype.scrollIntoView = function () {};

  globalThis.window = window;
  globalThis.document = document;
  Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });
  for (const key of [
    "HTMLElement",
    "Element",
    "Node",
    "Event",
    "CustomEvent",
    "DocumentFragment",
    "Text",
    "Comment",
  ]) {
    if (window[key]) globalThis[key] = window[key];
  }
  globalThis.getComputedStyle = () => ({
    getPropertyValue: () => "",
    overflow: "visible",
    position: "static",
    display: "block",
  });
  globalThis.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  return window;
}

/** A `data:` module for a string of JavaScript. */
export function stubUrl(body) {
  return `data:text/javascript;base64,${Buffer.from(body).toString("base64")}`;
}

/**
 * Transpile a `.ts`/`.tsx` file in this repository into an importable module.
 *
 * RELATIVE IMPORTS ARE FOLLOWED (batch-6 pre-merge audit). A bare specifier is
 * mapped by the caller or resolved from this repository's `node_modules`; a
 * relative one used to be left verbatim inside the `data:` module below, where
 * Node cannot resolve it -- so a module that imports a sibling
 * (`desk-toast.ts` importing `../lib/news/desk-copy.ts`) was simply unloadable
 * here, and a test that needed it could only stub the sibling rather than run
 * it. Each relative specifier is now transpiled by this same rule and mapped
 * for the module that names it, so the real chain runs.
 *
 * Memoized by absolute path, so a diamond is transpiled once and two modules
 * that share a dependency share the INSTANCE of it -- which matters for a
 * module with a store in it, like the toast layer. A cycle fails by name
 * instead of spinning.
 */
const moduleCache = new Map();

export async function moduleUrl(path, imports = {}) {
  return loadModule(new URL(`../${path}`, import.meta.url), path, imports, []);
}

async function loadModule(file, label, imports, chain) {
  const absolute = fileURLToPath(file);
  const cached = moduleCache.get(absolute);
  if (cached) return cached;
  if (chain.includes(absolute))
    throw new Error(
      `circular import while transpiling ${label}: ${[...chain, absolute].join(" -> ")}`,
    );
  const code = await readFile(file, "utf8");
  const resolved = { ...imports };
  for (const specifier of relativeSpecifiers(code)) {
    if (resolved[specifier]) continue;
    resolved[specifier] = await loadModule(
      new URL(specifier, file),
      specifier,
      {},
      [...chain, absolute],
    );
  }
  const url = transpileToUrl(code, label, resolved);
  moduleCache.set(absolute, url);
  return url;
}

/**
 * Every relative specifier `source` imports, once each, in source order.
 *
 * The specifier has to be one word with no whitespace: a bare `[^"]+` also
 * matches prose in a comment that happens to read `from "..."` and a
 * `join(", ")` argument, and those are not imports.
 */
function relativeSpecifiers(source) {
  return [
    ...new Set(
      [...source.matchAll(/(?:from|import)\s*"(\.[^"\s]*)"/g)].map((match) => match[1]),
    ),
  ];
}

export function transpileToUrl(code, fileName, imports = {}) {
  const output = ts.transpileModule(code, {
    fileName,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
  }).outputText;
  return stubUrl(rewriteSpecifiers(output, fileName, imports));
}

/**
 * Point every specifier at a URL Node can import.
 *
 * An explicit mapping wins. Anything else is resolved from this repository's own
 * `node_modules`, so a test that wants the REAL package -- `sonner`, in FB5's
 * case -- gets it, and a test that wants a stand-in passes one. A relative
 * specifier has no meaning inside a `data:` module: it must have been mapped by
 * `loadModule` (or by the caller), and one that was not is named here. A
 * specifier that resolves to none of those (`@/...` is not a package) fails
 * here too, naming itself.
 */
function rewriteSpecifiers(output, fileName, imports) {
  let rewritten = output;
  const specifiers = [
    ...new Set(
      // One word, no whitespace: `from "..."` in a comment and `join(", ")`
      // are not imports, and a `[^"]+` group collects both.
      [...output.matchAll(/(?:from|import\()\s*"([^"\s]+)"/g)]
        .map((match) => match[1])
        .filter((specifier) => !/^(data|file|node):/.test(specifier)),
    ),
  ];
  const unresolved = [];
  for (const specifier of specifiers) {
    const mapped = imports[specifier];
    let url = mapped;
    if (!url) {
      if (specifier.startsWith(".")) {
        unresolved.push(specifier);
        continue;
      }
      try {
        url = import.meta.resolve(specifier);
      } catch {
        unresolved.push(specifier);
        continue;
      }
    }
    rewritten = rewritten.replaceAll(JSON.stringify(specifier), JSON.stringify(url));
  }
  assert.deepEqual(
    unresolved,
    [],
    `${fileName} imports a specifier this test neither stubs nor can resolve`,
  );
  return rewritten;
}
