import { readFileSync } from "node:fs";
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
  // This DOM has no layout, but screen callbacks still call the browser API.
  window.HTMLElement.prototype.scrollIntoView ??= function () {};
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
/*
  THE CACHE IS ONLY CONSULTED WHEN THE CALLER SUPPLIES NO MAPPINGS, and that
  guard is load-bearing. A cached entry was transpiled with SOME fixed set of
  `imports` -- whatever the first caller passed -- so returning it to a later
  caller who passed their own mapping silently discards that mapping and hands
  back a module wired to the wrong dependencies.

  Release I (FC13, Oct 13 2026) made this reachable: the harness now loads
  `job-progress.ts` once at module scope (`jobProgressUrl`, to give `desk-chrome`
  the real `runningHeadLabel`) with `./jobs.ts` replaced by a stub. A fixture
  that then called `moduleUrl("src/lib/news/job-progress.ts", {"./jobs.ts": <the
  REAL jobs.ts>})` -- cancel-draft-release-flow.test.mjs does exactly this --
  got the cached stub-wired module back, and `readDeskJobs`' nested
  `await import("./jobs.ts")` resolved to a module with no `ensureJobsSchema`.
  Transpiling fresh whenever the caller is explicit keeps that fixture on the
  real dependency while leaving the shared-instance guarantee intact for the
  recursive calls, which all pass `{}`.
*/
const moduleCache = new Map();

/*
  `db.ts` is never followed. It ends with a module-scope `ensureDbReady()` that
  kicks a PGLite bootstrap the moment the file loads in Node, and this harness is
  always Node with no `window` -- so reading it would make every fixture that
  merely RENDERS the desk try to open a database. Nothing a DOM test asserts on
  comes from it: `getSql` is only ever called from inside a server fn, which a
  `data:` fixture never runs.

  The stub is deliberately loud. `getSql` throws rather than resolving to a
  plausible-looking fake, so a fixture that does reach for the database says so
  by name instead of failing later in a way that reads like a UI bug.
*/
const SERVER_ONLY_STUB = stubUrl(
  `export const getSql = () => { throw new Error("dom-harness: db.ts is not loaded in a DOM fixture; stub the caller instead"); };\n` +
    `export const ensureSchemaOnce = getSql;\n` +
    `export const withTransaction = getSql;\n` +
    `export const closePoolForTests = getSql;\n` +
    `export const isMigrationFile = () => false;\n` +
    `export const migrationName = () => "";\n` +
    `export const pendingMigrations = () => [];\n`,
);
const SERVER_ONLY_FILES = new Set([fileURLToPath(new URL("../src/lib/db.ts", import.meta.url))]);

export async function moduleUrl(path, imports = {}) {
  return loadModule(new URL(`../${path}`, import.meta.url), path, imports, []);
}

async function loadModule(file, label, imports, chain) {
  const absolute = fileURLToPath(file);
  if (Object.keys(imports).length === 0) {
    const cached = moduleCache.get(absolute);
    if (cached) return cached;
  }
  if (chain.includes(absolute))
    throw new Error(
      `circular import while transpiling ${label}: ${[...chain, absolute].join(" -> ")}`,
    );
  const code = await readFile(file, "utf8");
  const resolved = { ...imports };
  for (const specifier of staticRelativeSpecifiers(code)) {
    if (resolved[specifier]) continue;
    const dependency = fileURLToPath(new URL(specifier, file));
    if (SERVER_ONLY_FILES.has(dependency)) {
      resolved[specifier] = SERVER_ONLY_STUB;
      continue;
    }
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

/*
  A DYNAMIC `import("...")` inside a function body is not a module dependency and
  must not be followed or demanded of a fixture. `desk-auth.ts` reaches
  `./membership` (no extension), `@/lib/auth/verify.server` and
  `@/lib/auth/isolation.server` only from inside a server-fn handler that this
  harness never runs; treating them as top-level made the file unloadable, which
  is what `job-progress.ts`'s import of `desk-auth.ts` then ran into. Only
  top-level static imports, and dynamic imports at the top level of an
  expression statement, are dependencies a `data:` module has to be handed.
*/
function staticSpecifiers(source) {
  const ast = ts.createSourceFile("fixture.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Set();
  const topLevelDynamic = (node) => {
    if (!ts.isExpressionStatement(node)) return false;
    let call = node.expression;
    if (ts.isAwaitExpression(call)) call = call.expression;
    return ts.isCallExpression(call) && call.expression.kind === ts.SyntaxKind.ImportKeyword;
  };
  for (const node of ast.statements) {
    if ((ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly) ||
        (ts.isExportDeclaration(node) && !node.isTypeOnly)) {
      if (node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) names.add(node.moduleSpecifier.text);
    } else if (topLevelDynamic(node)) {
      const arg = node.expression.arguments?.[0] ?? node.expression.expression?.arguments?.[0];
      if (arg && ts.isStringLiteral(arg)) names.add(arg.text);
    }
  }
  return [...names];
}
function staticRelativeSpecifiers(source) {
  return staticSpecifiers(source).filter(name => name.startsWith("."));
}

/*
  EVERY string-literal import specifier in the file, static OR dynamic, at any
  depth -- this is the set `rewriteSpecifiers` REWRITES. It is deliberately
  wider than `staticSpecifiers`, which is the set a fixture is REQUIRED to map.

  The dynamic half matters because a NESTED `import("...")` cannot run at module
  scope, so no fixture is obliged to supply a URL for it -- but when one DOES
  (a caller's mapping, `loadModule` following it, or `sharedHelperUrls`), the
  literal must still be rewritten, or the `data:` module's own
  `import("./jobs.ts")` resolves against the `data:` URL and yields a module
  with none of the exports read off it. That is exactly the `readDeskJobs` case:
  it calls `await import("./jobs.ts")` inside a function body and then reads
  `ensureJobsSchema` off the result, and a fixture that passed the real
  `./jobs.ts` URL (cancel-draft-release-flow.test.mjs) got back a module with no
  `ensureJobsSchema`.

  The static half is here too, and it is why this walker must NOT be written as
  a dynamic-only visitor. A static `import { A } from "./x.ts"` IS in
  `staticSpecifiers`, so its mapping is present in `imports` -- but if this
  function does not also name it, `rewriteSpecifiers` never reaches the
  `replaceAll` for it, and the `data:` module ships `"./x.ts"` verbatim, where
  Node cannot resolve it. Writing this as only the `ImportKeyword` case is the
  bug that produced `Failed to resolve module specifier
  "./draft-completeness.ts"` from `job-progress.ts` even though
  `loadModule` had already followed and mapped that exact specifier.
*/
function allSpecifiers(source) {
  const ast = ts.createSourceFile("fixture.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const names = new Set();
  const visit = (node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      names.add(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] && ts.isStringLiteral(node.arguments[0])) names.add(node.arguments[0].text);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return [...names];
}

export function transpileToUrl(code, fileName, imports = {}) {
  const output = ts.transpileModule(code, {
    fileName,
    compilerOptions: { target: ts.ScriptTarget.ESNext, jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
  }).outputText;
  return stubUrl(rewriteSpecifiers(output, fileName, imports));
}

/**
 * Legacy flows test unrelated actions with no stored model assignments. Keep
 * their per-run model state unchanged, explicitly representing that fixture.
 * Tests of assignment behavior supply their own real hook mapping, which wins.
 */
export const noJobModelAssignmentUrl = stubUrl(`
export function useJobModelAssignment() {
  return {
    resolution: { providerId: "auto", effort: null, source: "surface-default", rank: null, notice: null },
    hasAssignment: false, isPending: false, isError: false,
  };
}`);

/*
  Two specifiers are mapped for EVERY fixture, before a caller gets a say,
  because the import that reaches them is the shared one: `desk-chrome.tsx` is
  handed to nearly every DOM test by name, and each of its own imports used to
  have to be stubbed there by hand. Both were type-only until Release I, and a
  type-only specifier is erased before `moduleSpecifiers` ever sees it -- so
  neither had ever needed a URL, and both broke every desk-chrome fixture on the
  day they became value imports.

    `sentence-stop.ts` -- FC18 (Oct 13 2026) gave the real `desk-copy.ts` a real
    `cutAtSentenceEnd`. Self-contained, no imports, so the REAL file runs, the
    same file the product runs, on the same reasoning as the real desk-copy
    those fixtures already load.

    `job-progress.ts` -- FC13 (same day) made `desk-chrome.tsx` import the value
    `runningHeadLabel` to print "Running - 1 - 10 queued" in the header. The REAL
    module is loadable -- it is transpiled and imported here exactly as the
    chain above does for any other `src` file, and that is deliberate, because
    a hand-copied re-implementation of the label is exactly what would let the
    header and `job-progress.test.ts` drift apart.

    It cannot be loaded by FOLLOWING ITS IMPORTS, though, and this is the one
    caveat: `job-progress.ts` imports `./jobs.ts`, which imports `../db.ts`, and
    `db.ts` ends with a module-scope `ensureDbReady()` -- a PGLite bootstrap that
    runs on import whenever `window` is undefined, which is this harness. So the
    chain is cut at the two specifiers that leave the client graph,
    `./jobs.ts` and `../db.ts`, and each is replaced by the two exports
    `job-progress.ts` actually reads from it: `jobStages`, `queuedJobWaitReason`
    and `requestJobCancel` off `jobs.ts` (plus the types, which are erased), and
    `getSql` off `db.ts`. Those bodies are not used by `runningHeadLabel` at all
    -- it reads only `job.status` -- and each one throws if a test ever does
    reach it, rather than returning a quiet wrong answer.

    Every OTHER symbol in `job-progress.ts` is the real code: the desk's
    server-fn wrappers, the retry planner, the queued-wait copy, and
    `runningHeadLabel` itself.
*/
/*
  Declared before it is filled, because `moduleUrl` below recurses straight back
  into `rewriteSpecifiers` while it is still running: a `const` holding the
  finished URLs would still be in its temporal dead zone on the first nested
  transpile and the module would not load at all.
*/
const sharedHelperUrls = {};

export const jobProgressUrl = await moduleUrl("src/lib/news/job-progress.ts", {
  "./jobs.ts": stubUrl(`
export const jobStages = () => [];
export const queuedJobWaitReason = () => { throw new Error("dom-harness: the real jobs.ts was not loaded in this fixture"); };
export const requestJobCancel = () => { throw new Error("dom-harness: the real jobs.ts was not loaded in this fixture"); };
`),
  "../db.ts": stubUrl(`
export const getSql = () => { throw new Error("dom-harness: the real db.ts was not loaded in this fixture"); };
`),
});

sharedHelperUrls["@/lib/news/job-progress"] = jobProgressUrl;
sharedHelperUrls["./sentence-stop.ts"] = await moduleUrl("src/lib/news/sentence-stop.ts");

/*
  `@/lib/news/running-head-label` -- FC13 (Oct 13 2026) split the header's
  `runningHeadLabel` out of `job-progress.ts` and into its own module, so the
  label no longer drags the server-bearing graph (`desk-auth.ts`, the server fn
  machinery) into the browser bundle. `desk-chrome.tsx` now imports that
  specifier instead, and a fixture that mapped only `job-progress` broke with
  "imports a specifier this test neither stubs nor can resolve".

  The new module has no imports, so the REAL file is loaded -- the same file the
  product runs, the same reasoning as `sentence-stop.ts` above. `job-progress`
  stays mapped too: its own `runningHeadLabel` is still the one every
  `job-progress.test.ts` assertion pins.
*/
sharedHelperUrls["@/lib/news/running-head-label"] = await moduleUrl("src/lib/news/running-head-label.ts");

/*
  `lead-match.ts` -- B02 (Oct 13 2026) made the real `desk-copy.ts` import
  `explainPairMatch` and `sharesTightName` as VALUES, in addition to
  `distinguishingOverlap`. A fixture that still stubbed `./lead-match.ts` with
  only `distinguishingOverlap` (or `@/lib/news/lead-match`, or omitted the
  specifier entirely, as `screen-render-harness.mjs` does) then failed to load
  the module with "does not provide an export named 'explainPairMatch'".

  The real `lead-match.ts` is a large, self-contained pure module with no
  imports, so it is loadable here -- but stubbing it as "no match" for the two
  new names is the intent stated by every fixture that already stubbed
  `distinguishingOverlap` to zero, and none of them tests the duplicate/merge
  path B02 added. A stub that says "no match" is the fixture's own default, not
  a fake of a behavior under test. The `distinguishingOverlap` name is left to
  the fixture when it supplies one; this entry only fills the specifier.

  Fixtures that pass `./lead-match.ts` explicitly still win: an explicit
  `imports[specifier]` beats `sharedHelperUrls` in `rewriteSpecifiers` below.
*/
sharedHelperUrls["./lead-match.ts"] = stubUrl(`
export const distinguishingOverlap = () => ({ subjects: 0, names: 0 });
export const explainPairMatch = () => null;
export const sharesTightName = () => false;
`);

/*
  `@/lib/desk/queue-count-refresh` -- A11 (f9473ce5) made `desk-chrome.tsx`
  import `queueCountRefetchMs` from this module for the nav's poll interval.
  It has no imports of its own and is pure (a constant and one ternary), so
  the REAL file is loaded, exactly like `running-head-label.ts` above; a
  fixture that stubbed every transport handle still failed to load the chrome
  with "imports a specifier this test neither stubs nor can resolve".

  A fixture's own `imports[specifier]` still wins over this entry.
*/
sharedHelperUrls["@/lib/desk/queue-count-refresh"] = await moduleUrl("src/lib/desk/queue-count-refresh.ts");

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
  /*
    A dynamic `import("...")` that lives inside a function body is not something
    the fixture is REQUIRED to supply a URL for: it cannot run at module scope,
    and demanding one of every fixture is what made `desk-auth.ts` unloadable.
    But when a mapping DOES exist -- a caller passed one, `loadModule` followed
    it, or `sharedHelperUrls` holds one -- the literal must be rewritten, or the
    `data:` module's own `import("./jobs.ts")` resolves against the `data:` URL
    and yields a module with none of the exports read off it. So the set that is
    REWRITTEN is every string-literal import specifier in the file; the set that
    must BE resolvable (`unresolved`) stays the top-level static one.
  */
  const specifiers = allSpecifiers(output);
  const required = new Set(staticSpecifiers(output));
  const unresolved = [];
  for (const specifier of specifiers) {
    let mapped = imports[specifier];
    if (!mapped) mapped = sharedHelperUrls[specifier];
    if (!mapped && specifier === "@/components/use-job-model-assignment") {
      mapped = noJobModelAssignmentUrl;
    }
    if (!mapped && specifier === "@/components/scoped-actions") {
      // The scoped handles moved transport imports. Keep each existing fixture's
      // original transport stub and fail if it did not supply a required handle.
      const scoped = readFileSync(new URL("../src/components/scoped-actions.ts", import.meta.url), "utf8");
      const ast = ts.createSourceFile("scoped-actions.ts", scoped, ts.ScriptTarget.Latest, true);
      const origins = new Map();
      for (const node of ast.statements) {
        if (!ts.isImportDeclaration(node) || !node.importClause?.namedBindings || !ts.isNamedImports(node.importClause.namedBindings)) continue;
        for (const binding of node.importClause.namedBindings.elements)
          origins.set(binding.name.text.replace(/^_/, ""), { source: node.moduleSpecifier.text, name: (binding.propertyName ?? binding.name).text });
      }
      const outputAst = ts.createSourceFile(fileName, output, ts.ScriptTarget.Latest, true);
      const names = outputAst.statements.filter(node => ts.isImportDeclaration(node) && node.moduleSpecifier.text === specifier)
        .flatMap(node => ts.isNamedImports(node.importClause?.namedBindings) ? node.importClause.namedBindings.elements.map(binding => (binding.propertyName ?? binding.name).text) : []);
      const exports = names.map(name => {
        const origin = origins.get(name);
        if (!origin || !imports[origin.source]) throw new Error(`${fileName}: scoped handle ${name} has no transport fixture for ${origin?.source}`);
        return `export { ${origin.name} as ${name} } from ${JSON.stringify(imports[origin.source])};`;
      });
      mapped = stubUrl(exports.join("\n"));
    }
    let url = mapped;
    if (!url) {
      /*
        A bare (non-relative) specifier that resolves from `node_modules` is
        rewritten whether or not it is required. A relative one that was not
        mapped is only a failure when it is a REQUIRED (top-level static)
        import; a nested dynamic `./jobs.ts` with no mapping is left exactly as
        it was, which is the pre-split behaviour for `desk-auth.ts`.
      */
      if (specifier.startsWith(".")) {
        if (required.has(specifier)) unresolved.push(specifier);
        continue;
      }
      try {
        url = import.meta.resolve(specifier);
      } catch {
        if (required.has(specifier)) unresolved.push(specifier);
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
