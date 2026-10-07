// guards: the editor could mistake Whistle meeting evidence for a Whisper transcript.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
const dataModule = (code) => "data:text/javascript;base64," + Buffer.from(code).toString("base64");
const row = { videoId: "vote", title: "Council", status: "captured", captionFormat: "textflowkit-json", transcriptionEngine: "whistle", transcriptionModel: "whistle", chunks: [], votes: [], aligned: null };
const imports = {
  "@/lib/news/desk-copy": dataModule("export const agendaTitle=x=>x;"),
  "@tanstack/react-query": dataModule(`export const useQuery=()=>({data:[${JSON.stringify(row)}]});`),
  "@/components/desk-chrome": dataModule("export const Busy=()=>null; export const SecHead=()=>null;"),
  "@/lib/news/meeting-activity": dataModule("export const listMeetingActivity=()=>[];"),
  "@/lib/news/meeting-activity-label": dataModule("export const meetingStatusLabel=()=>({tone:'ok',text:'Captured'});"),
  "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
};
const source = await readFile(new URL("../src/components/meetings-activity.tsx", import.meta.url), "utf8");
let output = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext } }).outputText;
for (const [name, url] of Object.entries(imports)) output = output.replaceAll(JSON.stringify(name), JSON.stringify(url));
const { MeetingsActivity } = await import(dataModule(output));
test("captured meeting shows its reported engine and model", () => {
  const html = renderToStaticMarkup(createElement(MeetingsActivity));
  assert.match(html, /engine whistle/);
  assert.match(html, /model whistle/);
  assert.doesNotMatch(html, /Whisper via/);
});
