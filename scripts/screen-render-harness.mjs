import { readFile } from "node:fs/promises";
import ts from "typescript";
import { stubUrl, transpileToUrl } from "./dom-harness.mjs";

const runtimeCache = new Map();
async function runtimeModule(file) {
  if (runtimeCache.has(file.href)) return runtimeCache.get(file.href);
  const source = await readFile(file, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      target: ts.ScriptTarget.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
    },
  }).outputText;
  const imports = {};
  for (const match of output.matchAll(/from "(\.[^"\s]+)"/g))
    imports[match[1]] = await runtimeModule(new URL(match[1], file));
  const url = transpileToUrl(output, file.pathname, imports);
  runtimeCache.set(file.href, url);
  return url;
}

// Load the real screen; replace transport, providers and unrelated controls.
export async function screenModule(path, overrides = {}, real = []) {
  return import(await screenModuleUrl(path, overrides, real));
}

/**
 * The zero-claims gate (`@/lib/news/unchecked-story-gate`) is a pure, model-free,
 * deterministic dependency of the story route, so it is loaded REAL by every
 * story-route render -- never stubbed to a null-returning fake, which the page's
 * `.blocked` read would crash on. A fixture that omits the gate's loader facts is
 * filled with "the check already completed", so a test that is not about this gate
 * keeps the readiness it had before; a test that is about it sets the facts.
 */
const ALWAYS_REAL = ["@/lib/news/unchecked-story-gate"];

export async function screenModuleUrl(path, overrides = {}, real = []) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = {};
  const stubs = {};
  for (const node of ast.statements) {
    if (!ts.isImportDeclaration(node) || node.importClause?.isTypeOnly) continue;
    const name = node.moduleSpecifier.text;
    if (name === "react") continue;
    if (real.includes(name) || ALWAYS_REAL.includes(name)) {
      const file =
        name.replace("@/", "src/") +
        (name.endsWith(".ts") || name.endsWith(".tsx")
          ? ""
          : name.startsWith("@/components/") &&
              !["@/components/check-gates", "@/components/publish-blockers"].includes(name)
            ? ".tsx"
            : ".ts");
      imports[name] =
        name === "@/lib/news/desk-copy"
          ? transpileToUrl(await readFile(new URL(`../${file}`, import.meta.url), "utf8"), file, {
              "./preflight.ts": stubUrl(
                "export const looksLikeProviderAuthFailure=()=>false,providerAuthTarget=()=>null;",
              ),
              "./lead-match.ts": stubUrl("export const distinguishingOverlap=()=>null;"),
              "../paper.ts": await runtimeModule(new URL("../src/lib/paper.ts", import.meta.url)),
            })
          : await runtimeModule(new URL(`../${file}`, import.meta.url));
      continue;
    }
    const bindings = node.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    stubs[name] =
      (stubs[name] ?? "") +
      bindings.elements
        .filter((e) => !e.isTypeOnly)
        .map((e) => {
          const key = (e.propertyName ?? e.name).text;
          const defaults = {
            createFileRoute: `() => options => ({...options, useParams: () => ({leadId:"22"})})`,
            useQuery: `({queryKey}) => ({data: (() => { const d = globalThis.screenData[queryKey[0]]; return d && typeof d === "object" && !Array.isArray(d) ? { uncheckedRecordedClaims: 0, uncheckedEvidenceChecked: true, uncheckedStoryAcknowledged: false, uncheckedExempt: false, ...d } : d; })(), isPending:false, isError:false})`,
            useMutation: `() => ({mutate(){}, isPending:false})`,
            useQueryClient: `() => ({invalidateQueries(){}})`,
            useLocation: `() => ({hash:""})`,
            useDeskMutation: `() => ({mutate(){}, isPending:false})`,
            useEditorSections: `() => ({sections:[]})`,
            usePaperDateFormatters: `() => ({formatDate:()=>"Oct. 8",formatShortDate:()=>"Oct. 8",formatDateTime:()=>"Oct. 8",formatListDateTime:()=>"Oct. 8",formatClockTime:()=>"noon"})`,
            usePaper: `() => ({city:"Longmont",timezone:"America/Denver"})`,
            useAreaLabels: `() => ({})`,
            useDeskJobs: `() => ({jobs:[], activeJobs:[]})`,
            usePaperSetupGate: `() => ({blocked:false})`,
            auditDraft: `() => ({findings:[]})`,
            findingsWithIds: `() => []`,
            parseNotes: `() => ({todo:[],todos:[],sources:[],opened:[],found:[],verify:[],unanswered:[]})`,
            draftFieldsMatch: `(a,b) => a.headline===b.headline && a.dek===b.dek && a.body===b.body && a.topic===b.topic`,
            earlierReportingNotes: `() => []`,
            mergeDraftEvidenceIntoNotes: `(notes) => notes`,
            parseUrlList: `() => []`,
            parseEvidence: `() => ({sources:[],claims:[]})`,
            uncheckedGateTodos: `() => []`,
            uncreditedOutlets: `() => []`,
            publishBlockers: `() => []`,
            publishConfirmation: `() => ({enabled:true,warnings:[],hard:[],confirmLabel:"Yes, print it"})`,
            publishPressState: `() => ({phase:"idle"})`,
            blockerPressState: `() => ({})`,
            recordedChecks: `() => ({})`,
            storyStages: `() => []`,
            readinessDot: `() => ({})`,
            saveState: `() => ({tone:"quiet",label:"Saved"})`,
            areaPills: `() => []`,
            IMPORT_DISCLOSURES: `[]`,
            DeskShell: `({children}) => children`,
            Field: `({children}) => children`,
            Chip: `({s}) => h("span",{className:"chip"},s)`,
          };
          return `export const ${key} = ${overrides[key] ?? defaults[key] ?? "() => null"};`;
        })
        .join("\n") +
      "\n";
  }
  for (const [name, body] of Object.entries(stubs))
    imports[name] = stubUrl(
      `import {createElement as h} from ${JSON.stringify(import.meta.resolve("react"))};\n` + body,
    );
  return transpileToUrl(source, path, imports);
}
