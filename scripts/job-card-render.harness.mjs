import { readFile } from "node:fs/promises";
import ts from "typescript";

/*
  The JobCard's four states, rendered from the real component
  (src/components/JobCard.tsx) with the server's own view shape.

  WHY A RENDER TEST AND NOT A BROWSER. Everything the design asks the card to
  prove is a property of the markup: the chip row and which chip is current, a
  determinate bar at 42% versus an indeterminate one, the stall box appearing at
  60s of quiet and NOT at 59s, "Cancelled by the editor" as the reason line, the
  Open button carrying the href the SERVER chose, and Retry being absent when
  the row cannot honour a retry (`canRetry` false). None of that needs a model,
  a provider, a router or a session -- so the test runs against the component
  and a frozen clock, which is what makes the 59/60 boundary testable at all.

  The clock (`now`) is a prop precisely so this file can be deterministic: the
  card's stall rule is `now - beatAt >= 60s`, and a test that waited 60 real
  seconds to observe it would be a test nobody runs.

  Stubs, as in lead-badge-render.test.mjs: React is the real module, and
  `@/lib/news/job-progress` and `@tanstack/react-query` are replaced with
  minimal in-memory modules. job-progress.ts reaches the database, the desk
  session and the provider toolchain at its top level; none of that is what
  this test is about, and the card only needs the TYPES from it (erased).
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

const jobProgressStub = inlineModule(`
  export async function cancelStoryJob() { throw new Error("not used in a render test"); }
  export async function listDeskJobs() { return []; }
  export async function retryStoryJob() { throw new Error("not used in a render test"); }
`);

// Only the names have to exist: renderToStaticMarkup never runs a query or a
// mutation, and the card's hooks are not called because the test renders the
// pure `JobCard`, not the `DeskJobCard` wrapper that owns them.
const reactQueryStub = inlineModule(`
  export function useQuery() { return { data: undefined, state: { data: undefined } }; }
  export function useMutation() { return { mutate() {}, isPending: false, error: null, data: null }; }
  export function useQueryClient() { return { invalidateQueries() {} }; }
`);

/*
  The card's state rule and its data hook live in `job-card-state.ts`, beside
  the card, because eslint's react-refresh rule warns about a module that
  exports both a component and a plain function. The split is also what this
  test has to follow: `JobCard.tsx` imports it by a RELATIVE specifier, which a
  data: URL cannot resolve, so the module is transpiled and mapped by name the
  same way the bare specifiers are.
*/
const jobCardStateModule = moduleUrl(
  await readFile(new URL("../src/components/job-card-state.ts", import.meta.url), "utf8"),
  "job-card-state.ts",
  {
    "../lib/desk/scan-policy-refresh.ts": new URL("../src/lib/desk/scan-policy-refresh.ts", import.meta.url).href,
    "@/lib/news/job-progress": jobProgressStub,
    "@/components/scoped-actions": jobProgressStub,
    "@tanstack/react-query": reactQueryStub,
  },
);

const JobCardModule = moduleUrl(
  await readFile(new URL("../src/components/JobCard.tsx", import.meta.url), "utf8"),
  "JobCard.tsx",
  {
    // React is the real module (the card is a React component, not a React
    // stand-in): only the specifier has to be resolved for a data: URL, which
    // has no node_modules to resolve it against.
    "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
    react: REACT_URL,
    "@/lib/news/job-progress": jobProgressStub,
    "@/components/scoped-actions": jobProgressStub,
    "@tanstack/react-query": reactQueryStub,
    "./job-card-state": jobCardStateModule,
  },
);
const { JobCard } = await import(JobCardModule);
const { jobCardState } = await import(jobCardStateModule);

export { JobCard, jobCardState };
