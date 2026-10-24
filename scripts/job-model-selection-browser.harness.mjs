import { readFileSync, existsSync } from "node:fs";
import { resolve, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { rolldown } from "rolldown";
import { chromium } from "playwright";
import { screenModuleUrl } from "./screen-render-harness.mjs";
import { moduleUrl, stubUrl } from "./dom-harness.mjs";
import { registryUrl, modelChoiceUrl, writerBarUrl } from "./model-picker-render.harness.mjs";

const root = resolve(import.meta.dirname, "..");
const storyPath = "src/routes/desk.story.$leadId.tsx";
const dialogPath = "src/components/dialogs/editor-dialogs.tsx";
const fixture = {
  "my-desk": { ok: true, role: "owner", newsroomId: 1 },
  "custom-ai-connections": [],
  "provider-statuses": [],
  "local-model-catalog": { servers: [], defaultModel: null, checkedAt: 0 },
  "local-model-choice": {
    override: null,
    notice: null,
    catalog: { servers: [], defaultModel: null, checkedAt: 0 },
  },
  "provider-availability": {
    "deepseek-flash": true,
    "codex-balanced": true,
    "local-model": true,
    "claude-sonnet": true,
  },
  "first-run-setup": { needsSetup: false },
  sources: [],
  "drafts-desk": [],
  leads: [],
  scans: [],
  investigations: [],
  "worth-a-look": [],
  "published-desk": [],
  memory: [],
  "follow-ups": [],
  "follow-up-findings": [],
  lead: {
    lead: {
      id: 22,
      headline: "Service changes",
      topic: "transportation",
      status: "drafted",
      source_urls: "[]",
      notes_json: "{}",
    },
    draft: {
      id: 8,
      headline: "Service changes",
      dek: "Feedback is open",
      body: "Residents can comment on service changes.",
      topic: "transportation",
      research_json: null,
    },
    job: null,
    sources: [],
    memory: [],
    namedOutlets: [],
    outletOverrides: [],
    unreviewedClaims: [],
    uncheckedRecordedClaims: 0,
    uncheckedEvidenceChecked: true,
    uncheckedExempt: false,
  },
};

// Assignment reads/mutations use genuine React Query. The other services are
// static UI facts: this browser never starts a server, connects a DB, or calls a model.
const queryUrl =
  stubUrl(`import {useQuery as query,useMutation,useQueryClient} from ${JSON.stringify(import.meta.resolve("@tanstack/react-query"))};
export {useMutation,useQueryClient};
export function useQuery(options){if(options.queryKey[0]==="model-assignments")return query(options);const data=window.screenData[options.queryKey[0]];return {data,isPending:false,isError:false,isSuccess:true,refetch:async()=>({data})};}`);
const settingsUrl = stubUrl(`export const MODEL_ASSIGNMENTS_QUERY_KEY=["model-assignments"];
export async function getModelAssignmentsFn(){window.assignmentReads++;return {ok:true,assignments:structuredClone(window.assignmentRows)};}
export async function saveModelAssignmentsFn({data}){window.assignmentWrites.push(structuredClone(data));window.assignmentRows=structuredClone(data);return {ok:true,assignments:structuredClone(window.assignmentRows)};}
export function assignmentsFromSave(result){return result.ok?result.assignments:null;}`);

export async function jobModelBrowser({ baselineRef, notesJson, assignmentRows } = {}) {
  // Today's values are the defaults; a test may hand the lead saved notes or
  // preset the "Who does what" rows before the page mounts.
  const screenData = notesJson === undefined
    ? fixture
    : {
        ...fixture,
        lead: { ...fixture.lead, lead: { ...fixture.lead.lead, notes_json: notesJson } },
      };
  const baselineSources = baselineRef
    ? new Map(
        [storyPath, dialogPath].map((path) => [
          path,
          execFileSync("git", ["show", `${baselineRef}:${path}`], {
            cwd: root,
            encoding: "utf8",
            windowsHide: true,
          }),
        ]),
      )
    : new Map();
  const assignments = await moduleUrl("src/lib/news/model-assignments.ts", {
    "./provider-registry.ts": registryUrl,
    "./model-choice.ts": modelChoiceUrl,
    "./automatic-failover.ts": stubUrl("export const looksLikeContentRefusal=()=>false;"),
  });
  const imports = {
    "@tanstack/react-query": queryUrl,
    "@/lib/news/provider-registry": registryUrl,
    "@/lib/news/model-choice": modelChoiceUrl,
    "@/lib/news/writer-bar": writerBarUrl,
    "@/lib/news/model-assignments": assignments,
    "@/lib/news/model-assignments-settings": settingsUrl,
  };
  imports["@/lib/news/model-assignment-draft"] = await moduleUrl(
    "src/lib/news/model-assignment-draft.ts",
    { "./model-assignments.ts": assignments },
  );
  /*
    The screen renderer's default `parseNotes` stub answers `{}` for every
    lead, so the page cannot read a saved writer pick (D275) at all. This
    harness is about what the Story page does with saved notes, so the real
    notes module is loaded; only its text-to-assignment helper is stubbed,
    because that one reaches the writer module.
  */
  imports["@/lib/news/notes"] = await moduleUrl("src/lib/news/notes.ts", {
    "./write-story.ts": stubUrl("export const editorialAssignmentFromText=()=>null;"),
  });
  imports["@/components/use-job-model-assignment"] = await moduleUrl(
    "src/components/use-job-model-assignment.ts",
    imports,
  );
  const overrides = {
    DeskShell: `({children,lede,actions})=>h("main",{},lede,actions,children)`,
    InkButton: `({children,tone,small,pending,pendingLabel,ariaLabel,...props})=>h("button",{...props,"aria-label":ariaLabel},children)`,
    SecHead: `({children})=>h("div",{},children)`,
    Link: `({children,to,className})=>h("a",{href:to,className},children)`,
    useLocation: `()=>({hash:""})`,
    useNavigate: `()=>()=>{}`,
    useFirstRunPickerSeed: `()=>{}`,
    useFirstRunPickerDefault: `()=>"auto"`,
    useDeskJobs: `()=>({jobs:[],activeJobs:[]})`,
    useNowMs: `()=>0`,
    usePaper: `()=>({city:"Longmont",name:"Fixture Paper",timezone:"America/Denver"})`,
    useEditorSections: `()=>({sections:[{key:"transportation",name:"Transportation"}],isPending:false})`,
    editionReadiness: `()=>({readyToCheck:[],needsWork:[],readyToPrint:[],printed:[]})`,
    tonightDrafts: `()=>({rows:[],readyToCheck:0,readyToPrint:0})`,
    acceptedClaimsPublishState: `()=>({blockers:[],readiness:{state:"not-ready",openCount:0,totalCount:0}})`,
    liveClaimsOwnReadiness: `()=>false`,
    savedStoryReadiness: `()=>null`,
    readinessWithAcceptedClaims: `x=>x`,
    readinessWithUncheckedStory: `x=>x`,
    storyReadiness: `()=>({state:"not-ready",openCount:0,totalCount:0})`,
    getCustomAiConnectionsFn: `async()=>[]`,
    PROVIDER_AVAILABILITY_QUERY_KEY: `["provider-availability"]`,
    modelReadiness: `()=>"Ready"`,
    openLeads: `rows=>rows`,
    workingLeads: `rows=>rows`,
    suggestFocusLeads: `()=>[]`,
    activeInvestigations: `rows=>rows`,
    investigationPiles: `()=>[]`,
    tickedCards: `cards=>cards.filter(card=>card.ticked)`,
    parseTargets: `()=>[]`,
    validateFollowUpDialog: `()=>[]`,
    scheduleForAgent: `()=>"daily"`,
    DeskMoreMenu: `({items})=>h("div",{},items?.map((item,i)=>h("div",{key:i},item.content)))`,
  };
  // Use the full production shared picker and dialog body. Only transport and
  // unrelated UI widgets are replaced; neither picker state nor effects are seeded.
  imports["@/components/model-picker"] = await screenModuleUrl(
    "src/components/model-picker.tsx",
    overrides,
    [],
    { imports },
  );
  imports["./editor-dialog-bodies"] = await moduleUrl(
    "src/components/dialogs/editor-dialog-bodies.ts",
  );
  imports["./editor-dialog-forms"] = await moduleUrl(
    "src/components/dialogs/editor-dialog-forms.ts",
  );
  imports["@/components/dialog"] = await screenModuleUrl(
    "src/components/dialog.tsx",
    overrides,
    [],
    { imports },
  );
  const dialogs = await screenModuleUrl(dialogPath, overrides, [], {
    imports,
    transform: (source) => baselineSources.get(dialogPath) ?? source,
  });
  imports["@/components/dialogs"] = dialogs;
  imports["@/components/dialogs/editor-dialogs"] = dialogs;
  const models = await screenModuleUrl("src/routes/desk.models.tsx", overrides, [], { imports });
  const story = await screenModuleUrl(storyPath, overrides, [], {
    imports,
    transform: (source) => baselineSources.get(storyPath) ?? source,
  });
  const today = await screenModuleUrl("src/routes/desk.index.tsx", overrides, [], { imports });
  // Give nested in-memory modules short ids before bundling. Encoding every
  // dependency into each parent URL otherwise makes the route graph enormous.
  const sources = new Map();
  const ids = new Map();
  function compact(url) {
    if (!url.startsWith("data:")) return url;
    if (ids.has(url)) return ids.get(url);
    const id = "fixture:" + ids.size;
    ids.set(url, id);
    const source = Buffer.from(url.split(",")[1], "base64")
      .toString()
      .replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g, compact);
    sources.set(id, source);
    return id;
  }
  const moduleIds = { models: compact(models), story: compact(story), today: compact(today) };
  const entry = `import React from ${JSON.stringify(import.meta.resolve("react"))};import {createRoot} from ${JSON.stringify(import.meta.resolve("react-dom/client"))};import {QueryClient,QueryClientProvider} from ${JSON.stringify(import.meta.resolve("@tanstack/react-query"))};
import {Route as Models} from ${JSON.stringify(moduleIds.models)};import {Route as Story} from ${JSON.stringify(moduleIds.story)};import {Route as Today} from ${JSON.stringify(moduleIds.today)};
window.screenData=${JSON.stringify(screenData)};window.assignmentRows=${JSON.stringify(assignmentRows ?? [])};window.assignmentWrites=[];window.assignmentReads=0;
const client=new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});const root=createRoot(document.getElementById("root"));
window.mountDoor=name=>{client.removeQueries({queryKey:["model-assignments"]});root.render(React.createElement(QueryClientProvider,{client},React.createElement(({models:Models,story:Story,today:Today})[name].component,{key:name})));};window.mountDoor("models");`;
  const bundle = await rolldown({
    cwd: root,
    input: "job-model-browser",
    transform: {
      jsx: "react-jsx",
      define: { "import.meta.env": "{}", "process.env.NODE_ENV": JSON.stringify("production") },
    },
    plugins: [
      {
        name: "isolated-job-model-browser",
        resolveId(id, importer) {
          if (id === "job-model-browser" || id.startsWith("data:") || sources.has(id)) return id;
          if (id.startsWith("file:")) return fileURLToPath(id);
          if (id.startsWith("@/")) {
            const base = resolve(root, "src", id.slice(2));
            return extname(base)
              ? base
              : [".tsx", ".ts", ".js"].map((ext) => base + ext).find(existsSync);
          }
          if (id.startsWith(".") && importer && !importer.startsWith("data:")) {
            const base = resolve(dirname(importer), id);
            return extname(base)
              ? base
              : [".tsx", ".ts", ".js"].map((ext) => base + ext).find(existsSync);
          }
        },
        load(id) {
          if (id === "job-model-browser") return entry;
          if (sources.has(id)) return sources.get(id);
          if (id.startsWith("data:")) return Buffer.from(id.split(",")[1], "base64").toString();
          if (id.startsWith("file:")) return readFileSync(fileURLToPath(id), "utf8");
        },
      },
    ],
  });
  let browser;
  try {
    const { output } = await bundle.generate({ format: "iife" });
    await bundle.close();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/*", (route) => route.abort());
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: output[0].code });
    return { page, errors, close: () => browser.close() };
  } catch (error) {
    await bundle.close();
    await browser?.close();
    throw error;
  }
}
