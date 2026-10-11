import { readFile } from "node:fs/promises";
import ts from "typescript";

// Render the real component; the test does not assert on TSX source spelling.
// Transpile in memory so this test neither builds nor writes into a live server.
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

/*
  The registry is the source of the option list as of 0.6.2, so it has to be
  transpiled and injected too: a data: URL cannot resolve a relative import.
*/
const registryUrl = moduleUrl(
  await readFile(new URL("../src/lib/news/provider-registry.ts", import.meta.url), "utf8"),
  "provider-registry.ts",
);
const registry = await import(registryUrl);
const preflightUrl = moduleUrl(
  await readFile(new URL("../src/lib/news/preflight.ts", import.meta.url), "utf8"),
  "preflight.ts",
);
const choices = moduleUrl(
  await readFile(new URL("../src/lib/news/model-choice.ts", import.meta.url), "utf8"),
  "model-choice.ts",
  { "./provider-registry.ts": registryUrl, "./preflight.ts": preflightUrl },
);
const choiceModule = await import(choices);

/*
  Unit CW (0.6.81) drew the Writer bar above the three editors and put its own
  rule -- "is the chosen writer usable on this server" -- in
  `lib/news/writer-bar.ts`, so `ModelPicker` imports it now. A data: URL cannot
  resolve a relative import any more than it can resolve `@/`, so the reader
  module is transpiled in and mapped like the registry and the preflight above,
  with its own two imports filled in the same way.
*/
const followUpCopyUrl = moduleUrl(
  await readFile(new URL("../src/lib/news/follow-up-copy.ts", import.meta.url), "utf8"),
  "follow-up-copy.ts",
);
const writerBarUrl = moduleUrl(
  await readFile(new URL("../src/lib/news/writer-bar.ts", import.meta.url), "utf8"),
  "writer-bar.ts",
  { "./model-choice.ts": choices, "./follow-up-copy.ts": followUpCopyUrl },
);

/*
  0.6.19: the picker now asks the server which offered providers are actually
  usable on this machine (see src/lib/news/provider-availability.ts) instead
  of trusting `enabled()` -- which reads `process.env` and does not exist in
  a browser bundle -- to have run anywhere near this component. This one stub
  module backs both the `useQuery` hook and the `providerAvailability` call
  it fetches with, so a test can flip `__setAvailability` and see the picker
  react, the same way the real query response would.
*/
const availabilityStubSrc = `
let current;
let connections = [];
let localChoice = { override: null, notice: null, catalog: { servers: [], defaultModel: null, checkedAt: 0 } };
export function __setLocalChoice(data) { localChoice = data; }
export function __setConnections(data) { connections = data; }
export function __setAvailability(data) { current = data; }

/*
  The desk role. \`LocalModelSelect\` asks \`myDesk()\` who is looking, because the
  stored local-model pick is owner-only on the server -- a non-owner gets the
  choice READ-ONLY with one line instead of a select that can only be refused.
  The stub answers "owner", which is what most cases in this file are about;
  \`__setRole\` covers the editor's read-only answer below.
*/
export let role = "owner";
export function __setRole(next) { role = next; }
export const myDesk = async () => ({ ok: true, role, newsroomId: 1, claimed: true });
export const useQuery = ({ queryKey }) => {
  if (queryKey[0] === "local-model-choice") return { data: localChoice };
  if (queryKey[0] === "local-model-catalog") return { data: localChoice.catalog };
  if (queryKey[0] === "custom-ai-connections") return { data: connections };
  if (queryKey[0] === "my-desk") return { data: { ok: true, role, newsroomId: 1, claimed: true } };
  return { data: current };
};
export const getCustomAiConnectionsFn = async () => connections;
export const providerAvailability = async () => current;
export const PROVIDER_AVAILABILITY_QUERY_KEY = ["provider-availability"];

/*
  0.6.19: model-picker.tsx also renders a second, per-model select (only
  when "Local model" is both selected AND available -- see
  ModelPicker's \`!selectedUnavailable\` guard -- which no case in this file
  exercises yet). These stand in for that select's own queries/mutations and
  its provider-settings server functions so the module graph resolves; no
  test here drives them beyond module load.
*/
export function useMutation({ mutationFn }) {
  return { mutate: (...args) => { void mutationFn?.(...args); }, isPending: false };
}
export function useQueryClient() {
  return { invalidateQueries() {}, setQueryData() {} };
}
const EMPTY_CATALOG = { servers: [], defaultModel: null, checkedAt: 0 };
export const localModelCatalog = async () => EMPTY_CATALOG;
export const refreshLocalModelCatalog = async () => EMPTY_CATALOG;
export const getLocalModelChoice = async () => ({ override: null, notice: null, catalog: EMPTY_CATALOG });
export const saveLocalModelFn = async () => ({ ok: true });
`;
const availabilityStubUrl = `data:text/javascript;base64,${Buffer.from(availabilityStubSrc).toString("base64")}`;
const availabilityStub = await import(availabilityStubUrl);

/*
  FB5: model-picker.tsx used to carry a private copy of `announceToDesk` and now
  imports the desk's one, so this specifier has to resolve. It is stubbed with
  the picker's other server functions -- the markup under test never calls it.
*/
const deskChromeUtilsStubUrl = moduleUrl(
  `export function announceToDesk() {}
export function announceOnly() {}`,
  "desk-chrome-utils-stub.ts",
);

const { ModelPicker } = await import(
  moduleUrl(
    await readFile(new URL("../src/components/model-picker.tsx", import.meta.url), "utf8"),
    "model-picker.tsx",
    {
      "@/lib/news/model-choice": choices,
      "@/lib/news/writer-bar": writerBarUrl,
      "@/lib/news/provider-registry": registryUrl,
      "@/lib/news/provider-availability": availabilityStubUrl,
      "@/lib/news/provider-availability-key": availabilityStubUrl,
      "@/lib/news/provider-settings": availabilityStubUrl,
      "@/lib/news/custom-ai-settings": availabilityStubUrl,
      "@/lib/news/claim": availabilityStubUrl,
      "@tanstack/react-query": availabilityStubUrl,

      "@/components/desk-chrome-utils": deskChromeUtilsStubUrl,
      react: import.meta.resolve("react"),
      "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
    },
  )
);

const writerBar = await import(writerBarUrl);
export { ModelPicker, availabilityStub, registry, choiceModule, writerBar };
