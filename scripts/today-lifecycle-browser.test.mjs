// guards: Today could invite the editor to finish and print a killed story.
import assert from "node:assert/strict";
import { test } from "node:test";
import { installDom, moduleUrl, transpileToUrl } from "./dom-harness.mjs";

const window = installDom();
const React = await import("react");
const { createRoot } = await import("react-dom/client");
// Navigation is recorded because linkedom has no default anchor action.
const { TodayInProgress } = await import(await moduleUrl("src/components/today-in-progress.tsx", {
  "@tanstack/react-router": transpileToUrl(`import React from "react"; export const Link=({children,params,className})=><a className={className} href={'#'+params?.leadId} onClick={()=>{window.location.hash='#'+params?.leadId}}>{children}</a>;`, "router.tsx"),
  "./desk-chrome": transpileToUrl(`import React from "react"; export const SecHead=({title})=><h2>{title}</h2>;`, "chrome.tsx"),
  "../lib/news/today-in-progress": await moduleUrl("src/lib/news/today-in-progress.ts"),
  "../lib/news/job-progress": transpileToUrl("export {};", "types.ts"),
}));

test("Today In progress shows open drafts and omits killed and published stories", async (t) => {
  const leads = [{ id: 440, status: "killed" }, { id: 437, status: "killed" }, { id: 415, status: "killed" },
    { id: 22, status: "new", article_slug: "published-story" }, { id: 23, status: "drafted" }];
  const jobs = leads.map(l => ({ id: l.id, leadId: l.id, kind: "draft", status: "completed", headline: "Story " + l.id }));
  function Desk() {
    const [today, setToday] = React.useState(false);
    return React.createElement(React.Fragment, null,
      React.createElement("button", { onClick: () => setToday(true) }, "Today"),
      today && React.createElement(TodayInProgress, { jobs, leads, isError: false, isPending: false, refetch() {} }));
  }
  const container = document.getElementById("root"), root = createRoot(container);
  t.after(async () => { await React.act(async () => root.unmount()); });
  await React.act(async () => root.render(React.createElement(Desk)));
  const click = async node => { assert.ok(node); await React.act(async () => node.dispatchEvent(new window.Event("click", { bubbles: true }))); };
  await click(container.querySelector("button"));
  const strip = container.querySelector('section[aria-label="In progress"]');
  assert.deepEqual([...strip.querySelectorAll("h3")].map(node => node.textContent), ["Story 23"]);
  await click(strip.querySelector("a.btn"));
  assert.equal(window.location.hash, "#23");
});
