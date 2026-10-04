import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

/*
  Auditor finding F4, rendered from the REAL panel.

  "Server > Paper setup showed 'Longmont, Colorado' and an author's gmail
  address before any setup." The panel is `PaperSetupPanel`
  (src/components/ops-panels.tsx), the second way into the same first-run form
  the gate route (/desk/setup) renders -- and it was the one door that did NOT
  pass `firstRun`, so `getPaperConfig`'s fallback (the shipped Longmont
  constants plus the build-time editor email) arrived in the boxes as though
  the operator had typed it.

  WHY A RENDER TEST. What the auditor saw is a property of the markup: which
  value is in the City / State / Editor-email boxes. `renderToStaticMarkup`
  turns the real component into that markup with no browser, no database, no
  model and no session.

  WHAT IS STUBBED AND WHY. `ops-panels.tsx` is the Server screen's whole
  library, so it imports the ops dashboard, the trash, the provider toolchain
  and more. None of that is what this test is about: every one of those
  specifiers is replaced with a minimal module, the two React-query hooks are
  an in-memory stand-in keyed on `queryKey[0]` so the panel can be handed
  "owner, not yet onboarded" and "owner, onboarded", and the two modules under
  test -- `ops-panels.tsx` and the real `PaperSetupForm` it renders -- are
  transpiled from source. Nothing about the wiring under test is a stand-in.
*/

function moduleUrl(source, fileName, imports = {}) {
  let output = ts.transpileModule(source, {
    fileName,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
  }).outputText;
  for (const [name, url] of Object.entries(imports)) {
    output = output.replaceAll(JSON.stringify(name), JSON.stringify(url));
  }
  return `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
}

const REACT_URL = import.meta.resolve("react");
const inlineModule = (source) =>
  `data:text/javascript;base64,${Buffer.from(source.replaceAll('"react"', JSON.stringify(REACT_URL))).toString("base64")}`;

const reactRouterStub = inlineModule(`export const Link = ({ children }) => children ?? null;`);

const deskChromeStub = inlineModule(`
  import { createElement } from "react";
  export const InkButton = ({ children, type }) => createElement("button", { type: type || "button" }, children);
  export const Field = ({ label, hint, children }) =>
    createElement("div", null, createElement("span", null, label), children, hint ? createElement("span", null, hint) : null);
  export const SecHead = ({ title, sub }) => createElement("div", null, createElement("h2", null, title), sub ?? null);
  export const LeaveEditorControl = () => null;
`);

const formErrorStub = inlineModule(`
  import { createElement } from "react";
  export const FormError = ({ children }) => createElement("div", null, children);
`);

const utilsStub = inlineModule(`
  export const announceToDesk = () => {};
  export const inputClass = "";
`);

/** A no-op module for every specifier this test does not exercise. */
const names = (list) =>
  inlineModule(list.map((n) => `export function ${n}() { return null; }`).join("\n"));

const paperSettingsStub = names(["getPaperConfigForEditor", "firstRunSetupState", "completeFirstRunSetup"]);

/** The build-time address the auditor saw: it must never reach this panel. */
const SHIPPED_EMAIL = "author.example@gmail.com";
/** What getPaperConfig falls back to when nothing is configured. */
const LONGMONT_FALLBACK = {
  name: "TownReporter",
  city: "Longmont",
  state: "Colorado",
  location: "Longmont, Colorado",
  timezone: "America/Denver",
  tagline: "The public record is only the beginning.",
  kicker: "Independent civic reporting  ·  Longmont",
  deck: "TownReporter follows Longmont's meetings.",
  trust: "Civic news, non-profit, human-edited.",
  councilVotesUrl: "https://longmontcitycouncil.org/",
  youtubeChannels: [],
  meetingKeywords: [],
  seedSources: [],
  editorEmail: SHIPPED_EMAIL,
  namedOutlets: [],
};
/** What an onboarded paper has saved. */
const SAVED = {
  ...LONGMONT_FALLBACK,
  name: "Testerville Ledger",
  city: "Testerville",
  state: "Wyoming",
  editorEmail: "editor@testerville.org",
};

/** The panel and the form, transpiled against one scenario's stubs. */
async function renderPanel({ needsSetup, config, setupCheckFails = false }) {
  const reactQueryStub = inlineModule(`
    const DATA = {
      "my-desk": { role: "owner" },
      "paper-config-for-setup": ${JSON.stringify(config)},
      "first-run-setup": ${setupCheckFails ? "undefined" : `{ needsSetup: ${needsSetup} }`},
      "dark-county": { county: "" },
    };
    export function useQuery({ queryKey }) {
      const data = DATA[queryKey[0]];
      // A query that exhausted its retries: not pending, no data, in error.
      const failed = queryKey[0] === "first-run-setup" && data === undefined;
      return { data, isPending: false, isLoading: false, isError: failed, isFetchedAfterMount: true, state: { data } };
    }
    export function useMutation() {
      return { mutate() {}, mutateAsync: async () => {}, isPending: false, error: null };
    }
    export function useQueryClient() {
      return { invalidateQueries: async () => {}, setQueryData() {} };
    }
  `);

  const timezoneStub = inlineModule(`export const browserTimeZone = () => "America/Chicago";`);

  const formModule = moduleUrl(
    await readFile(new URL("../src/components/paper-setup-form.tsx", import.meta.url), "utf8"),
    "paper-setup-form.tsx",
    {
      "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
      react: REACT_URL,
      "@tanstack/react-query": reactQueryStub,
      "@/components/desk-chrome": deskChromeStub,
      "@/components/form-error": formErrorStub,
      "@/components/desk-chrome-utils": utilsStub,
      "@/lib/news/paper-settings": paperSettingsStub,
      "@/lib/timezone": timezoneStub,
    },
  );

  const panelModule = moduleUrl(
    await readFile(new URL("../src/components/ops-panels.tsx", import.meta.url), "utf8"),
    "ops-panels.tsx",
    {
      "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
      react: REACT_URL,
      "@tanstack/react-router": reactRouterStub,
      "@tanstack/react-query": reactQueryStub,
      "@/components/desk-chrome": deskChromeStub,
      "@/components/form-error": formErrorStub,
      "@/components/desk-chrome-utils": utilsStub,
      "@/components/paper-setup-form": formModule,
      "@/lib/auth/use-current-user": names(["useCurrentUserState"]),
      "@/components/states": names(["ListSkeleton"]),
      "@/lib/ops/dashboard": names(["getOpsHealth", "runOpsAction"]),
      "@/lib/ops/actions": inlineModule(`export const OPS_ACTIONS = {};`),
      "@/lib/ops/install-display": names(["installAction"]),
      "@/lib/ops/health": names(["formatAgo", "overallState"]),
      "@/lib/news/trash": inlineModule(
        `export const TRASH_DAYS = 30;\nexport function listTrash() { return null; }\nexport function purgeTrashItem() { return null; }\nexport function restoreTrashItem() { return null; }`,
      ),
      "@/lib/news/claim": inlineModule(
        `export function myDesk() { return null; }\nexport function inviteEditor() { return null; }\nexport function myRecoveryCodesStatus() { return null; }\nexport function regenerateRecoveryCodes() { return null; }`,
      ),
      "@/lib/paper-context-state": names(["usePaperDateFormatters"]),
      "@/lib/news/paper-settings": paperSettingsStub,
      "@/lib/desk/ops-cards": names(["opsCard"]),
      "@/lib/news/dark": names(["getDarkCounty", "saveDarkCounty"]),
      "@/lib/news/provider-login": names(["getProviderStatuses"]),
      "@/lib/news/provider-settings": names(["getProviderTimeSettings"]),
      "@/components/provider-time-field": inlineModule(`export const ProviderTimeField = () => null;`),
      "@/lib/news/desk-copy": names(["editorActionError", "inviteMessage"]),
      "@/lib/news/model-choice": names(["automaticOrderSentence"]),
      "@/lib/news/provider-availability": names(["localModelCatalog", "refreshLocalModelCatalog"]),
      "@/components/provider-status-card": inlineModule(`export const ProviderStatusCard = () => null;`),
      "@/components/status-chip": inlineModule(`export const Chip = () => null;`),
    },
  );

  const { PaperSetupPanel } = await import(panelModule);
  return renderToStaticMarkup(createElement(PaperSetupPanel));
}

/**
 * The value in the box identified by its placeholder.
 *
 * React's server renderer writes the attributes in the order the JSX lists
 * them, which here puts `placeholder` and `required` BEFORE `value` -- so the
 * box is found by its placeholder and read forward, not the other way round.
 */
const valueFor = (html, placeholder) => {
  const match = html.match(new RegExp(`placeholder="${placeholder}"[^>]*value="([^"]*)"`));
  return match ? match[1] : null;
};

test("an un-onboarded install's Paper setup panel starts blank -- no Longmont, no author's email", async () => {
  const html = await renderPanel({ needsSetup: true, config: LONGMONT_FALLBACK });

  // The three boxes the auditor read a real value out of.
  assert.equal(valueFor(html, "Riverbend"), "", "City must start blank");
  assert.equal(valueFor(html, "Ohio"), "", "State must start blank");
  assert.equal(valueFor(html, "editor@example.org"), "", "Editor email must start blank");
  assert.equal(valueFor(html, "Riverbend Record"), "", "Paper name must start blank");
  // F12: the zone is filled in from the browser in an effect, so the SERVER's
  // markup must leave it empty -- the field the client first renders too.
  // A server-side "America/Denver" here would be a hydration mismatch.
  assert.equal(valueFor(html, "Continent/City"), "", "Timezone must not be server-rendered");

  // And nothing else on the panel leaks the shipped identity either.
  assert.doesNotMatch(html, /Longmont/);
  assert.doesNotMatch(html, /Colorado/);
  assert.doesNotMatch(html, new RegExp(SHIPPED_EMAIL.replace(".", "\\.")));
  assert.doesNotMatch(html, /longmontcitycouncil\.org/);
});

test("an onboarded install's Paper setup panel is unchanged -- it shows what is saved", async () => {
  const html = await renderPanel({ needsSetup: false, config: SAVED });

  assert.equal(valueFor(html, "Riverbend"), "Testerville");
  assert.equal(valueFor(html, "Ohio"), "Wyoming");
  assert.equal(valueFor(html, "editor@example.org"), "editor@testerville.org");
  assert.equal(valueFor(html, "Riverbend Record"), "Testerville Ledger");
});

test("when the setup check itself fails the panel shows no form and no shipped identity (fails closed)", async () => {
  // The config query succeeded (it carries the Longmont fallback) but the
  // first-run check exhausted its retries: not pending, no data. The form must
  // not be drawn from the fallback, because Save would store it.
  const html = await renderPanel({ needsSetup: true, config: LONGMONT_FALLBACK, setupCheckFails: true });
  assert.match(html, /could not check whether this paper has been set up/);
  assert.match(html, /role="alert"/);
  assert.equal(valueFor(html, "Riverbend"), null, "no City box is drawn");
  assert.doesNotMatch(html, /<form/);
  assert.doesNotMatch(html, /Longmont/);
  assert.doesNotMatch(html, new RegExp(SHIPPED_EMAIL.replace(".", "\\.")));
});
