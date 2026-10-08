import { readFile } from "node:fs/promises";
import ts from "typescript";
import { moduleUrl, stubUrl, transpileToUrl } from "./dom-harness.mjs";

// Load the real screen; replace transport, providers and unrelated controls.
export async function screenModule(path, overrides = {}, real = []) {
  const source = await readFile(new URL(`../${path}`, import.meta.url), "utf8");
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = {};
  for (const node of ast.statements) {
    if (!ts.isImportDeclaration(node) || node.importClause?.isTypeOnly) continue;
    const name = node.moduleSpecifier.text;
    if (name === "react") continue;
    if (real.includes(name)) {
      const file =
        name.replace("@/", "src/") + (name.endsWith(".ts") || name.endsWith(".tsx") ? "" : ".ts");
      imports[name] =
        name === "@/lib/news/desk-copy"
          ? transpileToUrl(await readFile(new URL(`../${file}`, import.meta.url), "utf8"), file, {
              "./preflight.ts": stubUrl(
                "export const looksLikeProviderAuthFailure=()=>false,providerAuthTarget=()=>null;",
              ),
              "./lead-match.ts": stubUrl("export const distinguishingOverlap=()=>null;"),
              "../paper.ts": stubUrl("export const TOPICS=[];"),
            })
          : await moduleUrl(file);
      continue;
    }
    const bindings = node.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    imports[name] = stubUrl(
      `import {createElement as h} from ${JSON.stringify(import.meta.resolve("react"))};\n` +
        bindings.elements
          .filter((e) => !e.isTypeOnly)
          .map((e) => {
            const key = (e.propertyName ?? e.name).text;
            const defaults = {
              createFileRoute: `() => options => ({...options, useParams: () => ({leadId:"22"})})`,
              useQuery: `({queryKey}) => ({data: globalThis.screenData[queryKey[0]], isPending:false, isError:false})`,
              useMutation: `() => ({mutate(){}, isPending:false})`,
              useQueryClient: `() => ({invalidateQueries(){}})`,
              useDeskMutation: `() => ({mutate(){}, isPending:false})`,
              useEditorSections: `() => ({sections:[]})`,
              usePaperDateFormatters: `() => ({formatShortDate:()=>"Oct. 8",formatDateTime:()=>"Oct. 8"})`,
              usePaper: `() => ({city:"Longmont",timezone:"America/Denver"})`,
              useAreaLabels: `() => ({})`,
              useDeskJobs: `() => ({jobs:[], activeJobs:[]})`,
              usePaperSetupGate: `() => ({blocked:false})`,
              auditDraft: `() => ({findings:[]})`,
              findingsWithIds: `() => []`,
              parseNotes: `() => ({todo:[],todos:[],sources:[],opened:[],found:[],verify:[],unanswered:[]})`,
              earlierReportingNotes: `() => []`,
              mergeDraftEvidenceIntoNotes: `(notes) => notes`,
              parseUrlList: `() => []`,
              parseEvidence: `() => ({sources:[],claims:[]})`,
              uncheckedGateTodos: `() => []`,
              uncreditedOutlets: `() => []`,
              publishBlockers: `() => []`,
              publishPressState: `() => ({phase:"idle"})`,
              blockerPressState: `() => ({})`,
              recordedChecks: `() => ({})`,
              storyStages: `() => []`,
              readinessDot: `() => ({})`,
              areaPills: `() => []`,
              DeskShell: `({children}) => children`,
              Field: `({children}) => children`,
              Chip: `({s}) => h("span",{className:"chip"},s)`,
            };
            return `export const ${key} = ${overrides[key] ?? defaults[key] ?? "() => null"};`;
          })
          .join("\n"),
    );
  }
  return import(transpileToUrl(source, path, imports));
}
