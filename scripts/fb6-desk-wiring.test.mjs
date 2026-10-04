/*
  FB6: the wiring, pinned where a browser walk cannot see it.

  FB0 Table B, Drafts: "no chips, no bar, **no Cancel** -- a draft can only be
  cancelled from the story page". The card itself is the fix, so this renders
  the REAL `DeskJobCard` -- the component `desk.drafts.tsx` mounts -- with a
  running job and reads the buttons it draws. Everything else FB6 changed lives
  at call sites a Node test cannot import (routes need a database and a router;
  the stylesheet is CSS), so it is not pinned here.
*/
import assert from "node:assert/strict";
import { test } from "node:test";

test("a running card carries the Cancel the Drafts row needs", async () => {
  /*
    FB0 Table B, Drafts: "no chips, no bar, **no Cancel** -- a draft can only be
    cancelled from the story page". The card itself is the fix, so this renders
    the REAL `DeskJobCard` -- the component `desk.drafts.tsx` mounts -- with a
    running job and reads the buttons it draws.
  */
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const ts = (await import("typescript")).default;
  const readFile = (await import("node:fs/promises")).readFile;
  const React = import.meta.resolve("react");
  const moduleUrl = (source, fileName, imports) => {
    let output = ts.transpileModule(source, {
      fileName,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.ESNext },
    }).outputText;
    for (const [name, url] of Object.entries(imports)) {
      output = output.replaceAll(JSON.stringify(name), JSON.stringify(url));
    }
    return `data:text/javascript;base64,${Buffer.from(output).toString("base64")}`;
  };
  const inline = (body) =>
    `data:text/javascript;base64,${Buffer.from(body).toString("base64")}`;
  const jobProgress = inline(`
    export async function cancelStoryJob() { throw new Error("not pressed in a render test"); }
    export async function retryStoryJob() { throw new Error("not pressed in a render test"); }
    export async function listDeskJobs() { return []; }
  `);
  const reactQuery = inline(`
    export function useQuery() { return { data: undefined, state: { data: undefined } }; }
    export function useMutation() { return { mutate() {}, isPending: false, error: null, data: null }; }
    export function useQueryClient() { return { invalidateQueries() {} }; }
  `);
  const stateUrl = moduleUrl(
    await readFile(new URL("../src/components/job-card-state.ts", import.meta.url), "utf8"),
    "job-card-state.ts",
    { "@/lib/news/job-progress": jobProgress, "@tanstack/react-query": reactQuery },
  );
  const cardUrl = moduleUrl(
    await readFile(new URL("../src/components/JobCard.tsx", import.meta.url), "utf8"),
    "JobCard.tsx",
    {
      "react/jsx-runtime": import.meta.resolve("react/jsx-runtime"),
      react: React,
      "@/lib/news/job-progress": jobProgress,
      "@tanstack/react-query": reactQuery,
      "./job-card-state": stateUrl,
    },
  );
  const { DeskJobCard } = await import(cardUrl);

  const running = {
    id: 41,
    leadId: 7,
    kind: "draft",
    status: "running",
    title: "Drafting story",
    model: "DeepSeek v4.1 Flash",
    stages: ["Planning the reporting", "Writing the draft", "Checking the draft"],
    stageIndex: 1,
    pct: 42,
    step: "Writing the draft",
    startedAt: Date.now() - 75_000,
    endedAt: null,
    beatAt: Date.now() - 2_000,
    error: null,
    resultHref: null,
    openLabel: null,
    canRetry: false,
    cancelRequested: false,
    failoverNote: null,
    doneText: "Done",
  };
  const html = renderToStaticMarkup(createElement(DeskJobCard, { job: running }));
  assert.match(html, />Cancel</, "a running draft cannot be stopped from the Drafts row");
  assert.match(html, /job-card-chip/, "the stage chips are the card's, not a stand-in's");
  assert.match(html, /Writing the draft/, "and the step is in words");
  assert.match(html, /42%/, "and the percent the stand-in never carried");

  // A job whose cancellation has been asked for draws no second Cancel.
  const cancelled = renderToStaticMarkup(
    createElement(DeskJobCard, { job: { ...running, cancelRequested: true } }),
  );
  assert.equal(/button[^>]*>Cancel</.test(cancelled), false);
  assert.match(cancelled, /Cancelling/);
});
