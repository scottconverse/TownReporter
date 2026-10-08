import { build } from "vite";
import { chromium } from "playwright";
import { resolve } from "node:path";

// Only transport and unrelated controls are doubles; the dialog and its body run in Chromium.
const stubs = {
  "@/components/model-picker": "export const ModelPicker=()=>null;",
  "@/components/desk-chrome": "import React from 'react'; export const InkButton=({children,onClick,disabled})=><button onClick={onClick} disabled={disabled}>{children}</button>; export const SecHead=({title})=><h2>{title}</h2>;",
  "@/components/desk-chrome-utils": "export const announceToDesk=()=>{};",
  "@/lib/news/dark": "export const openDarkInvestigation=()=>{};",
  "@/lib/news/desk": "export const addSource=()=>{},addSourcesBulk=()=>{},fileLead=()=>{},findPasteDuplicate=()=>{},listSources=()=>{},saveDraft=()=>{},suggestHeadlines=()=>{},writeStoryFromInput=()=>{};",
  "@/lib/news/draft-reconcile-actions": "export const requestDraftReconciliationFn=()=>{};",
  "@/lib/news/editor-dialog-actions": "export const holdLead=async({data})=>{const result=await window.holdRequest(data);window.lastHold=data.id;return result}; export const addLead=()=>{},chooseHeadline=()=>{},findSources=()=>{},sourceKillPattern=()=>{},weaveIntoStory=()=>{};",
  "@/lib/news/story-document-api": "export const uploadStoryDocument=()=>{};",
  "@/lib/use-sections": "export const useEditorSections=()=>({sections:[]});",
  "@tanstack/react-router": "import React from 'react'; export const Link=({children,params})=><a href={'#'+params?.leadId}>{children}</a>;",
};

export async function browserFixture(t, source) {
  const output = await build({ configFile: false, logLevel: "silent", define: { "process.env.NODE_ENV": '"production"' },
    plugins: [{ name: "lifecycle-fixture", enforce: "pre", resolveId(id) {
      if (id === resolve("fixture.tsx")) return "\0fixture";
      if (id in stubs) return "\0" + id;
      if (id === "./desk-chrome") return "\0@/components/desk-chrome";
      if (id.startsWith("@/")) return resolve("src", id.slice(2)) + (id === "@/components/dialog" ? ".tsx" : ".ts");
      if (id.startsWith("./src/")) return resolve(id);
    }, load(id) { if (id === "\0fixture") return source; return stubs[id.slice(1)]; },
      transform(code, id) { if (id.startsWith("\0")) return { code, moduleType: "tsx" }; } }],
    build: { write: false, lib: { entry: resolve("fixture.tsx"), formats: ["iife"], name: "Fixture" }, minify: false } });
  const browser = await chromium.launch({ headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: (Array.isArray(output) ? output[0] : output).output.find(chunk => chunk.type === "chunk").code });
  return page;
}
