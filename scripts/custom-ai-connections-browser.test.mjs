// guards: a new owner sees the task in plain words before connection internals.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";
import { moduleUrl, stubUrl } from "./dom-harness.mjs";

const chromeStub = stubUrl(`import {createElement as h} from ${JSON.stringify(import.meta.resolve("react"))};
  export function Field({label,hint,children}){return h("label",{},h("span",{},label),children,hint?h("small",{},hint):null)}
  export function InkButton({children,tone,...props}){return h("button",props,children)}`);
const settingsStub = stubUrl(`
  export const capabilityStatus=()=>({});
  export const connectionSaveMessage=()=>"Saved.";
  export const managementActionsLocked=()=>false;
`);
const providerIdStub = stubUrl("export const isGeminiOpenAiEndpoint=()=>false;");
const utilsStub = stubUrl('export const inputClass="input";');
const componentUrl = await moduleUrl("src/components/custom-ai-connections.tsx", {
  "./desk-chrome": chromeStub,
  "./desk-chrome-utils": utilsStub,
  "@/lib/news/custom-ai-settings": settingsStub,
  "@/lib/news/provider-model-id": providerIdStub,
});
const { CustomAiConnections } = await import(componentUrl);

test("FB22: the connection form leads with the owner's action and folds technical settings under Details", async () => {
  const html = renderToStaticMarkup(createElement(CustomAiConnections, {
    connections: [],
    showHeading: false,
    onSave: async () => ({}),
    onDiscover: async () => [],
    onTest: async () => ({}),
    onEnable: async () => {},
    onDelete: async () => {},
  }));
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 } });
    try {
      await page.setContent(html);
      assert.match(await page.locator("body").innerText(), /Give this writing model a name and add the key from your AI service/);
      assert.equal(await page.getByLabel("Connection name").isVisible(), true);
      assert.doesNotMatch(await page.locator("body").innerText(), /OpenAI-compatible endpoint|OAuth|LiteLLM/);
      assert.equal(await page.getByLabel("Base URL").isVisible(), false);
      assert.equal(await page.getByLabel("Key from your AI service (optional)").isVisible(), false);
      await page.getByText("Details: server address, model name, and key", { exact: true }).click();
      assert.equal(await page.getByLabel("Base URL").isVisible(), true);
      assert.equal(await page.getByLabel("Key from your AI service (optional)").isVisible(), true);
      assert.equal(await page.getByLabel("Model name (optional)").isVisible(), true);
      assert.match(await page.locator("body").innerText(), /Using LiteLLM/);
      await page.getByText("Details: server address, model name, and key", { exact: true }).click();
      assert.equal(await page.getByLabel("Base URL").isVisible(), false);
    } finally { await page.close(); }
  } finally { await browser.close(); }
});
