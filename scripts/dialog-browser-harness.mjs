// guards: dialog actions become unreachable or scrolling dismisses an editor's work.
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { rolldown } from "rolldown";
import { chromium } from "playwright";

// Bundle only the dialog UI. The chrome button and model service picker are
// fixtures; no app, database, model, or network service is started.
export async function dialogBrowser() {
  const bundle = await rolldown({
    input: "dialog-fixture",
    cwd: resolve(import.meta.dirname, ".."),
    transform: { jsx: "react-jsx" },
    plugins: [{
      name: "dialog-fixture",
      resolveId(id) {
        if (["dialog-fixture", "./desk-chrome", "@/components/model-picker"].includes(id)) return "\0" + id;
        if (id.startsWith("@/")) return resolve(import.meta.dirname, "../src", id.slice(2) + (id === "@/components/dialog" ? ".tsx" : ".ts"));
      },
      load(id) {
        if (id === "\0./desk-chrome") return `import React from 'react'; export function InkButton({children,onClick,disabled,ariaLabel}) { return React.createElement('button',{className:'btn',onClick,disabled,'aria-label':ariaLabel},children); }`;
        if (id === "\0@/components/model-picker") return `import React from 'react'; export function ModelPicker(){return React.createElement('select',{className:'fu-input'},React.createElement('option',null,'Fixture model'));}`;
        if (id === "\0dialog-fixture") return `
          import React from 'react'; import {createRoot} from 'react-dom/client';
          import * as dialogs from './src/components/dialog.tsx';
          import {FollowUpDialog} from './src/components/follow-up-dialog.tsx';
          const root=createRoot(document.getElementById('root'));
          window.closes=0;
          window.mount=(native=false)=>root.render(native ? React.createElement('div',{className:native==='reader'?'reader':'desk-ltr astra'+(document.documentElement.dataset.deskSize==='large'?' large':'')},
            React.createElement(dialogs.NativeDialog,{className:native==='reader'?'reader-dialog':'astra-dialog',onClose(){window.closes++;},ref:el=>el&&!el.open&&el.showModal()},
              React.createElement('div',{className:native==='reader'?'dialoghead':'astra-dialog-head'},'Preview',React.createElement('button',null,'Close')),
              React.createElement('div',{className:native==='reader'?'reader-dialog-body':'astra-dialog-body',tabIndex:0},Array.from({length:50},(_,i)=>React.createElement('p',{key:i},'Story paragraph '+i))),
              React.createElement('div',{className:native==='reader'?'reader-dialog-foot':'astra-dialog-foot'},React.createElement('button',null,'Done')))) :
            React.createElement(FollowUpDialog,{leads:[],onSubmit(){},onClose(){window.closes++;},initial:{what:'Follow the record',targets:'https://example.invalid/record'}}));
        `;
      },
    }],
  });
  const { output } = await bundle.generate({ format: "iife" });
  await bundle.close();
  const headed = process.env.TOWNREPORTER_DIALOG_HEADED === "1";
  const browser = await chromium.launch({ headless: !headed, ignoreDefaultArgs: ["--hide-scrollbars"], args: headed && process.platform === "win32" ? ["--window-position=-2000,-2000"] : [] });
  const page = await browser.newPage();
  await page.route("**/*", route => route.abort());
  await page.setContent('<html><body style="margin:0"><div id="root"></div><div style="height:3000px"></div></body></html>');
  for (const file of ["styles.css", "desk-astra.css", "reader-astra.css"]) {
    await page.addStyleTag({ content: await readFile(new URL("../src/" + file, import.meta.url), "utf8") });
  }
  // Use a visible, fixed-width native thumb on Linux and Windows alike.
  // Platform overlay-scrollbar defaults otherwise give the drag no thumb.
  await page.addStyleTag({ content: `
    :is(.astra-modal-body,.astra-dialog-body,.reader-dialog-body)::-webkit-scrollbar { width: 14px; }
    :is(.astra-modal-body,.astra-dialog-body,.reader-dialog-body)::-webkit-scrollbar-track { background: #eee; }
    :is(.astra-modal-body,.astra-dialog-body,.reader-dialog-body)::-webkit-scrollbar-thumb { background: #666; min-height: 28px; }
    :is(.astra-modal-body,.astra-dialog-body,.reader-dialog-body)::-webkit-scrollbar-button { display: none; }
  ` });
  await page.addScriptTag({ content: output[0].code });
  return { browser, page };
}
