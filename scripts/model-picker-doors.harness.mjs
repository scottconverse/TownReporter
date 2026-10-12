import ts from "typescript";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { screenModuleUrl } from "./screen-render-harness.mjs";
import { moduleUrl, stubUrl } from "./dom-harness.mjs";
import {
  modelPickerUrl,
  registryUrl,
  modelChoiceUrl,
  writerBarUrl,
} from "./model-picker-render.harness.mjs";

// Keep the complete production JSX and every picker prop/branch. Only initial
// UI state is seeded, so SSR can open drawers without a browser or a server.
function seedState(source, path) {
  const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const edits = [];
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isArrayBindingPattern(node.name) &&
      node.initializer &&
      ts.isCallExpression(node.initializer)
    ) {
      const call = node.initializer;
      if (call.expression.getText(ast).endsWith("useState") && call.arguments[0]) {
        const name = node.name.elements[0]?.name?.getText(ast);
        const arg = call.arguments[0];
        edits.push([
          arg.getStart(ast),
          arg.end,
          `(Object.hasOwn(globalThis.pickerDoorState ?? {}, ${JSON.stringify(name)}) ? globalThis.pickerDoorState[${JSON.stringify(name)}] : ${arg.getText(ast)})`,
        ]);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  for (const [start, end, value] of edits.sort((a, b) => b[0] - a[0]))
    source = source.slice(0, start) + value + source.slice(end);
  return source;
}

const overrides = {
  useQuery: `({queryKey})=>({data:queryKey[0]==="lead"?{namedOutlets:[],outletOverrides:[],unreviewedClaims:[],uncheckedRecordedClaims:0,uncheckedEvidenceChecked:true,uncheckedExempt:false,...globalThis.screenData?.lead}:globalThis.screenData?.[queryKey[0]],isPending:false,isError:false})`,
  useDeskJobs: `()=>({data:[],jobs:[],activeJobs:[]})`,
  DeskShell: `({children,lede})=>h("main",{},lede,children)`,
  Link: `({children,to,hash,className})=>h("a",{href:to+(hash?"#"+hash:""),className},children)`,
  Dialog: `({open,children})=>open?h("section",{},children):null`,
  NativeDialog: `({open,children})=>open?h("section",{},children):null`,
  DeskMoreMenu: `({items})=>h("div",{},items?.map((i,n)=>h("div",{key:n},i.content)))`,
  SecHead: `({children})=>h("div",{},children)`,
  InkButton: `({children,tone,small,pending,pendingLabel,...props})=>h("button",props,children)`,
  usePaper: `()=>({city:"Longmont",name:"Fixture Paper",timezone:"America/Denver"})`,
  useNowMs: `()=>0`,
  useFirstRunPickerDefault: `()=>{}`,
  useResolvedJobModel: `()=>({providerId:"local-model",effort:null})`,
  useModelAssignments: `()=>({assignments:[],isPending:false})`,
  useFirstRunSetup: `()=>({blocked:false})`,
  tickedCards: `cards=>cards.filter(c=>c.ticked)`,
  openLeads: `rows=>rows`,
  suggestFocusLeads: `()=>[]`,
  parseTargets: `()=>[]`,
  validateFollowUpDialog: `()=>[]`,
  scheduleForAgent: `()=>"daily"`,
  activeInvestigations: `rows=>rows`,
  investigationPiles: `()=>[]`,
  darkScreenText: `x=>x`,
  dedupeFactLines: `()=>[]`,
  darkScreenData: `x=>x`,
  editionReadiness: `()=>({readyToCheck:[],needsWork:[],readyToPrint:[],printed:[]})`,
  MODEL_ASSIGNMENTS_QUERY_KEY: `["model-assignments"]`,
  PROVIDER_AVAILABILITY_QUERY_KEY: `["provider-availability"]`,
  tonightDrafts: `()=>({rows:[],readyToCheck:0,readyToPrint:0})`,
  useJobModelAssignment: `()=>({hasAssignment:false,isPending:false,providerId:"local-model",effort:null,model:"local-model",resolution:{providerId:"local-model",effort:null}})`,
  workingLeads: `rows=>rows`,
  storyReadiness: `()=>({state:"not-ready",openCount:0,totalCount:0})`,
  readinessWithUncheckedStory: `()=>({state:"not-ready",openCount:0,totalCount:0})`,
  readinessWithAcceptedClaims: `x=>x`,
  DARK_LIMITS: `[]`,
  acceptedClaimsPublishState: `()=>({blockers:[],readiness:{state:"not-ready",openCount:0,totalCount:0}})`,
};
const cache = new Map();
const fixtureRoot = await mkdtemp(join(tmpdir(), "townreporter-picker-doors-"));
let moduleIndex = 0;
async function fileModule(url) {
  const file = join(fixtureRoot, `${moduleIndex++}.mjs`);
  await writeFile(file, Buffer.from(url.split(",")[1], "base64"));
  return pathToFileURL(file).href;
}
export const cleanupDoorModules = () => rm(fixtureRoot, { recursive: true });
// `extra` replaces more module names for one door (e.g. DeskShell, which keeps the
// Queue header's `actions` slot; the default shell drops it).
export async function doorModule(path, exports = [], extra = {}) {
  const key = path + exports.join(",") + JSON.stringify(extra);
  if (cache.has(key)) return cache.get(key);
  const imports = {
    "@/components/model-picker": modelPickerUrl,
    "@/components/batch-model-choice": stubUrl(`
      export function useBatchModelChoice() {
        const runtime = globalThis.pickerDoorState?.batchRuntime ?? "auto";
        return { runtime, effort: null, setEffort() {}, pick() {}, touched: { current: false } };
      }
    `),
    "@/lib/news/provider-registry": registryUrl,
    "@/lib/news/model-choice": modelChoiceUrl,
    "@/lib/news/writer-bar": writerBarUrl,
  };
  if (path.endsWith("ops-panels.tsx"))
    imports["@/routes/desk.models"] = await doorModule("src/routes/desk.models.tsx");
  if (path.endsWith("desk.models.tsx")) {
    const assignments = await moduleUrl("src/lib/news/model-assignments.ts", {
      "./provider-registry.ts": registryUrl,
      "./model-choice.ts": modelChoiceUrl,
      "./automatic-failover.ts": stubUrl("export const looksLikeContentRefusal=()=>false;"),
    });
    imports["@/lib/news/model-assignments"] = assignments;
    imports["@/lib/news/model-assignment-draft"] = await moduleUrl(
      "src/lib/news/model-assignment-draft.ts",
      { "./model-assignments.ts": assignments },
    );
  }
  if (path.endsWith("editor-dialogs.tsx")) {
    imports["./editor-dialog-bodies"] = await moduleUrl(
      "src/components/dialogs/editor-dialog-bodies.ts",
    );
    imports["./editor-dialog-forms"] = await moduleUrl(
      "src/components/dialogs/editor-dialog-forms.ts",
    );
  }
  for (const [name, child] of Object.entries({
    "@/components/dialogs": "src/components/dialogs/editor-dialogs.tsx",
    "@/components/dialogs/editor-dialogs": "src/components/dialogs/editor-dialogs.tsx",
    "@/components/follow-up-dialog": "src/components/follow-up-dialog.tsx",
    "@/components/dialogs/RedraftDialog": "src/components/dialogs/RedraftDialog.tsx",
    "@/components/dark-dials-panel": "src/components/dark-dials-panel.tsx",
  })) {
    if (path !== child) imports[name] = await doorModuleChild(child);
  }
  const url = await screenModuleUrl(path, { ...overrides, ...extra }, [], {
    imports,
    transform: (source, file) =>
      seedState(source, file) + (exports.length ? `\nexport {${exports.join(",")}};` : ""),
  });
  const fileUrl = await fileModule(url);
  cache.set(key, fileUrl);
  return fileUrl;
}
const children = new Map();
async function doorModuleChild(path) {
  if (children.has(path)) return children.get(path);
  // These children do not import other door shells; avoid recursively loading
  // route-only dependencies when making their transport stubs.
  const imports = {
    "@/components/model-picker": modelPickerUrl,
    "@/components/batch-model-choice": stubUrl(`
      export function useBatchModelChoice() {
        const runtime = globalThis.pickerDoorState?.batchRuntime ?? "auto";
        return { runtime, effort: null, setEffort() {}, pick() {}, touched: { current: false } };
      }
    `),
    "@/lib/news/provider-registry": registryUrl,
    "@/lib/news/model-choice": modelChoiceUrl,
  };
  if (path.endsWith("editor-dialogs.tsx")) {
    imports["./editor-dialog-bodies"] = await moduleUrl(
      "src/components/dialogs/editor-dialog-bodies.ts",
    );
    imports["./editor-dialog-forms"] = await moduleUrl(
      "src/components/dialogs/editor-dialog-forms.ts",
    );
  }
  const url = await screenModuleUrl(path, overrides, [], { imports, transform: seedState });
  const fileUrl = await fileModule(url);
  children.set(path, fileUrl);
  return fileUrl;
}
