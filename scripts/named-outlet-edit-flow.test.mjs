// guards: editing a saved outlet could discard the name and block review.
import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { build } from "vite";
import { chromium } from "playwright";

// A browser-mounted real panel with a read-only fixture; no app server or DB.
const fixtures = {
  "@tanstack/react-query": `export const useQuery=()=>({data:{canEdit:true,stored:[{name:"Old Gazette",aliases:[],domains:["gazette.test"]}],shipped:[],revision:1}}); export const useQueryClient=()=>({});`,
  "./desk-chrome": `import React from "react"; export const InkButton=({children,onClick,disabled})=>React.createElement("button",{onClick,disabled},children);`,
  "./desk-chrome-utils": `export const inputClass="";`,
  "./unsaved-changes-guard": `export const UnsavedChangesGuard=()=>null;`,
  "@/lib/news/named-outlets": `export const editorNamedOutlets=()=>{}; export const applyNamedOutlets=()=>{}; export const namedOutletsPreview=async()=>({ok:true,preview:{revision:1,usingShipped:false,changes:[]}});`,
  "@/lib/news/named-outlet-rules": `export {outletProblems} from "${resolve("src/lib/news/named-outlet-rules.ts").replaceAll("\\", "/")}";`,
};
test("a saved outlet name survives blur and can be reviewed", async () => {
  const bundle = await build({
    configFile: false,
    logLevel: "silent",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    plugins: [
      {
        name: "outlet-fixture",
        enforce: "pre",
        resolveId(id) {
          if (id === "outlet-entry" || id in fixtures) return "\0" + id;
        },
        load(id) {
          if (id === "\0outlet-entry")
            return `import React from "react"; import {createRoot} from "react-dom/client"; import {NamedOutletsSetup} from "${resolve("src/components/named-outlets-setup.tsx").replaceAll("\\", "/")}"; createRoot(document.getElementById("root")).render(React.createElement(NamedOutletsSetup));`;
          return fixtures[id.slice(1)];
        },
      },
    ],
    build: {
      write: false,
      minify: false,
      rolldownOptions: { input: "outlet-entry", output: { format: "iife", name: "OutletFlow" } },
    },
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: bundle.output.find((o) => o.type === "chunk").code });
    const name = page.getByLabel("Outlet name", { exact: true });
    await name.fill("New Gazette");
    await page.getByLabel(/^Aliases/).click();
    assert.equal(await name.inputValue(), "New Gazette");
    const review = page.getByRole("button", { name: "Review changes", exact: true });
    assert.equal(await review.isEnabled(), true);
    await review.click();
    await page.getByRole("button", { name: "Confirm and apply", exact: true }).waitFor();
  } finally {
    await browser.close();
  }
});
